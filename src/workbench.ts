import { amendFromMessage, applyAnswers, type Answer, type Correction } from "./answers.ts";
import { snapshotHash, type Plan, type Snapshot } from "./planner.ts";
import { normalize, type BaseUnit, type Quantity } from "./quantity.ts";
import { NAME_MAX, HUB_ZONE } from "./hub.ts";
import { BUYERS, CONTACTS } from "./demo.ts";
import { planOf } from "./commitments.ts";
import type { OutboxMessage, Resolution } from "./resolve.ts";
import { commitUpdate, locate, reviewUpdate, validateSource, type Change, type Field, type Ledger, type Operation, type Question, type Source, type UpdateProposal } from "./updates.ts";

// The coordinator workbench: an inbox of grower messages over the update ledger. Every
// action is a pure function from one state to the next, and every decision is kept in
// the item's history. Inventory changes only through commitUpdate, so the review rules
// (blocking questions, exact review hash, stale-inventory checks) are the ledger's own.
export type ItemState = "open" | "pending" | "returned" | "dismissed" | "approved";
export type DecisionKind = "received" | "interpreted" | "asked" | "replied" | "corrected" | "lot-confirmed" | "left-pending" | "returned" | "dismissed" | "refreshed" | "approved";
// by: for a reply, who or what read it ("coordinator" when the coordinator entered the answer).
export type Decision = { at: string; actor: string; kind: DecisionKind; note?: string; by?: string; reviewHash?: string; eventId?: string; corrections?: Correction[] };
export type InboxItem = {
  id: string; receivedAt: string; source: Source; replies: Source[]; state: ItemState;
  proposal?: UpdateProposal; interpretedBy?: string; eventId?: string; decisions: Decision[];
  requestId?: string; // the resolution whose request this message answers
  // The review questions the coordinator last saw, from the latest decision on this item.
  // A stale item whose rebased review asks nothing new is checked again without a refresh.
  lastQuestions?: string[];
  lastChange?: { before: number; after: number; unit: BaseUnit }; // the change the coordinator last saw, in base units
};
// calls counts logged calls, so each gets a fresh call-n source ID.
export type Workbench = { ledger: Ledger; items: InboxItem[]; resolutions: Resolution[]; outbox: OutboxMessage[]; calls: number };

// actor: a person's name; label: who or what read a message (a model reading's label).
const LIMIT = { items: 500, decisions: 200, note: 500, actor: NAME_MAX, label: 160 };
export function text(v: unknown, max: number, what: string): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`${what} required (at most ${max} characters)`);
  return v.trim();
}
export function stamp(at: string): string {
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new Error("Valid timestamp required");
  return new Date(at).toISOString();
}
function item(w: Workbench, id: string): InboxItem {
  const found = w.items.find(i => i.id === id);
  if (!found) throw new Error("Unknown inbox item");
  return found;
}
// Applies a change to a copy, so a thrown check leaves the caller's state untouched.
function update(w: Workbench, id: string, f: (i: InboxItem, l: Ledger) => void, d: Omit<Decision, "at" | "actor">, actor: string, at: string): Workbench {
  const next = structuredClone(w), i = item(next, id);
  const decision: Decision = { at: stamp(at), actor: text(actor, LIMIT.actor, "Actor name"), ...d };
  if (i.decisions.length >= LIMIT.decisions) throw new Error("Decision history is full for this item");
  f(i, next.ledger);
  i.decisions.push(decision);
  seen(i, next.ledger);
  return next;
}
const closed = (i: InboxItem) => i.state === "approved" || i.state === "dismissed";
// Records what the review shows after a decision. A stale item is shown its rebased review
// (see preview), so a decision that does not refresh it records that one.
function seen(i: InboxItem, l: Ledger): void {
  delete i.lastQuestions; delete i.lastChange;
  if (!i.proposal || closed(i)) return;
  try {
    const r = reviewUpdate(l, i.proposal.baseVersion === l.version ? i.proposal : rebased(l, i.proposal));
    i.lastQuestions = r.questions.map(q => q.question);
    if (r.change) { const b = normalize(r.change.before), a = normalize(r.change.after); i.lastChange = { before: b.amount, after: a.amount, unit: b.unit }; }
  } catch { /* nothing reviewable was shown */ }
}
function editable(i: InboxItem): UpdateProposal {
  if (closed(i)) throw new Error(`This update is ${i.state}; it can no longer change`);
  if (!i.proposal) throw new Error("No interpretation yet; interpret the message first");
  return i.proposal;
}

export function createWorkbench(ledger: Ledger): Workbench { return structuredClone({ ledger, items: [], resolutions: [], outbox: [], calls: 0 }); }

export function receive(w: Workbench, source: Source, at: string): Workbench {
  validateSource(source);
  if (w.items.length >= LIMIT.items) throw new Error("Inbox is full");
  if (w.items.some(i => i.source.id === source.id && i.source.revision === source.revision)) throw new Error("This message revision is already in the inbox");
  const id = `item-${w.items.length + 1}`, receivedAt = stamp(at);
  return structuredClone({ ...w, items: [...w.items, { id, receivedAt, source, replies: [], state: "open", decisions: [{ at: receivedAt, actor: source.growerId, kind: "received" }] } as InboxItem] });
}

// A proposal from a saved or live model reading, or written by hand. It must read the
// item's own message; review checks everything else.
export function interpret(w: Workbench, id: string, proposal: UpdateProposal, by: string, actor: string, at: string): Workbench {
  return update(w, id, (i, l) => {
    if (closed(i)) throw new Error(`This update is ${i.state}; it can no longer change`);
    if (JSON.stringify(proposal?.source) !== JSON.stringify(i.source)) throw new Error("The interpretation must read this item's message");
    reviewUpdate(l, proposal);
    i.proposal = structuredClone(proposal); i.interpretedBy = text(by, LIMIT.label, "Interpreter name"); i.state = "open";
  }, { kind: "interpreted", note: by }, actor, at);
}

// A coordinator question to the grower. It blocks approval until a reply answers it.
export function ask(w: Workbench, id: string, field: Field, question: string, actor: string, at: string): Workbench {
  const q = text(question, LIMIT.note, "Question");
  w = refreshIfStale(w, id, actor, at);
  return update(w, id, i => { const p = editable(i); p.clarifications.push({ field, question: q }); reviewUpdate(w.ledger, p); }, { kind: "asked", note: `${field}: ${q}` }, actor, at);
}

// A grower reply with answers the coordinator entered.
export function reply(w: Workbench, id: string, source: Source, answers: Answer[], unclear: Field[], actor: string, at: string): Workbench {
  return takeReply(w, id, source, (l, p) => applyAnswers(l, p, source, answers, unclear), "coordinator", actor, at);
}
// The coordinator's answers and the approval in one step. The approval is checked against the review
// hash of the state the answers produce, so it approves exactly the change that state previews. When the
// answers leave a question open, or no change can be worked out, only the reply is kept (approved: false).
export function replyAndApprove(w: Workbench, id: string, source: Source, answers: Answer[], unclear: Field[], actor: string, at: string): { next: Workbench; approved: boolean } {
  const replied = reply(w, id, source, answers, unclear, actor, at), p = preview(replied, id);
  if (p.questions.length || p.error || !p.change || !p.reviewHash) return { next: replied, approved: false };
  return { next: approve(replied, id, actor, p.reviewHash, at), approved: true };
}
// A grower reply read by the model: interpretReply has already applied its answers with
// applyAnswers to this item's proposal. Checked again here before it is kept.
export function replyRead(w: Workbench, id: string, source: Source, read: { proposal: UpdateProposal; corrections: Correction[] }, by: string, actor: string, at: string): Workbench {
  return takeReply(w, id, source, (l, p) => {
    if (JSON.stringify(read.proposal.source) !== JSON.stringify(p.source) || read.proposal.baseVersion !== p.baseVersion) throw new Error("The reply reading is for a different version of this update; read it again");
    reviewUpdate(l, read.proposal);
    return read;
  }, by, actor, at);
}
function takeReply(w: Workbench, id: string, source: Source, read: (l: Ledger, p: UpdateProposal) => { proposal: UpdateProposal; corrections: Correction[] }, by: string, actor: string, at: string): Workbench {
  let corrections: Correction[] = [];
  w = refreshIfStale(w, id, actor, at);
  const next = update(w, id, (i, l) => {
    const r = read(l, editable(i));
    i.proposal = structuredClone(r.proposal); corrections = r.corrections;
    if (!i.replies.some(x => x.id === source.id && x.revision === source.revision)) i.replies.push(structuredClone(source));
    if (i.state === "returned" || i.state === "pending") i.state = "open";
  }, { kind: "replied", note: source.text.slice(0, LIMIT.note), by: text(by, LIMIT.label, "Reader") }, actor, at);
  if (corrections.length) next.items.find(i => i.id === id)!.decisions.at(-1)!.corrections = corrections;
  return next;
}

// The coordinator corrects the reading using words already in the message.
export function correct(w: Workbench, id: string, answers: Answer[], actor: string, at: string): Workbench {
  let corrections: Correction[] = [];
  w = refreshIfStale(w, id, actor, at);
  const next = update(w, id, (i, l) => { const r = amendFromMessage(l, editable(i), answers); i.proposal = r.proposal; corrections = r.corrections; },
    { kind: "corrected", note: answers.map(a => `${a.field}: "${a.quote}"`).join("; ").slice(0, LIMIT.note) }, actor, at);
  next.items.find(i => i.id === id)!.decisions.at(-1)!.corrections = corrections;
  return next;
}

// The coordinator writes the reading of a message themselves. It goes through the same
// correction path as any other reading: each value is backed by a quote, and a call note
// (the coordinator's own words) is its own evidence when no quote is given. The usual
// review and named approval follow.
export const BY_HAND = "Entered by hand";
export type HandReading = { operation: Exclude<Operation, "unresolved">; lotId: string; quantity: Quantity; grade: string; deliveryOn: string; correctsEventId?: string; quote?: string };
export function readByHand(w: Workbench, id: string, r: HandReading, actor: string, at: string): Workbench {
  const i = item(w, id), source = i.source, given = typeof r?.quote === "string" ? r.quote.trim() : "";
  if (!given && !source.id.startsWith("call-")) throw new Error("Literal source evidence required");
  const quote = given || source.text.trim().slice(0, 500);
  let next = w;
  if (!i.proposal) {
    const blank: UpdateProposal = { id: `hand-${source.id}-${source.revision}`, baseVersion: w.ledger.version, baseHash: snapshotHash(w.ledger.snapshot), source: structuredClone(source),
      interpretation: { operation: "unresolved", unresolved: [], spans: [locate(source.text, quote)] }, clarifications: [] };
    next = interpret(w, id, blank, BY_HAND, actor, at);
  }
  const answers: Answer[] = [{ field: "operation", quote, value: r.operation }, { field: "lot", quote, value: r.lotId }, { field: "quantity", quote, value: r.quantity },
    { field: "grade", quote, value: r.grade }, { field: "date", quote, value: r.deliveryOn }];
  if (r.correctsEventId) answers.push({ field: "correction-target", quote, value: r.correctsEventId });
  return correct(next, id, answers, actor, at);
}

// The coordinator's reading and the approval in one step ("Save and approve"). Every value is in the form the
// coordinator submitted, so nothing hidden is approved: the approval is checked against the review hash of
// the state the reading produces, exactly the change that state previews. When the reading leaves a question
// open, or no change can be worked out, only the reading is kept (approved: false). It does not rebase.
export function readByHandAndApprove(w: Workbench, id: string, r: HandReading, actor: string, at: string): { next: Workbench; approved: boolean } {
  const saved = readByHand(w, id, r, actor, at), p = preview(saved, id);
  if (p.questions.length || p.error || p.needsRefresh || !p.change || !p.reviewHash) return { next: saved, approved: false };
  return { next: approve(saved, id, actor, p.reviewHash, at), approved: true };
}

// Values found in a message, to prefill the hand-entry form. A reading already on the item
// wins; otherwise the words are searched, and the lot's own grade and day fill the rest.
export type HandSuggestion = { operation?: Exclude<Operation, "unresolved">; lotId?: string; quantity?: Quantity; grade?: string; deliveryOn?: string };
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function suggestReading(w: Workbench, id: string): HandSuggestion {
  const i = item(w, id), cur = i.proposal?.interpretation, t = i.source.text.toLowerCase(), s = w.ledger.snapshot;
  const out: HandSuggestion = {};
  if (cur && cur.operation !== "unresolved") out.operation = cur.operation;
  else if (/\b(actually|correct(ion|ing)?|mistake|meant)\b/.test(t)) out.operation = "correction";
  else if (/\b(might|maybe|may have|could|expect(ing)?|hoping|forecast)\b/.test(t)) out.operation = "forecast";
  else if (/\b(another|more|extra|add(ing|ed)?|additional)\b/.test(t)) out.operation = "add-quantity";
  else if (/\b(only|total|now (have|got)|down to|replac\w*|whole lot)\b/.test(t)) out.operation = "replace-total";
  const mine = s.lots.filter(l => l.growerId === i.source.growerId), named = mine.filter(l => t.includes(l.product.toLowerCase()));
  const lot = s.lots.find(l => l.id === cur?.lotId) ?? (named.length === 1 ? named[0] : named.length === 0 && mine.length === 1 ? mine[0] : undefined);
  if (lot) { out.lotId = lot.id; out.grade = cur?.grade ?? lot.grade; out.deliveryOn = cur?.deliveryOn ?? lot.deliveryOn; }
  else { if (cur?.grade) out.grade = cur.grade; if (cur?.deliveryOn) out.deliveryOn = cur.deliveryOn; }
  if (cur?.quantity) out.quantity = structuredClone(cur.quantity);
  else {
    const m = t.match(new RegExp(`\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s*(kg|kilos?|lbs?|pounds?|g|grams?|each|cases?)\\b`));
    if (m) {
      const u = m[2], unit = u.startsWith("case") ? "case" : u.startsWith("k") ? "kg" : u.startsWith("l") || u.startsWith("p") ? "lb" : u.startsWith("g") ? "g" : "each";
      out.quantity = { amount: /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]], unit };
    }
  }
  return out;
}

// Orders this approval left shorter than before, with how much shorter. Worked out by
// putting the lot back to what it was before the approval's change.
export type MadeShort = { orderId: string; unit: BaseUnit; short: number; added: number };
export function madeShort(w: Workbench, id: string): MadeShort[] {
  const e = item(w, id).eventId ? w.ledger.events.find(x => x.id === item(w, id).eventId) : undefined;
  if (!e || e.effect === "forecast") return [];
  const now = planOf(w.ledger), s: Snapshot = structuredClone(w.ledger.snapshot);
  s.lots.find(l => l.id === e.lotId)!.quantity = structuredClone(e.lotBefore);
  const was = planOf({ ...w.ledger, snapshot: s });
  return now.unfilled.flatMap(u => { const before = was.unfilled.find(x => x.orderId === u.orderId)?.amount ?? 0; return u.amount > before ? [{ orderId: u.orderId, unit: u.unit, short: u.amount, added: u.amount - before }] : []; })
    .sort((a, b) => a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0);
}

export function confirmLot(w: Workbench, id: string, actor: string, at: string): Workbench {
  return update(w, id, (i, l) => {
    const lotId = editable(i).interpretation.lotId;
    if (!lotId || !l.snapshot.lots.some(x => x.id === lotId && x.growerId === i.source.growerId)) throw new Error("No lot of this grower to confirm; correct the lot first");
  }, { kind: "lot-confirmed", note: editable(item(w, id)).interpretation.lotId }, actor, at);
}

export function leavePending(w: Workbench, id: string, note: string, actor: string, at: string): Workbench {
  return update(w, id, i => { editable(i); i.state = "pending"; }, { kind: "left-pending", note: text(note, LIMIT.note, "Note") }, actor, at);
}
export function returnForClarification(w: Workbench, id: string, note: string, actor: string, at: string): Workbench {
  return update(w, id, i => { if (closed(i)) throw new Error(`This update is ${i.state}; it can no longer change`); i.state = "returned"; }, { kind: "returned", note: text(note, LIMIT.note, "What the grower needs to clarify") }, actor, at);
}
export function dismiss(w: Workbench, id: string, reason: string, actor: string, at: string): Workbench {
  return update(w, id, i => { if (closed(i)) throw new Error(`This update is ${i.state}; it can no longer change`); i.state = "dismissed"; }, { kind: "dismissed", note: text(reason, LIMIT.note, "Reason") }, actor, at);
}

// Whether the rebased review can be worked out at all; one that cannot stays stale.
function refreshable(l: Ledger, p: UpdateProposal): boolean {
  try { reviewUpdate(l, rebased(l, p)); return true; } catch { return false; }
}
// A copy of the proposal based on the current ledger: what refresh() would review.
function rebased(l: Ledger, p: UpdateProposal): UpdateProposal {
  return { ...structuredClone(p), baseVersion: l.version, baseHash: snapshotHash(l.snapshot) };
}

// Inventory moved since the reading: rebase onto the current ledger. The review hash
// changes with the base, so any earlier approval no longer matches.
export function refresh(w: Workbench, id: string, actor: string, at: string): Workbench {
  return update(w, id, (i, l) => {
    const p = editable(i);
    if (p.baseVersion === l.version) throw new Error("Already reviewed against the current inventory");
    Object.assign(p, rebased(l, p));
    reviewUpdate(l, p);
  }, { kind: "refreshed" }, actor, at);
}

// Supply moved, so a reply, answer, question or correction is applied to the rebased
// reading: the refresh is recorded first, by the same coordinator, in the same change.
export function refreshIfStale(w: Workbench, id: string, actor: string, at: string): Workbench {
  const i = item(w, id);
  return i.proposal && !closed(i) && i.proposal.baseVersion !== w.ledger.version ? refresh(w, id, actor, at) : w;
}

// The open stale items a refresh can bring up to date (a superset of what Refresh all does,
// see needingRefresh). An item whose rebased review can no
// longer be worked out is left as it is; its preview says why.
export function refreshableItems(w: Workbench): string[] {
  return w.items.filter(i => i.proposal && !closed(i) && i.proposal.baseVersion !== w.ledger.version && refreshable(w.ledger, i.proposal)).map(i => i.id);
}
// Of those, the ones whose refreshed review is different from what the coordinator last saw (needsRefresh):
// a new question, or a reading that no longer applies. An item that is only quietly checked again against
// moved supply is not here, so the page offers "Refresh all" only when something actually needs it.
export function needingRefresh(w: Workbench): string[] {
  return refreshableItems(w).filter(id => preview(w, id).needsRefresh);
}
// One refresh decision per item needingRefresh names: exactly the number the page shows.
export function refreshAll(w: Workbench, actor: string, at: string): Workbench {
  text(actor, LIMIT.actor, "Actor name"); stamp(at);
  const ids = needingRefresh(w);
  if (!ids.length) throw new Error("Nothing needs a refresh");
  return ids.reduce((next, id) => refresh(next, id, actor, at), w);
}

// Approves the review the coordinator was shown. A stale item was shown its rebased
// review (preview), so it is refreshed and approved in one change; the hash must match
// that rebased review, and a review that differs from it is refused.
export function refreshAndApprove(w: Workbench, id: string, reviewer: string, reviewHash: string, at: string): Workbench {
  return approve(refreshIfStale(w, id, reviewer, at), id, reviewer, reviewHash, at);
}

export function approve(w: Workbench, id: string, reviewer: string, reviewHash: string, at: string): Workbench {
  let eventId = "";
  const next = update(w, id, (i, l) => {
    const committed = commitUpdate(l, editable(i), { reviewer: text(reviewer, LIMIT.actor, "Reviewer name"), reviewHash });
    Object.assign(l, committed);
    eventId = committed.events.at(-1)!.id;
    i.state = "approved"; i.eventId = eventId;
  }, { kind: "approved", reviewHash }, reviewer, at);
  const d = next.items.find(i => i.id === id)!.decisions.at(-1)!;
  d.eventId = eventId;
  return next;
}

// What approving this item would do. The supply change is what approval commits; the
// allocation difference is a proposal the coordinator acts on separately.
export type OrderImpact = { orderId: string; unit: BaseUnit; requested: number; before: { direct: number; substitute: number; short: number }; after: { direct: number; substitute: number; short: number } };
// stale: supply moved since the reading, and the review shown is the rebased one, worked
// out read-only. needsRefresh: that rebased review differs from what the coordinator last
// saw (a new question, or a reading that no longer applies), so it is not shown as normal.
// moved: for a stale item, the lot amount the change starts from (or its direction) is not
// what the coordinator last saw; was and now are the starting amounts in base units.
export type Preview = {
  stale: boolean; needsRefresh: boolean; moved?: { was: number; now: number; unit: BaseUnit }; reviewHash?: string; questions: Question[]; change?: Change; error?: string;
  orders: OrderImpact[]; unallocated: { lotId: string; unit: BaseUnit; before: number; after: number }[];
};
function fill(plan: Plan, orderId: string) {
  const of = (kind: string) => plan.allocations.filter(a => a.orderId === orderId && a.kind === kind).reduce((n, a) => n + a.amount, 0);
  return { direct: of("requested"), substitute: of("approved-substitution"), short: plan.unfilled.find(u => u.orderId === orderId)?.amount ?? 0 };
}
export function preview(w: Workbench, id: string): Preview {
  const i = item(w, id), l = w.ledger, before = planOf(l);
  let after = before, base: Omit<Preview, "orders" | "unallocated"> = { stale: false, needsRefresh: false, questions: [] };
  if (i.proposal && !closed(i)) {
    const stale = i.proposal.baseVersion !== l.version, saw = new Set(i.lastQuestions ?? []);
    try {
      const r = reviewUpdate(l, stale ? rebased(l, i.proposal) : i.proposal);
      base = { stale, needsRefresh: stale && r.questions.some(q => !saw.has(q.question)), reviewHash: r.hash, questions: r.questions, change: r.change };
      const last = i.lastChange, b = r.change && normalize(r.change.before), a = r.change && normalize(r.change.after);
      if (stale && last && b && a && b.unit === last.unit && (b.amount !== last.before || Math.sign(a.amount - b.amount) !== Math.sign(last.after - last.before)))
        base.moved = { was: last.before, now: b.amount, unit: b.unit };
      if (r.change && r.change.effect !== "forecast") {
        const s: Snapshot = structuredClone(l.snapshot);
        s.lots.find(x => x.id === r.change!.lotId)!.quantity = r.change.after;
        after = planOf({ ...l, snapshot: s });
      }
    } catch (e) { base = { stale, needsRefresh: stale, questions: [], error: e instanceof Error ? e.message : "Review failed" }; }
  }
  const lots = new Map([...before.unallocated, ...after.unallocated].map(u => [u.lotId, u.unit]));
  return { ...base,
    orders: l.snapshot.orders.map(o => ({ orderId: o.id, unit: normalize(o.quantity).unit, requested: normalize(o.quantity).amount, before: fill(before, o.id), after: fill(after, o.id) })),
    unallocated: [...lots].map(([lotId, unit]) => ({ lotId, unit, before: before.unallocated.find(u => u.lotId === lotId)?.amount ?? 0, after: after.unallocated.find(u => u.lotId === lotId)?.amount ?? 0 })) };
}

// The newest decision anywhere in the workbench, said plainly for the "changed in another
// tab" message, for example "Sam approved Alder Creek Farm's update at 8:03 AM".
const WORDS: Record<DecisionKind, string> = {
  received: "received", interpreted: "read", asked: "asked about", replied: "recorded a reply to", corrected: "corrected", "lot-confirmed": "confirmed the lot for",
  "left-pending": "left pending", returned: "returned", dismissed: "dismissed", refreshed: "refreshed", approved: "approved"
};
const RESOLVED: Record<string, string> = {
  drafted: "drafted a message about", redrafted: "redrafted a message about", edited: "edited a message about", confirmed: "confirmed a message about", discarded: "discarded a message about",
  sent: "sent a message about", "reply-recorded": "recorded a reply about", "grower-replied": "recorded a grower reply about", "supply-recorded": "recorded supply for"
};
export function latestChange(w: Workbench, names: { grower: (id: string) => string; buyer: (id: string) => string } = {
  grower: id => CONTACTS.find(c => c.id === id)?.name ?? id, buyer: id => BUYERS[id] ?? id
}): string | undefined {
  const buyerOf = (orderId: string) => { const o = w.ledger.snapshot.orders.find(x => x.id === orderId); return o ? names.buyer(o.buyerId) : orderId; };
  const found: { at: string; line: string }[] = [];
  for (const i of w.items) for (const d of i.decisions) found.push({ at: d.at, line: `${d.actor} ${WORDS[d.kind] ?? d.kind} ${names.grower(i.source.growerId)}'s update` });
  for (const r of w.resolutions) for (const d of r.decisions) found.push({ at: d.at, line: `${d.actor} ${RESOLVED[d.kind] ?? d.kind} ${buyerOf(r.orderId)}'s order` });
  for (const e of w.ledger.commitments?.log ?? []) {
    if (e.kind === "confirmed") found.push({ at: e.at, line: `${e.by} confirmed the plan` });
    else if (e.kind === "cut") found.push({ at: e.at, line: `${e.by} decided who takes the cut` });
    else found.push({ at: e.at, line: `${e.by} marked ${buyerOf(e.orderId)}'s order ${e.stage === "packed" ? "packed" : "handed off"}` });
  }
  if (!found.length) return undefined;
  // Later entries win a tie, since each list is in the order things happened.
  const last = found.reduce((a, b) => Date.parse(b.at) >= Date.parse(a.at) ? b : a);
  const when = new Date(last.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: HUB_ZONE });
  return `${last.line} at ${when}`;
}
