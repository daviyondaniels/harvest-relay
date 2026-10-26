import { snapshotHash } from "../src/planner.ts";
import type { ReplyResult } from "../src/interpret.ts";
import { normalize, type Quantity } from "../src/quantity.ts";
import { FIELDS, reviewUpdate, type Field, type Interpretation, type Ledger, type Operation, type Source, type UpdateProposal } from "../src/updates.ts";

// Reply cases fix the coordinator's current reading of the first message, so a run
// measures only how the reply is read. Labels say what the reply itself settles.
type Value = unknown;
export type Reading = {
  operation: Operation; lotId: string | null; quantity: { amount: number; unit: Quantity["unit"]; pack?: { amount: number; unit: "g" | "kg" | "each" } } | null;
  grade: string | null; deliveryOn: string | null;
};
export type ReplyLabel = { answers: Partial<Record<Field, Value>>; corrections: Partial<Record<Field, Value>>; open: Field[] };
export type ReplyCase = { id: string; category: string; growerId: string; message: string; reading: Reading; reply: string; label: ReplyLabel; note?: string };

// correct: right value. wrong: a value that would go to approval and is incorrect.
// missed: the reply settles it, but no answer or correction was proposed. over-answered:
// an open field was filled although the reply does not settle it. spurious: a settled
// fact was changed although the reply does not correct it. kept-open: correctly left open.
export type ReplyGrade = "correct" | "wrong" | "missed" | "over-answered" | "spurious" | "kept-open" | "n/a";
const SCORED: Field[] = ["operation", "lot", "quantity", "pack", "grade", "date"];

const kg = (p: unknown) => { const x = p as { amount: number; unit: string }; return x?.unit === "kg" ? { amount: x.amount * 1000, unit: "g" } : x; };
function same(f: Field, a: unknown, b: unknown): boolean {
  if (f === "pack") return JSON.stringify(kg(a)) === JSON.stringify(kg(b));
  if (f !== "quantity") return JSON.stringify(a) === JSON.stringify(b);
  const x = a as Quantity, y = b as Quantity;
  try { const p = normalize({ amount: x.amount, unit: x.unit, ...(x.pack ? { pack: kg(x.pack) as Quantity["pack"] } : {}) }), q = normalize({ amount: y.amount, unit: y.unit, ...(y.pack ? { pack: kg(y.pack) as Quantity["pack"] } : {}) });
    return p.amount === q.amount && p.unit === q.unit; }
  catch { return x.amount === y.amount && x.unit === y.unit; }
}

// The proposal the reply answers: the reading as an interpretation over the whole message.
export function readingProposal(l: Ledger, c: ReplyCase): UpdateProposal {
  const r = c.reading, q = r.quantity;
  const interpretation: Interpretation = { operation: r.operation, unresolved: [], spans: [{ start: 0, end: c.message.length }],
    ...(r.lotId ? { lotId: r.lotId } : {}), ...(r.grade ? { grade: r.grade } : {}), ...(r.deliveryOn ? { deliveryOn: r.deliveryOn } : {}),
    ...(q ? { quantity: { amount: q.amount, unit: q.unit, ...(q.pack ? { pack: kg(q.pack) as Quantity["pack"] } : {}) } } : {}) };
  return { id: `${c.id}-update`, baseVersion: l.version, baseHash: snapshotHash(l.snapshot), source: messageSource(c), interpretation, clarifications: [] };
}
export const messageSource = (c: ReplyCase): Source => ({ id: `${c.id}-message`, revision: 1, growerId: c.growerId, text: c.message });
export const replySource = (c: ReplyCase): Source => ({ id: `${c.id}-reply`, revision: 1, growerId: c.growerId, text: c.reply });

// Every field the reading leaves open must be labelled as answered or still open, and
// corrections may only name fields the reading settles.
export function validateReplyCase(l: Ledger, c: ReplyCase): void {
  if (!c || typeof c.id !== "string" || !c.id.trim() || [c.message, c.reply].some(t => typeof t !== "string" || !t.trim() || t.length > 2000) || typeof c.growerId !== "string") throw new Error(`Invalid reply case ${c?.id}`);
  const lb = c.label;
  if (!lb || typeof lb.answers !== "object" || typeof lb.corrections !== "object" || !Array.isArray(lb.open)) throw new Error(`${c.id}: label needs answers, corrections and open`);
  const named = [...Object.keys(lb.answers), ...Object.keys(lb.corrections), ...lb.open] as Field[];
  if (named.some(f => !FIELDS.includes(f))) throw new Error(`${c.id}: unknown field in label`);
  if (new Set(named).size !== named.length) throw new Error(`${c.id}: a field may appear only once across answers, corrections and open`);
  const open = new Set(reviewUpdate(l, readingProposal(l, c)).questions.map(q => q.field));
  for (const f of Object.keys(lb.corrections) as Field[]) if (open.has(f)) throw new Error(`${c.id}: ${f} is open in the reading; label it as an answer`);
  for (const f of [...Object.keys(lb.answers), ...lb.open] as Field[]) if (!open.has(f)) throw new Error(`${c.id}: ${f} is not open in the reading; label a change to it as a correction`);
  for (const f of open) if (!(f in lb.answers) && !lb.open.includes(f)) throw new Error(`${c.id}: open field ${f} must be in answers or open`);
}

const valueOf = (i: Interpretation, f: Field) => ({ operation: i.operation, lot: i.lotId, quantity: i.quantity && { amount: i.quantity.amount, unit: i.quantity.unit }, pack: i.quantity?.pack,
  grade: i.grade, date: i.deliveryOn, unit: undefined, "correction-target": i.correctsEventId } as Record<Field, unknown>)[f];

export function scoreReply(c: ReplyCase, r: ReplyResult) {
  if (r.status !== "proposed") return { id: c.id, category: c.category, status: r.status, reason: r.reason, grades: {} as Partial<Record<Field, ReplyGrade>>, unsafe: false };
  const lb = c.label, i = r.proposal.interpretation, corrected = new Set(r.corrections.map(x => x.field)), applied = new Set(r.applied);
  const grades: Partial<Record<Field, ReplyGrade>> = {};
  for (const f of SCORED) {
    const want = f in lb.answers ? lb.answers[f] : f in lb.corrections ? lb.corrections[f] : undefined;
    const changed = f in lb.answers ? applied.has(f) : corrected.has(f);
    grades[f] = want !== undefined ? (changed ? (same(f, valueOf(i, f), want) ? "correct" : "wrong") : "missed")
      : lb.open.includes(f) ? (applied.has(f) ? "over-answered" : "kept-open")
      : corrected.has(f) ? "spurious" : "n/a";
  }
  // Unsafe: an incorrect or unsupported value would reach the approval step.
  return { id: c.id, category: c.category, status: r.status, grades, unsafe: Object.values(grades).some(g => g === "wrong" || g === "over-answered" || g === "spurious") };
}

export function summarizeReplies(scores: ReturnType<typeof scoreReply>[]) {
  const count = (g: ReplyGrade) => scores.reduce((n, s) => n + Object.values(s.grades).filter(x => x === g).length, 0);
  return { cases: scores.length, proposed: scores.filter(s => s.status === "proposed").length, noProposal: scores.filter(s => s.status !== "proposed").length,
    unsafe: scores.filter(s => s.unsafe).length, correct: count("correct"), wrong: count("wrong"), missed: count("missed"),
    overAnswered: count("over-answered"), spurious: count("spurious"), keptOpen: count("kept-open") };
}
