import { digest, snapshotHash, validateSnapshot, type Snapshot } from "./planner.ts";
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
  // appliedFrom is the quantity the effect started from; corrections inherit their target's.
  lotBefore: Quantity; appliedFrom: Quantity; lotAfter: Quantity; beforeHash: string; afterHash: string;
};
export type Forecast = { eventId: string; lotId: string; amount: number; unit: BaseUnit; deliveryOn: string };
// Forecasts sit beside, never inside, the snapshot the planner allocates from.
export type Ledger = { version: number; snapshot: Snapshot; events: UpdateEvent[]; forecasts: Forecast[] };

const OPERATIONS: Operation[] = ["replace-total", "add-quantity", "correction", "forecast", "unresolved"];
const FIELDS: Field[] = ["operation", "lot", "quantity", "unit", "pack", "grade", "date", "correction-target"];

export function createLedger(s: Snapshot): Ledger {
  validateSnapshot(s);
  return { version: 0, snapshot: structuredClone(s), events: [], forecasts: [] };
}
export function locate(text: string, quote: string): Span {
  const start = quote ? text.indexOf(quote) : -1;
  if (start < 0) throw new Error("Literal source evidence required");
  return { start, end: start + quote.length };
}

function source(s: Source): void {
  if (!s || typeof s.id !== "string" || !s.id.trim() || s.id.length > 160 || typeof s.growerId !== "string" || !s.growerId.trim() || s.growerId.length > 160 ||
      typeof s.text !== "string" || !s.text.trim() || s.text.length > 8000) throw new Error("Valid source record required");
  integer(s.revision, "source revision");
}
function spans(text: string, xs: Span[]): void {
  if (!Array.isArray(xs) || xs.length === 0 || xs.length > 20 || xs.some(x => !Number.isSafeInteger(x?.start) || !Number.isSafeInteger(x?.end) ||
      x.start < 0 || x.end > text.length || x.start >= x.end || !text.slice(x.start, x.end).trim())) throw new Error("Literal source evidence required");
}
const optional = (v: unknown) => v === undefined || (typeof v === "string" && !!v.trim() && v.length <= 160);
const latest = (l: Ledger, lotId: string) => l.events.findLast(e => e.lotId === lotId && e.effect !== "forecast");

// Throws for malformed, duplicate or stale input; returns questions for anything a
// person must still resolve. Any question blocks commit.
export function reviewUpdate(ledger: Ledger, p: UpdateProposal): { hash: string; questions: Question[] } {
  validateSnapshot(ledger.snapshot);
  if (typeof p?.id !== "string" || !p.id.trim() || p.id.length > 160) throw new Error("Proposal identity required");
  source(p.source);
  const i = p.interpretation;
  if (!i || !OPERATIONS.includes(i.operation) || !Array.isArray(i.unresolved) || i.unresolved.some(f => !FIELDS.includes(f)) ||
      ![i.lotId, i.grade, i.deliveryOn, i.correctsEventId].every(optional)) throw new Error("Invalid interpretation");
  spans(p.source.text, i.spans);
  if (!Array.isArray(p.clarifications) || p.clarifications.length > 20) throw new Error("Bounded clarification list required");
  for (const c of p.clarifications) {
    if (!FIELDS.includes(c?.field) || typeof c.question !== "string" || !c.question.trim() || c.question.length > 500) throw new Error("Invalid clarification");
    if (c.answer !== undefined) { source(c.answer.source); spans(c.answer.source.text, [c.answer.span]); }
  }
  // One message may update several lots, but each source revision changes a lot at most once.
  for (const e of ledger.events) {
    const s = e.proposal.source;
    if (s.id !== p.source.id) continue;
    if (s.revision === p.source.revision && digest(s) !== digest(p.source)) throw new Error("Source revision conflict; committed text differs");
    if (e.lotId !== i.lotId) continue;
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
    else if (latest(ledger, target.lotId) !== target) ask("correction-target", "Later updates changed this lot; state the current total instead");
  } else if (i.correctsEventId !== undefined) ask("correction-target", "Only a correction may reference an earlier update");
  return { hash: digest(p), questions };
}

// Approval is local review provenance, not authentication. Span checks do not
// prove semantic correctness; the coordinator must review meaning. The version
// recheck here is the compare-and-swap a persistent store must perform atomically.
export function commitUpdate(ledger: Ledger, p: UpdateProposal, approval: Approval): Ledger {
  const review = reviewUpdate(ledger, p);
  if (review.questions.length) throw new Error(`Clarification required: ${review.questions.map(q => q.question).join("; ")}`);
  if (typeof approval?.reviewer !== "string" || !approval.reviewer.trim() || approval.reviewer.length > 160 || approval.reviewHash !== review.hash) throw new Error("Named approval of exact proposal required");
  const i = p.interpretation, snapshot = structuredClone(ledger.snapshot), lot = snapshot.lots.find(l => l.id === i.lotId)!;
  const target = i.operation === "correction" ? ledger.events.find(e => e.id === i.correctsEventId)! : undefined;
  const effect = target ? target.effect : i.operation as Effect, change = normalize(i.quantity!);
  // A correction re-applies the corrected update's operation from that update's starting point.
  const lotBefore = structuredClone(lot.quantity), appliedFrom = target ? target.appliedFrom : lotBefore;
  const lotAfter: Quantity = effect === "replace-total" ? structuredClone(i.quantity!)
    : effect === "add-quantity" ? { amount: normalize(appliedFrom).amount + change.amount, unit: change.unit } : lotBefore;
  const id = `event-${ledger.events.length + 1}`;
  if (effect !== "forecast") { lot.quantity = lotAfter; snapshot.version += 1; validateSnapshot(snapshot); }
  const event: UpdateEvent = { id, proposal: p, approval, effect, lotId: lot.id, lotBefore, appliedFrom, lotAfter, beforeHash: snapshotHash(ledger.snapshot), afterHash: snapshotHash(snapshot) };
  const forecasts = effect === "forecast" ? [...ledger.forecasts, { eventId: id, lotId: lot.id, ...change, deliveryOn: lot.deliveryOn }] : ledger.forecasts;
  return structuredClone({ version: ledger.version + 1, snapshot, events: [...ledger.events, event], forecasts });
}
