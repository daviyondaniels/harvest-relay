import type { Contact } from "./demo.ts";
import type { Draft } from "./draft.ts";
import { checkDraft, type Check, type Confirm, type MessageFacts } from "./messages.ts";
import { NAME_MAX, hubDay } from "./hub.ts";
import { normalize } from "./quantity.ts";
import { acceptSubstitute, addLot, options, shortages, type Option } from "./orders.ts";
import { planOf } from "./commitments.ts";
import type { Evidence, Source } from "./updates.ts";
import { receive, stamp, text, type Workbench } from "./workbench.ts";

// Resolving a short order: ask a grower or source for more, offer the buyer a substitute,
// or tell the buyer it will be short (docs/EVIDENCE.md E4). Each is drafted, sent through
// the outbox, and closed by a recorded reply. Pure functions, clone-then-mutate as in
// workbench.ts, so a thrown check leaves the caller's state unchanged.
export type ResolutionDecision = { at: string; actor: string; kind: "drafted" | "redrafted" | "edited" | "confirmed" | "discarded" | "sent" | "reply-recorded" | "grower-replied" | "supply-recorded"; note?: string; text?: string };
export type Resolution = {
  id: string; orderId: string; kind: Option["kind"]; option: Option;
  facts: MessageFacts; text: string; draftedBy: string; author: Author; check: Check; checkedOn?: string; fallback?: string;
  status: "drafted" | "sent" | "accepted" | "declined" | "discarded";
  causeItemId?: string; // the workbench item whose approval last lowered a lot of this product before the resolution started
  // Who confirmed the check's confirmation items, when, and which (tokens); any edit or redraft clears it.
  confirmation?: { by: string; at: string; items: string[] };
  messageId?: string; reply?: { id: string; channel: "text" | "call" | "recorded"; text: string; quote: string }; linkedItemId?: string;
  decisions: ResolutionDecision[];
};
// Who wrote the current text, as data; draftedBy is the display name only.
export type Author = "template" | "model-recorded" | "model-live" | "coordinator";
const authorOf = (d: Draft): Author => d?.author === "model" ? (d.recorded ? "model-recorded" : "model-live") : "template";
export type OutboxMessage = { id: string; resolutionId: string; to: MessageFacts["to"]; text: string; draftedBy: string; sentBy: string; sentAt: string };
export type OrderStatus = "covered" | "short" | "resolving" | "buyer-told" | "substitute-agreed";
type Reply = { channel: "text" | "call" | "recorded"; text: string; quote?: string };

const LIMIT = { resolutions: 200, outbox: 500, note: 500, message: 480, decisions: 200, actor: NAME_MAX, label: 160 };
const KIND = { "ask-grower": "request", "offer-substitute": "offer", "notify-short": "notice" } as const;

function order(w: Workbench, orderId: string) {
  const o = w.ledger.snapshot.orders.find(x => x.id === orderId);
  if (!o) throw new Error("Unknown order");
  return o;
}
function resolution(w: Workbench, id: string): Resolution {
  const r = w.resolutions.find(x => x.id === id);
  if (!r) throw new Error("Unknown resolution");
  return r;
}
const known = (w: Workbench) => [...new Set([...w.ledger.snapshot.lots, ...w.ledger.snapshot.orders].map(x => x.product))];
// The day the action happens, for relative days in the checker ("tmrw" is judged on the day it is written).
const dayOf = (at: string) => hubDay(stamp(at));
const amountOf = (o: Option) => o.kind === "offer-substitute" ? o.covers : o.amount;
// Same option: an ask by contact (and lot), an offer by product and grade, a notice by kind.
function sameOption(a: Option, b: Option): boolean {
  if (a.kind === "ask-grower" && b.kind === "ask-grower") return a.contactId === b.contactId && a.hasLot === b.hasLot && (!a.hasLot || !b.hasLot || a.lotId === b.lotId);
  if (a.kind === "offer-substitute" && b.kind === "offer-substitute") return a.product === b.product && a.grade === b.grade;
  return a.kind === "notify-short" && b.kind === "notify-short";
}
// The option as options() offers it now for the real contact roster, if it still does.
const liveOption = (w: Workbench, orderId: string, option: Option, contacts: Contact[]) => options(w.ledger, orderId, contacts).find(x => sameOption(x, option));
function update(w: Workbench, id: string, f: (r: Resolution, w: Workbench) => void, d: Omit<ResolutionDecision, "at" | "actor">, actor: string, at: string): Workbench {
  const next = structuredClone(w), r = resolution(next, id);
  const decision: ResolutionDecision = { at: stamp(at), actor: text(actor, LIMIT.actor, "Actor name"), ...d };
  if (r.decisions.length >= LIMIT.decisions) throw new Error("Decision history is full for this resolution");
  f(r, next);
  r.decisions.push(decision);
  return next;
}
function drafted(r: Resolution): void {
  if (r.status !== "drafted") throw new Error(`This message was already ${r.status}; it can no longer change`);
}
function message(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new Error("Message text is empty");
  if (v.length > LIMIT.message) throw new Error(`Message text is over ${LIMIT.message} characters`);
  return v;
}
// A text reply needs a literal quote; a call has no words to quote, so the coordinator's
// note is the evidence and its whole text is the quote (E9).
function evidence(w: Workbench, reply: Reply): NonNullable<Resolution["reply"]> & Evidence {
  const id = `in-${w.resolutions.filter(r => r.reply).length + 1}`;
  if (reply?.channel === "call") {
    const note = text(reply.text, LIMIT.note, "Call note");
    return { id, messageId: id, channel: "call", text: note, quote: note };
  }
  // No channel picked: only the fact that the coordinator recorded the answer, claiming neither a call nor a text.
  if (reply?.channel === "recorded") { const note = text(reply.text, LIMIT.note, "Answer note"); return { id, messageId: id, channel: "recorded", text: note, quote: note }; }
  if (reply?.channel !== "text") throw new Error("Reply channel must be text, call or recorded");
  const said = text(reply.text, LIMIT.note, "Reply text");
  if (typeof reply.quote !== "string" || !reply.quote.trim() || !said.includes(reply.quote.trim())) throw new Error("A quote from the reply text is required");
  return { id, messageId: id, channel: "text", text: said, quote: reply.quote.trim() };
}
// The words of a pasted text that say yes or no, for the one-tap answer: the sentence holding the
// word, copied exactly. Undefined when the text has no such word. When it holds the opposite word as
// well, the pressed word wins only if it starts a sentence of its own ("Yes, no problem." is a yes) and
// the opposite word is nowhere else but in "no problem"-style phrases; otherwise the coordinator picks
// the words. recordBuyerReply still checks the quote is in the text.
const NO_PROBLEM = /\bno (problem|problems|worries|trouble|bother|issue|issues)\b/gi;
export function quoteFor(text: string, accept: boolean): string | undefined {
  if (typeof text !== "string") return undefined;
  const word = new RegExp(`\\b${accept ? "yes" : "no"}\\b`, "i"), other = new RegExp(`\\b${accept ? "no" : "yes"}\\b`, "i");
  const clauses = text.split(/(?<=[.!?\n])/).map(c => c.trim()).filter(Boolean);
  // "No problem" and its kin are never a no: the word is looked for outside them.
  const bare = (c: string) => accept ? c : c.replace(NO_PROBLEM, m => "_".repeat(m.length));
  if (!other.test(text)) return clauses.find(c => word.test(bare(c)))?.slice(0, 500);
  const opens = new RegExp(`^\\W*${accept ? "yes" : "no"}\\b\\s*[,.!?]`, "i");
  const lead = clauses.find(c => opens.test(bare(c)));
  return lead && !other.test(text.replace(accept ? NO_PROBLEM : /(?!)/g, "")) ? lead.slice(0, 500) : undefined;
}
// Sent, and not yet answered: the one place a reply may be recorded.
function awaiting(r: Resolution, what: string): void {
  if (r.status === "accepted" || r.status === "declined" || r.reply || r.linkedItemId) throw new Error(`This ${what} was already answered`);
  if (r.status !== "sent") throw new Error(`This ${what} has not been sent`);
}

export function factsFor(w: Workbench, orderId: string, option: Option, names: Record<string, string>): MessageFacts {
  const o = order(w, orderId), toId = option.kind === "ask-grower" ? option.contactId : o.buyerId, name = names[toId];
  if (typeof name !== "string" || !name.trim()) throw new Error(`No name for ${toId}`);
  return { kind: KIND[option.kind], to: { kind: option.kind === "ask-grower" ? "grower" : "buyer", id: toId, name },
    product: o.product, ...(option.kind === "offer-substitute" ? { substitute: option.product } : {}),
    amount: amountOf(option), unit: option.unit, deliveryOn: o.deliveryOn };
}

// The latest approved item, before `at`, that lowered the confirmed amount of a lot of this product.
function causeOf(w: Workbench, product: string, at: string): string | undefined {
  const lotProduct = new Map(w.ledger.snapshot.lots.map(l => [l.id, l.product]));
  let cause: { id: string; at: string } | undefined;
  for (const e of w.ledger.events) {
    if (e.effect === "forecast" || lotProduct.get(e.lotId) !== product || normalize(e.lotAfter).amount >= normalize(e.lotBefore).amount) continue;
    const item = w.items.find(i => i.eventId === e.id), when = item?.decisions.find(d => d.kind === "approved" && d.eventId === e.id)?.at;
    if (item && when && when <= at && (!cause || when >= cause.at)) cause = { id: item.id, at: when };
  }
  return cause?.id;
}

// Only an option options() offers right now, with facts that say exactly what it says.
export function startResolution(w: Workbench, orderId: string, option: Option, contacts: Contact[], facts: MessageFacts, draft: Draft, actor: string, at: string): Workbench {
  const o = order(w, orderId);
  if (!shortages(w.ledger).some(s => s.orderId === orderId)) throw new Error("This order is not short");
  if (w.resolutions.length >= LIMIT.resolutions) throw new Error("Too many resolutions");
  if (option?.kind === "ask-grower" && !contacts.some(c => c.id === option.contactId)) throw new Error("Unknown contact");
  const live = option && liveOption(w, orderId, option, contacts);
  if (!live) throw new Error("This option is no longer offered for the order");
  // One open offer per substitute: a second could not be accepted once the first is (orders.ts acceptSubstitute).
  if (live.kind === "offer-substitute" && w.resolutions.some(r => r.orderId === orderId && r.option.kind === "offer-substitute" && r.option.product === live.product && isOpen(w, r)))
    throw new Error(`An offer of ${live.product} is already open for this order`);
  if (facts?.amount !== amountOf(live)) throw new Error("The message facts do not match the option's amount");
  const toId = live.kind === "ask-grower" ? live.contactId : o.buyerId;
  if (facts.to?.id !== toId) throw new Error("The message facts name the wrong recipient");
  const expect = factsFor(w, orderId, live, { [toId]: facts.to.name });
  for (const k of ["kind", "product", "substitute", "unit", "deliveryOn"] as const) if (facts[k] !== expect[k]) throw new Error(`The message facts do not match the option (${k})`);
  if (facts.to.kind !== expect.to.kind) throw new Error("The message facts name the wrong recipient");
  const body = message(draft?.text), when = stamp(at), who = text(actor, LIMIT.actor, "Actor name"), by = text(draft.by, LIMIT.label, "Drafter");
  const cause = causeOf(w, o.product, when);
  const r: Resolution = { id: `res-${w.resolutions.length + 1}`, orderId: o.id, kind: live.kind, option: live, facts: structuredClone(expect), ...(cause ? { causeItemId: cause } : {}),
    text: body, draftedBy: by, author: authorOf(draft), check: checkDraft(body, expect, known(w), dayOf(at)), checkedOn: dayOf(at), ...(draft.fallback ? { fallback: text(draft.fallback, LIMIT.note, "Fallback reason") } : {}),
    status: "drafted", decisions: [{ at: when, actor: who, kind: "drafted", note: by }] };
  return structuredClone({ ...w, resolutions: [...w.resolutions, r] });
}

export function redraft(w: Workbench, resId: string, draft: Draft, actor: string, at: string): Workbench {
  return update(w, resId, (r, n) => {
    drafted(r);
    r.text = message(draft?.text); r.draftedBy = text(draft.by, LIMIT.label, "Drafter"); r.author = authorOf(draft); r.check = checkDraft(r.text, r.facts, known(n), dayOf(at)); r.checkedOn = dayOf(at); delete r.confirmation;
    if (draft.fallback) r.fallback = text(draft.fallback, LIMIT.note, "Fallback reason"); else delete r.fallback;
  }, { kind: "redrafted", note: draft?.by }, actor, at);
}

// The coordinator's own words. The checker's problems are kept and shown, not enforced:
// the coordinator decides what to send.
export function editDraft(w: Workbench, resId: string, body: string, actor: string, at: string): Workbench {
  return update(w, resId, (r, n) => {
    drafted(r);
    r.text = message(body); r.draftedBy = text(actor, LIMIT.actor, "Actor name"); r.author = "coordinator"; r.check = checkDraft(r.text, r.facts, known(n), dayOf(at)); r.checkedOn = dayOf(at); delete r.confirmation; delete r.fallback;
  }, { kind: "edited" }, actor, at);
}

// The words a draft must have confirmed before it is sent on `on` (YYYY-MM-DD): those its
// stored check asked about, plus any the same text raises on that day (this week, tmrw...).
export function toConfirm(w: Workbench, r: Resolution, on: string): Confirm[] {
  const all = [...(r.check.confirm ?? []), ...checkDraft(r.text, r.facts, known(w), on).confirm];
  return all.filter((c, n) => all.findIndex(x => x.token === c.token) === n);
}
// A draft can be sent on `on` once every word to confirm that day is confirmed.
export function canSend(w: Workbench, r: Resolution, on: string): boolean {
  return r.status === "drafted" && toConfirm(w, r, on).every(c => !!r.confirmation?.items.includes(c.token));
}
// The coordinator confirms the words the checker asked about. It records who and when; it
// never overrides problems, which stay shown. Any edit or redraft resets it. `shown` is
// the words the page showed: across midnight the list can change, and words the
// coordinator never saw are never confirmed for them.
export function confirmDraft(w: Workbench, resId: string, shown: string[], actor: string, at: string): Workbench {
  return update(w, resId, (r, n) => {
    drafted(r);
    const items = toConfirm(n, r, dayOf(at)).map(c => c.token), saw = new Set(Array.isArray(shown) ? shown : []);
    if (!items.length) throw new Error("There is nothing to confirm in this message");
    if (saw.size !== items.length || items.some(t => !saw.has(t))) throw new Error("The words to confirm have changed. Check them again.");
    r.confirmation = { by: text(actor, LIMIT.actor, "Actor name"), at: stamp(at), items };
  }, { kind: "confirmed" }, actor, at);
}

// A draft that will not be sent. The text stays in the history; the option can be started again.
export function discardDraft(w: Workbench, resId: string, reason: string, actor: string, at: string): Workbench {
  const why = text(reason, LIMIT.note, "Reason");
  return update(w, resId, r => {
    drafted(r);
    r.status = "discarded";
  }, { kind: "discarded", note: why, text: resolution(w, resId).text }, actor, at);
}

// The order may have moved since drafting: send only what is still true. A notice must
// state exactly the current shortfall; more or less would tell the buyer something false.
export function sendMessage(w: Workbench, resId: string, contacts: Contact[], actor: string, at: string): Workbench {
  return update(w, resId, (r, n) => {
    drafted(r);
    // Relative days move: read the text again on the day it is sent. A new problem stops the send
    // whoever wrote it; problems the coordinator already saw still only warn.
    const fresh = checkDraft(r.text, r.facts, known(n), dayOf(at)), seen = new Set(r.check.problems);
    const added = fresh.problems.find(p => !seen.has(p));
    if (added) throw new Error(`This message was checked on ${r.checkedOn ?? dayOf(r.decisions[0].at)}. On ${dayOf(at)} it reads differently: ${added}. Edit it or suggest other wording.`);
    const open = toConfirm(n, r, dayOf(at)).map(c => c.token).filter(t => !r.confirmation?.items.includes(t));
    if (open.length) throw new Error(`Confirm the words the checker asked about before sending: ${open.join(", ")}`);
    const live = liveOption(n, r.orderId, r.option, contacts);
    if (!live || amountOf(live) !== r.facts.amount) throw new Error("The order changed since this was drafted; draft it again");
    if (n.outbox.length >= LIMIT.outbox) throw new Error("Outbox is full");
    const id = `out-${n.outbox.length + 1}`;
    n.outbox.push({ id, resolutionId: r.id, to: structuredClone(r.facts.to), text: r.text, draftedBy: r.draftedBy, sentBy: text(actor, LIMIT.actor, "Actor name"), sentAt: stamp(at) });
    r.status = "sent"; r.messageId = id;
  }, { kind: "sent" }, actor, at);
}

// Consent comes only from the buyer's recorded answer (E8, E9).
// A phone answer with nothing written is recorded as exactly that: the coordinator heard it and has no words to quote.
export const noNote = (actor: string): string => `Answer recorded by ${typeof actor === "string" ? actor.trim() : ""} without a note`;
// An answer with no channel picked says only who recorded it.
export const recordedBy = (actor: string): string => `Answer recorded by ${typeof actor === "string" ? actor.trim() : ""}`;
export function recordBuyerReply(w: Workbench, resId: string, given: Reply & { accept: boolean }, actor: string, at: string): Workbench {
  const blank = typeof given?.text !== "string" || !given.text.trim();
  const reply = given?.channel === "call" && blank ? { ...given, text: noNote(actor) } : given?.channel === "recorded" && blank ? { ...given, text: recordedBy(actor) } : given;
  return update(w, resId, (r, n) => {
    if (r.option.kind !== "offer-substitute") throw new Error("Only a substitute offer takes a buyer reply");
    awaiting(r, "offer");
    if (typeof reply.accept !== "boolean") throw new Error("Record whether the buyer accepted");
    const { messageId, channel, quote, ...kept } = evidence(n, reply);
    // A substitute already agreed up to some amount is raised by what is now offered on top of it.
    const product = r.option.product, held = order(n, r.orderId).approvedSubstitutions.find(s => s.product === product)?.maxAmount ?? 0;
    if (reply.accept) n.ledger = acceptSubstitute(n.ledger, r.orderId, { product: r.option.product, acceptedGrades: [r.option.grade], maxAmount: held + r.option.covers }, { messageId, channel, quote }, text(actor, LIMIT.actor, "Actor name"));
    r.reply = { ...kept, channel, quote }; r.status = reply.accept ? "accepted" : "declined";
  }, { kind: "reply-recorded", note: reply?.accept ? "accepted" : "declined" }, actor, at);
}

// A grower who holds a lot answers as a normal message, reviewed like any other (E14).
export function receiveRequestedReply(w: Workbench, resId: string, source: Source, at: string): Workbench {
  const r = resolution(w, resId);
  if (r.option.kind !== "ask-grower" || !r.option.hasLot) throw new Error("Only an ask to a grower who holds a lot takes a reply message");
  awaiting(r, "request");
  if (source?.growerId !== r.option.contactId) throw new Error("The reply must come from the grower who was asked");
  const received = receive(w, source, at), itemId = received.items.at(-1)!.id;
  return update(received, resId, (x, n) => { n.items.at(-1)!.requestId = x.id; x.linkedItemId = itemId; }, { kind: "grower-replied", note: itemId }, source.growerId, at);
}

// The same grower answering by phone: the coordinator's note becomes a call message, as
// logCall makes it, linked to the ask exactly as a requested text reply is (E14).
export function receiveRequestedCall(w: Workbench, resId: string, note: string, actor: string, at: string): Workbench {
  const r = resolution(w, resId);
  if (r.option.kind !== "ask-grower" || !r.option.hasLot) throw new Error("Only an ask to a grower who holds a lot takes a reply message");
  awaiting(r, "request");
  const said = text(note, LIMIT.message, "Call note"), who = text(actor, LIMIT.actor, "Actor name");
  const received = receive(w, { id: `call-${w.calls + 1}`, revision: 1, growerId: r.option.contactId, text: said }, at), itemId = received.items.at(-1)!.id;
  received.calls += 1; received.items.at(-1)!.decisions[0].note = `Call note by ${who}`;
  return update(received, resId, (x, n) => { n.items.at(-1)!.requestId = x.id; x.linkedItemId = itemId; }, { kind: "grower-replied", note: itemId }, who, at);
}

// A source with no lot: a yes is recorded as a new confirmed lot, with the reply as evidence (E5).
export function recordSupplyReply(w: Workbench, resId: string, reply: Reply & { yes: boolean; amount?: number; grade?: string }, actor: string, at: string): Workbench {
  return update(w, resId, (r, n) => {
    const opt = r.option;
    if (opt.kind !== "ask-grower" || opt.hasLot) throw new Error("Only an ask to a grower or source with no lot takes a supply reply");
    awaiting(r, "request");
    if (typeof reply.yes !== "boolean") throw new Error("Record whether they can supply");
    const { messageId, channel, quote, ...kept } = evidence(n, reply);
    if (reply.yes) {
      if (typeof reply.amount !== "number" || !Number.isFinite(reply.amount) || reply.amount <= 0) throw new Error("A positive amount is required for a yes");
      if (!Number.isSafeInteger(reply.amount)) throw new Error(`The amount must be a whole number of ${opt.unit}`);
      const o = order(n, r.orderId), grade = text(reply.grade, LIMIT.label, "Grade"), prefix = `lot-${opt.contactId}-`, k = n.ledger.snapshot.lots.filter(x => x.id.startsWith(prefix)).length + 1;
      if (!o.acceptedGrades.includes(grade)) throw new Error(`The order does not accept grade ${grade}`);
      // The ask stated the amount in the shortfall's unit, so the yes is in that unit too.
      n.ledger = addLot(n.ledger, { id: `${prefix}${k}`, growerId: opt.contactId, product: o.product, grade,
        quantity: { amount: reply.amount, unit: opt.unit }, deliveryOn: o.deliveryOn, confirmed: true }, { messageId, channel, quote }, text(actor, LIMIT.actor, "Actor name"));
    }
    r.reply = { ...kept, channel, quote }; r.status = reply.yes ? "accepted" : "declined";
  }, { kind: "supply-recorded", note: reply?.yes ? `yes, ${reply.amount}` : "no" }, actor, at);
}

// A phone call from a grower: the coordinator's note becomes an inbox message and goes
// through the normal reading and review (E14).
export function logCall(w: Workbench, growerId: string, note: string, actor: string, at: string): Workbench {
  const who = text(actor, LIMIT.actor, "Actor name");
  const next = receive(w, { id: `call-${w.calls + 1}`, revision: 1, growerId, text: text(note, LIMIT.note, "Call note") }, at);
  next.calls += 1; next.items.at(-1)!.decisions[0].note = `Call note by ${who}`;
  return next;
}

// Open: drafted, or sent and not yet answered. A notice is resolved once sent (E6); a
// has-lot ask closes when its linked reply is approved or dismissed. The Orders page uses
// this same rule to decide whether an option already has a message in progress.
export function isOpen(w: Workbench, r: Resolution): boolean {
  if (r.status === "drafted") return true;
  if (r.status !== "sent" || r.option.kind === "notify-short") return false;
  if (r.option.kind === "ask-grower" && r.option.hasLot && r.linkedItemId) {
    const state = w.items.find(i => i.id === r.linkedItemId)?.state;
    return state !== "approved" && state !== "dismissed";
  }
  return true;
}
// The notice that already tells the buyer about as much as is short now: sent, for this unit, covering the whole gap.
// While it stands there is nothing more to tell them, so the Next step shows what was said and offers no second notice.
export function toldBuyer(w: Workbench, orderId: string): Resolution | undefined {
  const gap = shortages(w.ledger).find(s => s.orderId === orderId);
  return gap ? w.resolutions.find(r => r.orderId === orderId && r.option.kind === "notify-short" && r.status === "sent" && r.facts.unit === gap.unit && r.facts.amount >= gap.short) : undefined;
}
// The message waiting to be sent for this order, if any. While one waits, its Send is the only Send on the page.
export function draftWaiting(w: Workbench, orderId: string): Resolution | undefined {
  return w.resolutions.find(r => r.orderId === orderId && r.status === "drafted");
}
export function orderStatus(w: Workbench, orderId: string): OrderStatus {
  order(w, orderId);
  const gap = shortages(w.ledger).find(s => s.orderId === orderId), mine = w.resolutions.filter(r => r.orderId === orderId);
  if (!gap) {
    const subs = new Set(mine.filter(r => r.status === "accepted" && r.option.kind === "offer-substitute").map(r => r.option.kind === "offer-substitute" ? r.option.product : ""));
    const lots = new Map(w.ledger.snapshot.lots.map(l => [l.id, l.product]));
    const helped = planOf(w.ledger).allocations.some(a => a.orderId === orderId && a.kind === "approved-substitution" && a.amount > 0 && subs.has(lots.get(a.lotId)!));
    return helped ? "substitute-agreed" : "covered";
  }
  // Telling the buyer counts only for as much as they were told; a larger shortfall is short again.
  if (toldBuyer(w, orderId)) return "buyer-told";
  // Waiting on a reply means something was asked: a draft alone has asked no one, so the order stays short.
  return mine.some(r => r.status === "sent" && isOpen(w, r)) ? "resolving" : "short";
}
// The open message, if any, for this option of this order.
export function openFor(w: Workbench, orderId: string, option: Option): Resolution | undefined {
  return w.resolutions.find(r => r.orderId === orderId && sameOption(r.option, option) && isOpen(w, r));
}
export function unresolved(w: Workbench): string[] {
  return w.ledger.snapshot.orders.map(o => o.id).filter(id => { const s = orderStatus(w, id); return s === "short" || s === "resolving"; });
}
