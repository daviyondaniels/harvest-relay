import { digest } from "./planner.ts";
import type { Quantity } from "./quantity.ts";
import { FIELDS, OPERATIONS, locate, reviewUpdate, validateSource, type Clarification, type Field, type Interpretation, type Ledger, type Source, type UpdateProposal } from "./updates.ts";

// A grower's reply settles open questions only through quoted words. Answers come from
// the coordinator or from a model proposal; either way they are checked here and applied
// to a new proposal, which is then reviewed and approved like any other. A reply never
// overwrites a fact the original message settled: a differing value re-opens review.
export type Answer = { field: Field; quote: string; value: unknown };
export type AnswerResult = { proposal: UpdateProposal; applied: Field[]; conflicts: { field: Field; quote: string }[]; unanswered: Field[] };

const KEYS: Partial<Record<Field, keyof Interpretation>> = { operation: "operation", lot: "lotId", quantity: "quantity", unit: "quantity", grade: "grade", date: "deliveryOn", "correction-target": "correctsEventId" };
const UNITS = ["g", "kg", "each", "case"];

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
function pack(v: unknown): NonNullable<Quantity["pack"]> {
  const o = shape(v, ["amount", "unit"]), amount = whole(o.amount);
  if (o.unit === "kg") { if (!Number.isSafeInteger(amount * 1000)) throw new Error("Answer quantities must be nonnegative whole numbers"); return { amount: amount * 1000, unit: "g" }; }
  if (o.unit !== "g" && o.unit !== "each") throw new Error("Case contents must be g, kg or each");
  return { amount, unit: o.unit };
}
function read(field: Field, v: unknown): unknown {
  switch (field) {
    case "operation": if (v === "unresolved" || !OPERATIONS.includes(v as never)) throw new Error("Invalid operation answer"); return v;
    case "lot": case "grade": case "correction-target": return name(v);
    case "date": {
      const d = name(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) throw new Error("Invalid date answer");
      return d;
    }
    case "quantity": case "unit": {
      const o = shape(v, ["amount", "unit", "pack"]);
      if (!UNITS.includes(o.unit as string)) throw new Error("Unsupported unit in answer");
      if (o.pack !== undefined && o.pack !== null && o.unit !== "case") throw new Error("Case contents given for a non-case unit");
      return { amount: whole(o.amount), unit: o.unit, ...(o.pack ? { pack: pack(o.pack) } : {}) };
    }
    case "pack": return pack(v);
  }
}
const current = (i: Interpretation, f: Field) => f === "pack" ? i.quantity?.pack : i[KEYS[f]!];

export function applyAnswers(l: Ledger, p: UpdateProposal, reply: Source, answers: Answer[]): AnswerResult {
  validateSource(reply);
  if (reply.growerId !== p.source.growerId) throw new Error("A reply must come from the grower who sent the update");
  if (reply.id === p.source.id) throw new Error("A reply must be a separate source from the update it answers");
  if (!Array.isArray(answers) || answers.length > FIELDS.length) throw new Error("Bounded answer list required");
  if (new Set(answers.map(a => a?.field)).size !== answers.length) throw new Error("At most one answer per field");
  if (answers.some(a => !FIELDS.includes(a?.field) || typeof a.quote !== "string" || a.quote.length > 500)) throw new Error("Invalid answer");
  const review = reviewUpdate(l, p), open = new Set(review.questions.map(q => q.field));
  const i: Interpretation = structuredClone(p.interpretation), clarifications: Clarification[] = structuredClone(p.clarifications);
  const applied: Field[] = [], conflicts: AnswerResult["conflicts"] = [];
  // Quantity before pack, so one reply can state both a count of cases and their contents.
  for (const a of [...answers].sort((x, y) => FIELDS.indexOf(x.field) - FIELDS.indexOf(y.field))) {
    const span = locate(reply.text, a.quote), value = read(a.field, a.value);
    if (!open.has(a.field)) {
      if (digest(current(i, a.field) ?? null) === digest(value)) continue;
      conflicts.push({ field: a.field, quote: a.quote });
      clarifications.push({ field: a.field, question: `The reply ("${a.quote.slice(0, 200)}") differs from the original message; confirm with the grower and record a corrected revision` });
      continue;
    }
    if (a.field === "pack") {
      if (i.quantity?.unit !== "case") throw new Error("Case contents answer needs a quantity in cases");
      i.quantity = { ...i.quantity, pack: value as NonNullable<Quantity["pack"]> };
    } else if (a.field === "quantity" || a.field === "unit") {
      const q = value as Quantity;
      i.quantity = q.unit === "case" && !q.pack && i.quantity?.pack ? { ...q, pack: i.quantity.pack } : q;
    } else (i as Record<string, unknown>)[KEYS[a.field]!] = value;
    i.unresolved = i.unresolved.filter(f => f !== a.field && !(a.field === "quantity" && f === "unit") && !(a.field === "unit" && f === "quantity"));
    const answer = { source: structuredClone(reply), span };
    const asked = clarifications.filter(c => c.field === a.field && !c.answer);
    if (asked.length) for (const c of asked) c.answer = answer;
    else clarifications.push({ field: a.field, question: review.questions.find(q => q.field === a.field)!.question, answer });
    applied.push(a.field);
  }
  const proposal: UpdateProposal = { ...structuredClone(p), interpretation: i, clarifications };
  return { proposal, applied, conflicts, unanswered: [...new Set(reviewUpdate(l, proposal).questions.map(q => q.field))] };
}
