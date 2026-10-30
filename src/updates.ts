import type { Commitments } from "./commitments.ts";
import { digest, snapshotHash, validateSnapshot, type Lot, type Snapshot } from "./planner.ts";
import { NAME_MAX } from "./hub.ts";
import { integer, normalize, type BaseUnit, type Quantity } from "./quantity.ts";

// Immutable intake record: one source ID and revision always denote the same text.
export type Source = { id: string; revision: number; growerId: string; text: string };
export type Span = { start: number; end: number };
export type Operation = "replace-total" | "add-quantity" | "correction" | "forecast" | "unresolved";
export type Field = "operation" | "lot" | "quantity" | "unit" | "pack" | "grade" | "date" | "correction-target";
// Untrusted reading of the source: authored by hand now, model-proposed later.
export type Interpretation = {
  operation: Operation; lotId?: string; quantity?: Quantity; grade?: string; deliveryOn?: string;
  correctsEventId?: string; unresolved: Field[]; spans: Span[];
};
export type Clarification = { field: Field; question: string; answer?: { source: Source; span: Span } };
export type UpdateProposal = {
  id: string; baseVersion: number; baseHash: string;
  source: Source; interpretation: Interpretation; clarifications: Clarification[];
};
export type Question = { field: Field; question: string };
export type Approval = { reviewHash: string; reviewer: string };
export type Effect = "replace-total" | "add-quantity" | "forecast";
export type UpdateEvent = {
  id: string; proposal: UpdateProposal; approval: Approval; effect: Effect; lotId: string;
  lotBefore: Quantity; lotAfter: Quantity; beforeHash: string; afterHash: string;
};
// For a forecast, after equals before (confirmed supply does not move) and expected is the
// amount the grower said might come.
export type Change = { effect: Effect; lotId: string; before: Quantity; after: Quantity; expected?: Quantity };
export type Forecast = { eventId: string; lotId: string; amount: number; unit: BaseUnit; deliveryOn: string };
export type Evidence = { messageId: string; channel: "text" | "call"; quote: string };
// What the coordinator recorded from a grower's or buyer's reply, beside the grower update events.
export type LedgerRecord =
  | { id: string; kind: "substitute-accepted"; orderId: string; substitute: { product: string; acceptedGrades: string[]; maxAmount?: number }; change?: "raised" | "uncapped" | "grade-added"; previousMax?: number; evidence: Evidence; recordedBy: string; beforeHash: string; afterHash: string }
  | { id: string; kind: "lot-added"; lot: Lot; evidence: Evidence; recordedBy: string; beforeHash: string; afterHash: string };
// Forecasts sit beside, never inside, the snapshot the planner allocates from.
export type Ledger = { version: number; snapshot: Snapshot; events: UpdateEvent[]; forecasts: Forecast[]; records: LedgerRecord[]; commitments?: Commitments };

export const OPERATIONS: Operation[] = ["replace-total", "add-quantity", "correction", "forecast", "unresolved"];
export const FIELDS: Field[] = ["operation", "lot", "quantity", "unit", "pack", "grade", "date", "correction-target"];

export function createLedger(s: Snapshot): Ledger {
  validateSnapshot(s);
  return { version: 0, snapshot: structuredClone(s), events: [], forecasts: [], records: [] };
}
export function locate(text: string, quote: string): Span {
  const start = quote ? text.indexOf(quote) : -1;
  if (start < 0) throw new Error("Literal source evidence required");
  return { start, end: start + quote.length };
}

export function validateSource(s: Source): void {
  if (!s || typeof s.id !== "string" || !s.id.trim() || s.id.length > 160 || typeof s.growerId !== "string" || !s.growerId.trim() || s.growerId.length > 160 ||
      typeof s.text !== "string" || !s.text.trim() || s.text.length > 8000) throw new Error("Valid source record required");
  integer(s.revision, "source revision");
}
function spans(text: string, xs: Span[]): void {
  if (!Array.isArray(xs) || xs.length === 0 || xs.length > 20 || xs.some(x => !Number.isSafeInteger(x?.start) || !Number.isSafeInteger(x?.end) ||
      x.start < 0 || x.end > text.length || x.start >= x.end || !text.slice(x.start, x.end).trim())) throw new Error("Literal source evidence required");
}
const optional = (v: unknown) => v === undefined || (typeof v === "string" && !!v.trim() && v.length <= 160);

type Step = { id: string; effect: Effect; corrects?: string; quantity: Quantity; lotBefore: Quantity };
const inventory = (l: Ledger, lotId: string): Step[] => l.events.filter(e => e.lotId === lotId && e.effect !== "forecast")
  .map(e => ({ id: e.id, effect: e.effect, corrects: e.proposal.interpretation.correctsEventId, quantity: e.proposal.interpretation.quantity!, lotBefore: e.lotBefore }));
// Maps each original update to the newest step (itself or a correction) now in force for it.
function inForce(steps: Step[]): Map<string, Step> {
  const root = new Map<string, string>(), current = new Map<string, Step>();
  for (const s of steps) { const r = s.corrects === undefined ? s.id : root.get(s.corrects)!; root.set(s.id, r); current.set(r, s); }
  return current;
}
// A lot's quantity is its initial quantity folded over every original update, each
// with its in-force correction, so a correction to an older update carries through
// later additions while a later new total still overrides it.
function replay(steps: Step[]): Quantity {
  const current = inForce(steps);
  let q = steps[0].lotBefore;
  for (const s of steps) {
    const x = current.get(s.id);
    if (!x) continue;
    const change = normalize(x.quantity);
    q = s.effect === "replace-total" ? x.quantity : { amount: normalize(q).amount + change.amount, unit: change.unit };
  }
  return structuredClone(q);
}
function outcome(l: Ledger, p: UpdateProposal): Change {
  const i = p.interpretation, lot = l.snapshot.lots.find(x => x.id === i.lotId)!, target = l.events.find(e => e.id === i.correctsEventId);
  const effect = target ? target.effect : i.operation as Effect, before = structuredClone(lot.quantity);
  const after = effect === "forecast" ? before
    : replay([...inventory(l, lot.id), { id: `event-${l.events.length + 1}`, effect, corrects: i.correctsEventId, quantity: i.quantity!, lotBefore: before }]);
  return { effect, lotId: lot.id, before, after, ...(effect === "forecast" ? { expected: structuredClone(i.quantity!) } : {}) };
}

// Throws for malformed, duplicate or stale input; returns questions for anything a
// person must still resolve. Any question blocks commit. With no questions, the
// change shows the coordinator the lot quantity the commit would produce.
export function reviewUpdate(ledger: Ledger, p: UpdateProposal): { hash: string; questions: Question[]; change?: Change } {
  validateSnapshot(ledger.snapshot);
  if (typeof p?.id !== "string" || !p.id.trim() || p.id.length > 160) throw new Error("Proposal identity required");
  validateSource(p.source);
  const i = p.interpretation;
  if (!i || !OPERATIONS.includes(i.operation) || !Array.isArray(i.unresolved) || i.unresolved.some(f => !FIELDS.includes(f)) ||
      ![i.lotId, i.grade, i.deliveryOn, i.correctsEventId].every(optional)) throw new Error("Invalid interpretation");
  spans(p.source.text, i.spans);
  if (!Array.isArray(p.clarifications) || p.clarifications.length > 20) throw new Error("Bounded clarification list required");
  for (const c of p.clarifications) {
    if (!FIELDS.includes(c?.field) || typeof c.question !== "string" || !c.question.trim() || c.question.length > 500) throw new Error("Invalid clarification");
    if (c.answer !== undefined) { validateSource(c.answer.source); spans(c.answer.source.text, [c.answer.span]); }
  }
  // A source ID and revision name exactly one record wherever it appears: as a primary
  // source or an answer, in this proposal or in committed history. Identical reuse is fine.
  const records = new Map<string, string>();
  for (const s of [...ledger.events.map(e => e.proposal), p].flatMap(x => [x.source, ...x.clarifications.flatMap(c => c.answer ? [c.answer.source] : [])])) {
    const key = JSON.stringify([s.id, s.revision]), d = digest(s);
    if ((records.get(key) ?? d) !== d) throw new Error("Source revision conflict; one ID and revision names different records");
    records.set(key, d);
  }
  // One message may update several lots, but each source revision changes a lot at most
  // once. Only primary sources count: citing a source as an answer applies nothing.
  for (const e of ledger.events) {
    const s = e.proposal.source;
    if (s.id !== p.source.id || e.lotId !== i.lotId) continue;
    if (s.revision === p.source.revision) throw new Error("Duplicate source revision already committed for this lot");
    if (s.revision > p.source.revision) throw new Error("Superseded source revision; a newer revision is already committed");
  }
  if (p.baseVersion !== ledger.version || p.baseHash !== snapshotHash(ledger.snapshot)) throw new Error("Stale update; review against current inventory");

  const questions: Question[] = [], ask = (field: Field, question: string) => { questions.push({ field, question }); };
  for (const c of p.clarifications) if (!c.answer) ask(c.field, `Unanswered: ${c.question}`);
  for (const f of i.unresolved) ask(f, `Interpretation marks ${f} unresolved`);
  if (i.operation === "unresolved") ask("operation", "Clarify whether this is a new total, an added quantity, a correction of an earlier update or a forecast");
  const lot = ledger.snapshot.lots.find(l => l.id === i.lotId);
  if (!lot) ask("lot", i.lotId === undefined ? "Identify the lot" : "Unknown lot; confirm lot identity");
  else {
    if (lot.growerId !== p.source.growerId) ask("lot", "Source grower does not match the lot's grower");
    if (i.grade !== lot.grade) ask("grade", i.grade === undefined ? "Confirm the grade" : "Stated grade conflicts with the lot; a different grade needs its own lot");
    if (i.deliveryOn !== lot.deliveryOn) ask("date", i.deliveryOn === undefined ? "Confirm the delivery date" : "Stated date conflicts with the lot; a different date needs its own lot");
  }
  if (!i.quantity) ask("quantity", "State the quantity and unit");
  else {
    try {
      if (lot && normalize(i.quantity).unit !== normalize(lot.quantity).unit) ask("unit", "Confirm a compatible base unit; counts cannot be converted to weight without evidence");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Clarify quantity";
      ask(/case|pack/i.test(m) ? "pack" : /unit/i.test(m) ? "unit" : "quantity", m);
    }
  }
  if (i.operation === "correction") {
    const target = ledger.events.find(e => e.id === i.correctsEventId);
    if (!target) ask("correction-target", "Identify the committed update being corrected");
    else if (target.effect === "forecast") ask("correction-target", "Forecasts are not corrected in place; record a new forecast");
    else if (target.lotId !== i.lotId) ask("correction-target", "Corrected update belongs to a different lot");
    else if (![...inForce(inventory(ledger, target.lotId)).values()].some(s => s.id === target.id)) ask("correction-target", "A newer correction already replaced that update; correct the one in force");
  } else if (i.correctsEventId !== undefined) ask("correction-target", "Only a correction may reference an earlier update");
  return questions.length ? { hash: digest(p), questions } : { hash: digest(p), questions, change: outcome(ledger, p) };
}

// Approval is local review provenance, not authentication. Span checks do not
// prove semantic correctness; the coordinator must review meaning. The version
// recheck here is the compare-and-swap a persistent store must perform atomically.
export function commitUpdate(ledger: Ledger, p: UpdateProposal, approval: Approval): Ledger {
  const review = reviewUpdate(ledger, p);
  if (review.questions.length) throw new Error(`Clarification required: ${review.questions.map(q => q.question).join("; ")}`);
  if (typeof approval?.reviewer !== "string" || !approval.reviewer.trim() || approval.reviewer.length > NAME_MAX || approval.reviewHash !== review.hash) throw new Error("Named approval of exact proposal required");
  const { effect, lotId, before: lotBefore, after: lotAfter } = review.change!, id = `event-${ledger.events.length + 1}`;
  const snapshot = structuredClone(ledger.snapshot), lot = snapshot.lots.find(l => l.id === lotId)!;
  if (effect !== "forecast") { lot.quantity = lotAfter; snapshot.version += 1; validateSnapshot(snapshot); }
  const event: UpdateEvent = { id, proposal: p, approval, effect, lotId, lotBefore, lotAfter, beforeHash: snapshotHash(ledger.snapshot), afterHash: snapshotHash(snapshot) };
  const forecasts = effect === "forecast" ? [...ledger.forecasts, { eventId: id, lotId, ...normalize(p.interpretation.quantity!), deliveryOn: lot.deliveryOn }] : ledger.forecasts;
  return structuredClone({ version: ledger.version + 1, snapshot, events: [...ledger.events, event], forecasts, records: ledger.records, ...(ledger.commitments ? { commitments: ledger.commitments } : {}) });
}
