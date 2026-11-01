import { canonicalGrade } from "./grades.ts";
import { digest } from "./planner.ts";
import { checkPack, normalize, type Quantity } from "./quantity.ts";
import { FIELDS, OPERATIONS, locate, reviewUpdate, validateSource, type Clarification, type Field, type Interpretation, type Ledger, type Operation, type Source, type UpdateProposal } from "./updates.ts";

// A grower's reply settles open questions only through quoted words. Answers come from
// the coordinator or from a model proposal; either way they are checked here and applied
// to a new proposal, which is then reviewed and approved like any other. A reply that
// states a different value for a fact the message settled corrects the pending update:
// the change is recorded with both values and the reply quote, and the original message
// evidence is kept. It takes effect only through approval of the new review hash.
export type Answer = { field: Field; quote: string; value: unknown };
export type Correction = { field: Field; from: unknown; to: unknown; quote: string };
export type AnswerResult = { proposal: UpdateProposal; applied: Field[]; corrections: Correction[]; unclear: Field[]; unanswered: Field[] };

const KEYS: Partial<Record<Field, keyof Interpretation>> = { operation: "operation", lot: "lotId", quantity: "quantity", unit: "quantity", grade: "grade", date: "deliveryOn", "correction-target": "correctsEventId" };
const UNITS = ["g", "kg", "lb", "each", "case"];

function whole(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error("Answer quantities must be nonnegative whole numbers");
  return v as number;
}
function name(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 160) throw new Error("Invalid answer value");
  return v;
}
function shape(v: unknown, keys: string[]): Record<string, unknown> {
  const o = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
  if (!o || Object.keys(o).some(k => !keys.includes(k))) throw new Error("Invalid answer value");
  return o;
}
// Case contents may be stated in kg; converted to grams exactly, as for model output.
// Pounds stay pounds, never converted.
function pack(v: unknown): NonNullable<Quantity["pack"]> {
  const o = shape(v, ["amount", "unit"]), amount = whole(o.amount);
  if (o.unit === "kg") {
    if (!Number.isSafeInteger(amount * 1000)) throw new Error("Answer quantities must be nonnegative whole numbers");
    const grams = { amount: amount * 1000, unit: "g" as const };
    checkPack(grams);
    return grams;
  }
  if (o.unit !== "g" && o.unit !== "lb" && o.unit !== "each") throw new Error("Case contents must be g, kg, lb or each");
  const made: NonNullable<Quantity["pack"]> = { amount, unit: o.unit };
  checkPack(made);
  return made;
}
// The plain words a coordinator might type for the kind of update, mapped to the operation.
// Anything that fits two kinds, or none, is left for the coordinator to choose.
const PHRASES: [Operation, RegExp][] = [
  ["replace-total", /\b(new total|total|replaces?|replacing|instead)\b/],
  ["add-quantity", /\b(add|adds|adding|more|in addition|extra)\b/],
  ["correction", /\b(correction|fix|mistake)\b/],
  ["forecast", /\b(forecast|maybe|might|expect|expected)\b/]
];
export function parseOperation(raw: string): Operation | undefined {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const exact = OPERATIONS.find(o => o !== "unresolved" && o === t);
  if (exact) return exact;
  const hits = PHRASES.filter(([, re]) => re.test(t)).map(([o]) => o);
  return hits.length === 1 ? hits[0] : undefined;
}
function read(field: Field, v: unknown): unknown {
  switch (field) {
    case "operation": if (v === "unresolved" || !OPERATIONS.includes(v as never)) throw new Error("Choose what kind of update this is"); return v;
    case "lot": case "correction-target": return name(v);
    case "grade": return canonicalGrade(name(v));
    case "date": {
      const d = name(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new Error("Invalid date answer");
      return d;
    }
    case "quantity": case "unit": {
      const o = shape(v, ["amount", "unit", "pack"]);
      if (!UNITS.includes(o.unit as string)) throw new Error("Unsupported unit in answer");
      if (o.pack !== undefined && o.pack !== null && o.unit !== "case") throw new Error("Case contents given for a non-case unit");
      const q = { amount: whole(o.amount), unit: o.unit, ...(o.pack ? { pack: pack(o.pack) } : {}) } as Quantity;
      if (q.unit !== "case" || q.pack) normalize(q);
      return q;
    }
    case "pack": return pack(v);
  }
}
// Open: anything review asks about, plus any fact the reading leaves missing. Review asks
// about some facts only once others are known (the date once the lot is), so a missing
// value is open before review reaches it. Supplying a missing value is an answer; only
// changing a value the reading has is a correction.
export function openFields(l: Ledger, p: UpdateProposal): Set<Field> {
  const i = p.interpretation, open = new Set(reviewUpdate(l, p).questions.map(q => q.field));
  const missing: [Field, boolean][] = [["operation", i.operation === "unresolved"], ["lot", !i.lotId], ["quantity", !i.quantity], ["grade", !i.grade],
    ["date", !i.deliveryOn], ["pack", i.quantity?.unit === "case" && !i.quantity.pack]];
  for (const [f, m] of missing) if (m) open.add(f);
  return open;
}
const current = (i: Interpretation, f: Field) => f === "pack" ? i.quantity?.pack : i[KEYS[f]!];

// unclear: fields the reply addresses but that could not be read (for example a fractional
// amount). Each adds a blocking question, whether the field was open or settled, so a
// correction that cannot be represented is never dropped silently.
export function applyAnswers(l: Ledger, p: UpdateProposal, reply: Source, answers: Answer[], unclear: Field[] = []): AnswerResult {
  validateSource(reply);
  if (reply.growerId !== p.source.growerId) throw new Error("A reply must come from the grower who sent the update");
  if (reply.id === p.source.id) throw new Error("A reply must be a separate source from the update it answers");
  return apply(l, p, reply, answers, unclear, "Reply");
}
// The coordinator's own reading of words already in the message: the same checks and
// correction record as a reply, with the message itself as the quoted evidence.
export function amendFromMessage(l: Ledger, p: UpdateProposal, answers: Answer[]): AnswerResult {
  return apply(l, p, p.source, answers, [], "Coordinator reading of the message");
}
function apply(l: Ledger, p: UpdateProposal, reply: Source, answers: Answer[], unclear: Field[], by: string): AnswerResult {
  if (!Array.isArray(answers) || answers.length > FIELDS.length) throw new Error("Bounded answer list required");
  if (new Set(answers.map(a => a?.field)).size !== answers.length) throw new Error("At most one answer per field");
  if (answers.some(a => !FIELDS.includes(a?.field) || typeof a.quote !== "string" || a.quote.length > 500)) throw new Error("Invalid answer");
  if (!Array.isArray(unclear) || unclear.some(f => !FIELDS.includes(f)) || new Set(unclear).size !== unclear.length || unclear.some(f => answers.some(a => a.field === f))) throw new Error("Unclear fields must be distinct, known and unanswered");
  const review = reviewUpdate(l, p), open = openFields(l, p);
  const i: Interpretation = structuredClone(p.interpretation), clarifications: Clarification[] = structuredClone(p.clarifications);
  const applied: Field[] = [], corrections: Correction[] = [];
  // Quantity before pack, so one reply can state both a count of cases and their contents.
  for (const a of [...answers].sort((x, y) => FIELDS.indexOf(x.field) - FIELDS.indexOf(y.field))) {
    const span = locate(reply.text, a.quote);
    let value = read(a.field, a.value);
    // A count of cases stated without contents keeps the contents already known, before
    // comparing, so restating "still five cases" is not a correction.
    if ((a.field === "quantity" || a.field === "unit") && (value as Quantity).unit === "case" && !(value as Quantity).pack && i.quantity?.pack) value = { ...(value as Quantity), pack: i.quantity.pack };
    const correcting = !open.has(a.field), from = current(i, a.field) ?? null;
    if (correcting && digest(from) === digest(value)) continue;
    if (a.field === "pack") {
      if (i.quantity?.unit !== "case") throw new Error("Case contents answer needs a quantity in cases");
      i.quantity = { ...i.quantity, pack: value as NonNullable<Quantity["pack"]> };
    } else if (a.field === "quantity" || a.field === "unit") i.quantity = value as Quantity;
    else (i as Record<string, unknown>)[KEYS[a.field]!] = value;
    i.unresolved = i.unresolved.filter(f => f !== a.field && !(a.field === "quantity" && f === "unit") && !(a.field === "unit" && f === "quantity"));
    const answer = { source: structuredClone(reply), span };
    if (correcting) {
      corrections.push({ field: a.field, from, to: value, quote: a.quote });
      clarifications.push({ field: a.field, question: `${by} corrects ${a.field} from ${JSON.stringify(from)} to ${JSON.stringify(value)}`.slice(0, 500), answer });
      continue;
    }
    const asked = clarifications.filter(c => c.field === a.field && !c.answer);
    if (asked.length) for (const c of asked) c.answer = answer;
    else clarifications.push({ field: a.field, question: review.questions.find(q => q.field === a.field)?.question ?? `Not stated in the message: ${a.field}`, answer });
    applied.push(a.field);
  }
  for (const f of unclear) clarifications.push({ field: f, question: `The reply addresses ${f} but could not be read as a supported value; confirm with the grower` });
  const proposal: UpdateProposal = { ...structuredClone(p), interpretation: i, clarifications };
  return { proposal, applied, corrections, unclear: [...unclear], unanswered: [...new Set(reviewUpdate(l, proposal).questions.map(q => q.field))] };
}
