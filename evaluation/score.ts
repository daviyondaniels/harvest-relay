import type { InterpretResult } from "../src/interpret.ts";
import { normalize, type Quantity } from "../src/quantity.ts";
import { FIELDS, type Field, type Operation } from "../src/updates.ts";

// Held-out labels describe what the message itself settles. A field listed in `ask` is
// one the coordinator must get from the grower; its value must stay open.
export type Label = {
  operation: Operation; lotId: string | null; quantity: { amount: number; unit: Quantity["unit"] } | null;
  pack: { amount: number; unit: "g" | "kg" | "each" } | null; grade: string | null; deliveryOn: string | null;
  correctsEventId: string | null; ask: Field[];
};
export type Setup = { growerId: string; text: string; operation: "replace-total" | "add-quantity" | "correction"; lotId: string; quantity: { amount: number; unit: Quantity["unit"] }; correctsEventId?: string };
export type Case = { id: string; category: string; growerId: string; text: string; setup?: Setup[]; label: Label; note?: string };

// correct: right value. asked: needed question raised by the model. caught: model asserted
// an unsupported value that the evidence rule dropped. missed: needed question not raised.
// wrong: a value that survived and is incorrect or should have been open. over-asked:
// question on a settled fact. omitted: settled fact left out without a question.
export type Grade = "correct" | "asked" | "caught" | "missed" | "wrong" | "over-asked" | "omitted" | "n/a";
const SCORED: Field[] = ["operation", "lot", "quantity", "pack", "grade", "date", "correction-target"];

export function validateCase(c: Case): void {
  if (!c || typeof c.id !== "string" || !c.id.trim() || typeof c.text !== "string" || !c.text.trim() || c.text.length > 2000 || typeof c.growerId !== "string") throw new Error(`Invalid case ${c?.id}`);
  const l = c.label;
  if (!l || !Array.isArray(l.ask) || l.ask.some(f => !FIELDS.includes(f))) throw new Error(`Invalid label in ${c.id}`);
  if ((l.operation === "unresolved") !== l.ask.includes("operation")) throw new Error(`${c.id}: an unresolved operation must be listed in ask, and only then`);
  const settled: Partial<Record<Field, unknown>> = { lot: l.lotId, quantity: l.quantity, pack: l.pack, grade: l.grade, date: l.deliveryOn, "correction-target": l.correctsEventId };
  for (const f of l.ask) if (settled[f] !== undefined && settled[f] !== null) throw new Error(`${c.id}: ${f} is both labelled and asked`);
}

const grams = (p: { amount: number; unit: string }) => p.unit === "kg" ? { amount: p.amount * 1000, unit: "g" } : { amount: p.amount, unit: p.unit };
function same(f: Field, a: unknown, b: unknown): boolean {
  if (f === "pack") return JSON.stringify(grams(a as Quantity)) === JSON.stringify(grams(b as Quantity));
  if (f !== "quantity") return JSON.stringify(a) === JSON.stringify(b);
  const x = a as Quantity, y = b as Quantity;
  if (x.amount === y.amount && x.unit === y.unit) return true;
  try { const p = normalize(x), q = normalize(y); return p.amount === q.amount && p.unit === q.unit; } catch { return false; }
}

export function scoreCase(c: Case, r: InterpretResult) {
  if (r.status !== "proposed") return { id: c.id, category: c.category, status: r.status, reason: (r as { reason: string }).reason, grades: {} as Partial<Record<Field, Grade>>, unsafe: false };
  const i = r.proposal.interpretation, l = c.label;
  const open = new Set<Field>([...i.unresolved, ...r.proposal.clarifications.map(q => q.field), ...(i.operation === "unresolved" ? ["operation" as const] : [])]);
  if (open.has("unit")) open.add("quantity");
  const kept: Record<string, unknown> = { operation: i.operation === "unresolved" ? undefined : i.operation, lot: i.lotId, quantity: i.quantity && { amount: i.quantity.amount, unit: i.quantity.unit },
    pack: i.quantity?.pack, grade: i.grade, date: i.deliveryOn, "correction-target": i.correctsEventId };
  const expected: Record<string, unknown> = { operation: l.operation === "unresolved" ? null : l.operation, lot: l.lotId, quantity: l.quantity, pack: l.pack, grade: l.grade, date: l.deliveryOn, "correction-target": l.correctsEventId };
  const grades: Partial<Record<Field, Grade>> = {};
  for (const f of SCORED) {
    const has = kept[f] !== undefined && kept[f] !== null, want = expected[f];
    grades[f] = l.ask.includes(f) ? (has ? "wrong" : r.discarded.includes(f) ? "caught" : open.has(f) ? "asked" : "missed")
      : want !== null ? (has ? (same(f, kept[f], want) ? "correct" : "wrong") : open.has(f) ? "over-asked" : "omitted")
      : has ? "wrong" : open.has(f) ? "over-asked" : "n/a";
  }
  // Unsafe: a wrong value survives and review raises no question, so a hurried approval commits it.
  return { id: c.id, category: c.category, status: r.status, grades, unsafe: Object.values(grades).includes("wrong") && r.questions.length === 0 };
}

export function summarize(scores: ReturnType<typeof scoreCase>[]) {
  const count = (g: Grade) => scores.reduce((n, s) => n + Object.values(s.grades).filter(x => x === g).length, 0);
  return {
    cases: scores.length, proposed: scores.filter(s => s.status === "proposed").length, noProposal: scores.filter(s => s.status !== "proposed").length,
    unsafe: scores.filter(s => s.unsafe).length, wrong: count("wrong"), correct: count("correct"),
    asked: count("asked"), caught: count("caught"), missed: count("missed"), overAsked: count("over-asked"), omitted: count("omitted")
  };
}
