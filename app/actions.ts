"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseOperation, type Answer } from "../src/answers.ts";
import { PROMPT_VERSION, createBudget, interpretReply, interpretSource, metaTransport } from "../src/interpret.ts";
import { BUYERS, CONTACTS } from "../src/demo.ts";
import { draftMessage, templateDraft, type Draft } from "../src/draft.ts";
import { options, type Option } from "../src/orders.ts";
import { conflicts, confirmPlan, decideCut, markAllStage, markStage } from "../src/commitments.ts";
import { hubDay } from "../src/hub.ts";
import { canSend, confirmDraft, discardDraft, editDraft, factsFor, logCall, quoteFor, receiveRequestedCall, recordBuyerReply, recordSupplyReply, redraft, sendMessage, startResolution, type Resolution } from "../src/resolve.ts";
import { DEMO_MODEL, DEMO_SETTINGS, LATE, lateRefusal, recordedDraft, replay, scriptedReply, scriptedRequestReply } from "../src/seed.ts";
import { FIELDS, type Field } from "../src/updates.ts";
import { ask, confirmLot, correct, dismiss, interpret, leavePending, readByHand, type HandReading, receive, refresh, refreshAll, refreshAndApprove, refreshIfStale, reply, replyRead, returnForClarification, type Workbench } from "../src/workbench.ts";
import { StaleView, act, staleMessage, current, extras, recording, resetDemo } from "./lib/hub.ts";
import { forgetName, forgetOldName, rememberName, rememberedName } from "./lib/name.ts";
import { NAME_PROBLEM, checkName } from "./lib/names.ts";
import { buyer, grower, weight } from "./lib/format.ts";
import { cutPage, returnPage, signNotice, type Notice } from "./lib/notice.ts";
import { keepTyped, type KeptForm } from "./lib/kept.ts";
import { pickQuote } from "./lib/quote.ts";

// Form handlers for the workspace. Each one acts on the stored version the page showed;
// any error comes back to the same page as a message, and the stored state is unchanged.
// An action that worked comes back with a short result (ok), which the page announces and
// moves focus to.
const now = () => new Date().toISOString();
const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v.trim() : ""; };
// Every action that records a person's name takes it from the form's own "who" field when
// one was typed (checked by the same rules as any name, then remembered), else the name
// remembered in the cookie. With neither, the form is refused beside its own name field.
const NAME_NEEDED = "Enter your name to continue.";
async function named(f: FormData): Promise<string> {
  await forgetOldName();
  const c = checkName(f.get("who"));
  if ("name" in c) { await rememberName(c.name); return c.name; }
  if (c.problem !== "empty") throw new FieldError(NAME_PROBLEM[c.problem], "who");
  const kept = await rememberedName();
  if (!kept) throw new FieldError(NAME_NEEDED, "who");
  return kept;
}
// A problem with one field of the form, shown beside that field (by its form name).
class FieldError extends Error { constructor(message: string, readonly field: string) { super(message); } }
// Which field a domain error is about, for the forms that have one.
function fieldOf(e: unknown, on?: string): string | undefined {
  if (e instanceof FieldError) return e.field;
  const m = e instanceof Error ? e.message : "";
  if (/^Literal source evidence required/.test(m)) return "quote";
  if ((on === "reply" || on === "correct") && /answer|operation|unit|Case contents|more than this hub handles|more than zero|whole numbers/i.test(m)) return "value";
  if (on === "hand") {
    if (/whole numbers/i.test(m)) return "amount";
    if (/date/i.test(m)) return "day";
    if (/unit/i.test(m)) return "unit";
  }
  return undefined;
}
const failed = async (e: unknown, on?: string, res?: string): Promise<Notice> => {
  const at = { ...(on ? { on } : {}), ...(res ? { res } : {}) };
  const field = fieldOf(e, on);
  const w = await current().then(s => s.state, () => undefined);
  return { text: plain(e, w, on), ...at, ...(field ? { field } : {}) };
};
// The domain's wording, said plainly for the coordinator, with names in place of IDs.
function plain(e: unknown, w?: Workbench, on?: string, fallback = "That didn't work. Try again."): string {
  const m = e instanceof Error ? e.message : fallback;
  if (/^Stale update/.test(m)) return "Supply changed since this was read. Checking it again…";
  if (/^Named approval of exact proposal required/.test(m)) return "Supply changed since this page loaded, so the change shown is out of date. Check it again, then approve.";
  if (/^Literal source evidence required/.test(m)) return `Those words aren't in the ${on === "reply" ? "reply" : "message"}. Copy them exactly as written.`;
  if (/^(Actor|Reviewer) name required/.test(m)) return NAME_NEEDED;
  const limit = m.match(/^(.+) required \(at most (\d+) characters\)$/);
  if (limit) return `Enter ${limit[1].toLowerCase()}, at most ${limit[2]} characters.`;
  return w ? withNames(m, w) : m;
}
// Replaces item, order and lot IDs in a message with the names the coordinator knows.
function withNames(m: string, w: Workbench): string {
  const s = w.ledger.snapshot, lot = (id: string) => s.lots.find(l => l.id === id);
  return m
    .replace(/\bitem-\d+\b/g, id => { const i = w.items.find(x => x.id === id); return i ? `${grower(i.source.growerId)}'s message` : "that message"; })
    .replace(/\border-[\w-]+/g, id => { const o = s.orders.find(x => x.id === id); return o ? buyer(o.buyerId) : "that order"; })
    .replace(/\blot-[\w-]+/g, id => { const l = lot(id); return l ? `${l.product} from ${grower(l.growerId)}` : "that lot"; });
}
function field(f: FormData): Field {
  const v = str(f, "field") as Field;
  if (!FIELDS.includes(v)) throw new FieldError("Choose which detail this is about.", "field");
  return v;
}
// Reads a value typed by the coordinator, in the same shapes the model must use.
function value(fieldName: Field, raw: string): unknown {
  if (!raw) throw new FieldError("Enter the value.", "value");
  if (fieldName === "operation") {
    const kind = parseOperation(raw);
    if (!kind) throw new FieldError("Choose what changed: a new total, added to what they have, a correction or a forecast.", "value");
    return kind;
  }
  if (fieldName === "quantity" || fieldName === "unit" || fieldName === "pack") {
    const m = raw.toLowerCase().match(/^(\d+)\s*(g|kg|lbs?|each|cases?)$/);
    if (!m) throw new FieldError(`Write the ${fieldName === "pack" ? "contents of one case" : "quantity"} as a whole number and a unit, like "3 kg", "30 lb" or "4 cases".`, "value");
    const unit = m[2].startsWith("case") ? "case" : m[2] === "lbs" ? "lb" : m[2];
    if (fieldName === "pack" && unit === "case") throw new FieldError("Write the contents of one case in g, kg, lb or each.", "value");
    return { amount: Number(m[1]), unit };
  }
  return raw;
}
// from "reply": the words that answer it may be left blank, and are then picked from the reply
// itself (lib/quote.ts: a literal stretch of it, never words of our own). From the message they are required.
function answers(f: FormData, from: "reply" | "message", text?: string): Answer[] {
  const name = field(f), raw = str(f, "value"), given = str(f, "quote");
  const v = value(name, raw), quote = given || (from === "reply" && text ? pickQuote(text, raw) : "");
  if (!quote) throw new FieldError(`Copy the words in the ${from} that support this value.`, "quote");
  return [{ field: name, quote, value: v }];
}
// A required text field, refused beside the field when empty.
function need(f: FormData, k: string, ask: string): string {
  const v = str(f, k);
  if (!v) throw new FieldError(ask, k);
  return v;
}
// A notice names the form (on) and field it belongs to, so the page shows it there. It is
// signed (lib/notice.ts) for this page and item: the page shows no text a link could choose.
// It lands on the result: the change panel after an approval and the message (with any
// notice at its top) otherwise. A problem with a field (a missing name included) has no
// fragment, because a fragment blocks the autofocus, and the page moves focus to the field itself.
// A refused form also sends back what was typed (lib/kept.ts), outside the signed notice.
// from: a page the form can come back to instead (the Overview; lib/notice.ts), which shows the
// result beside the row it was done from and moves focus there.
function back(item: string, notice: Notice, on?: string, kept: Record<string, string> = {}, from?: string): never {
  revalidatePath("/", "layout");
  if (from) redirect(`${from}?${new URLSearchParams({ item, ...signNotice(notice, { page: from, id: item }) })}`);
  const anchor = notice.field ? "" : notice.ok && on === "approve" ? "#change" : "#item";
  redirect(`/review?${new URLSearchParams({ item, ...kept, ...signNotice(notice, { page: "/review", id: item }) })}${anchor}`);
}
// on: the form, so the page shows the notice there; done: the result said once it worked;
// rebase: apply to a newer stored version when the domain re-checks what the page showed.
// Every step records the coordinator's name, so the form is refused without one beside its own
// name field (named); only the demo's scripted arrival of a grower's reply (anon) is not theirs.
// after: reads the changed workbench, and may replace the result (an approval that opens a conflict says so).
type Step = { on: string; done: string; keep?: KeptForm; rebase?: boolean; anon?: boolean; after?: (w: Workbench, item: string) => Partial<Notice> };
async function run(f: FormData, change: (w: Workbench, item: string, who: string) => Workbench | Promise<Workbench>, step: Step): Promise<never> {
  const item = str(f, "item");
  let notice: Notice, kept: Record<string, string> = {};
  try {
    const who = step.anon ? "" : await named(f);
    let next: Workbench | undefined;
    await act(Number(str(f, "version")), async w => (next = await change(w, item, who)), { rebase: step.rebase });
    notice = { text: step.done, ok: true, on: step.on, ...step.after?.(next!, item) };
  } catch (e) { notice = await failed(e, step.on); if (step.keep) kept = keepTyped(f, step.keep); }
  back(item, notice, step.on, kept, returnPage(str(f, "from")));
}

export async function askAction(f: FormData) {
  return run(f, (w, i, who) => ask(w, i, field(f), need(f, "question", "Write the question to ask the grower."), who, now()), { on: "ask", keep: "ask", done: "Question recorded." });
}
export async function replyAction(f: FormData) {
  return run(f, (w, i, who) => {
    const it = w.items.find(x => x.id === i);
    if (!it) throw new Error("Unknown inbox item");
    const text = need(f, "reply", "Paste the grower's reply exactly as received.");
    const source = { id: `${it.source.id}-reply-${it.replies.length + 1}`, revision: 1, growerId: it.source.growerId, text };
    return reply(w, i, source, answers(f, "reply", text), [], who, now());
  }, { on: "reply", keep: "reply", done: "Reply added." });
}
export async function scriptedReplyAction(f: FormData) { return run(f, (w, i, who) => scriptedReply(w, i, recording(), who, now()), { on: "script", done: "The grower's reply was added." }); }
export async function correctAction(f: FormData) { return run(f, (w, i, who) => correct(w, i, answers(f, "message"), who, now()), { on: "correct", keep: "correct", done: "Correction applied." }); }
// The coordinator's own reading of a message: what kind of change, which lot, how much, the
// grade and the day. A call note is its own evidence; any other message needs the words.
const KINDS = ["replace-total", "add-quantity", "correction", "forecast"] as const;
const UNIT_CHOICES = ["g", "kg", "lb", "each", "case"] as const;
function handReading(f: FormData, callNote: boolean): HandReading {
  const operation = need(f, "operation", "Choose what kind of update this is.") as HandReading["operation"];
  if (!KINDS.includes(operation)) throw new FieldError("Choose what kind of update this is.", "operation");
  const lotId = need(f, "lot", "Choose the lot.");
  const amount = need(f, "amount", "Enter the amount.");
  if (!/^\d{1,9}$/.test(amount)) throw new FieldError("Enter the amount as a whole number.", "amount");
  const unit = str(f, "unit") as (typeof UNIT_CHOICES)[number];
  if (!UNIT_CHOICES.includes(unit)) throw new FieldError("Choose a unit.", "unit");
  const grade = need(f, "grade", "Enter the grade."), deliveryOn = need(f, "day", "Choose the delivery day.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryOn)) throw new FieldError("Choose the delivery day.", "day");
  const quote = str(f, "quote");
  if (!quote && !callNote) throw new FieldError("Copy the words in the message that support this.", "quote");
  return { operation, lotId, quantity: { amount: Number(amount), unit }, grade, deliveryOn, ...(str(f, "target") ? { correctsEventId: str(f, "target") } : {}), ...(quote ? { quote } : {}) };
}
export async function readByHandAction(f: FormData) {
  return run(f, (w, i, who) => readByHand(w, i, handReading(f, !!w.items.find(x => x.id === i)?.source.id.startsWith("call-")), who, now()), { on: "hand", keep: "hand", done: "Details saved. Check them, then approve." });
}
export async function confirmLotAction(f: FormData) { return run(f, (w, i, who) => confirmLot(w, i, who, now()), { on: "lot", done: "Lot confirmed." }); }
const note = (f: FormData) => need(f, "note", "Write a note or reason.");
export async function pendingAction(f: FormData) { return run(f, (w, i, who) => leavePending(w, i, note(f), who, now()), { on: "hold", keep: "hold", done: "Left pending." }); }
export async function returnAction(f: FormData) { return run(f, (w, i, who) => returnForClarification(w, i, note(f), who, now()), { on: "hold", keep: "hold", done: "Returned to the grower." }); }
export async function dismissAction(f: FormData) { return run(f, (w, i, who) => dismiss(w, i, note(f), who, now()), { on: "hold", keep: "hold", done: "Dismissed." }); }
// A message with no supply change in it (thanks, a question, a time of arrival): one tap, no reason to type.
export async function dismissNoChangeAction(f: FormData) { return run(f, (w, i, who) => dismiss(w, i, "No supply change", who, now()), { on: "hold", done: "Dismissed. No supply change." }); }
export async function refreshAction(f: FormData) { return run(f, (w, i, who) => refresh(w, i, who, now()), { on: "refresh", done: "Checked again against current supply." }); }
export async function refreshAllAction(f: FormData) { return run(f, (w, _i, who) => refreshAll(w, who, now()), { on: "refreshAll", done: "Stale messages checked again against current supply." }); }
// A stale item was shown its rebased review, so approval refreshes and approves in one
// change, against that review's hash.
export async function approveAction(f: FormData) { return run(f, (w, i, who) => refreshAndApprove(w, i, who, str(f, "hash"), now()), { on: "approve", done: "Supply change approved.", rebase: true, after: approved }); }
// A forecast is noted, not applied: confirmed supply does not move.
function approved(w: Workbench, item: string): Partial<Notice> {
  const e = w.ledger.events.find(x => x.id === w.items.find(i => i.id === item)?.eventId);
  return e?.effect === "forecast" ? { text: "Forecast noted. Confirmed supply is unchanged." } : openedConflict(w, item);
}
// An approval that leaves a lot holding less than was promised says so, and names the lot so the page can focus its panel.
function openedConflict(w: Workbench, item: string): Partial<Notice> {
  const lotId = w.ledger.events.find(e => e.id === w.items.find(i => i.id === item)?.eventId)?.lotId, c = conflicts(w.ledger).find(x => x.lotId === lotId);
  return c ? { text: `Supply change approved. ${weight(c.excess, c.unit)} of what you promised can't be filled — decide who takes the cut.`, res: c.lotId } : {};
}

// Live Meta reading. Off unless the server sets a call allowance and has the key; the
// allowance is per server process, so a restart is the only way to grant more.
let liveUsed = 0;
export async function liveAllowance(): Promise<number> {
  const cap = Number(process.env.HARVEST_LIVE_CALLS ?? 0);
  return process.env.MODEL_API_KEY && Number.isSafeInteger(cap) && cap > 0 ? Math.max(0, cap - liveUsed) : 0;
}
async function live() {
  if (await liveAllowance() < 1) throw new Error("Automatic reading is off or used up on this server. Enter the details yourself.");
  liveUsed += 1;
  return { enabled: true, model: DEMO_MODEL, ...DEMO_SETTINGS, budget: createBudget(1), transport: metaTransport(process.env.MODEL_API_KEY!) };
}
export async function liveReadAction(f: FormData) {
  return run(f, async (w, i, who) => {
    const it = w.items.find(x => x.id === i);
    if (!it) throw new Error("Unknown inbox item");
    const r = await interpretSource(w.ledger, it.source, await live());
    if (r.status !== "proposed") throw new Error("The automatic reading wasn't usable. Enter the details yourself.");
    return interpret(w, i, r.proposal, `Muse Spark, live, prompt ${PROMPT_VERSION}`, who, now());
  }, { on: "read", done: "Message read. Check the highlighted words." });
}
export async function liveReplyAction(f: FormData) {
  return run(f, async (w, i, who) => {
    if (!w.items.find(x => x.id === i)?.proposal) throw new Error("Read the message before reading a reply.");
    w = refreshIfStale(w, i, who, now());
    const it = w.items.find(x => x.id === i)!;
    const source = { id: `${it.source.id}-reply-${it.replies.length + 1}`, revision: 1, growerId: it.source.growerId, text: need(f, "reply", "Paste the grower's reply exactly as received.") };
    const r = await interpretReply(w.ledger, it.proposal!, source, await live());
    if (r.status !== "proposed") throw new Error("The automatic reading of the reply wasn't usable. Enter the answer yourself.");
    return replyRead(w, i, source, r, `Muse Spark, live, prompt ${PROMPT_VERSION}`, who, now());
  }, { on: "reply", keep: "reply", done: "Reply added." });
}

// Order resolution. Every form names the stored version, the order and, after drafting,
// the resolution; each is checked against the current state before anything changes.
const MAX_TEXT = 480;
const NAMES: Record<string, string> = { ...Object.fromEntries(CONTACTS.map(c => [c.id, c.name])), ...BUYERS };
const products = (w: Workbench) => [...new Set([...w.ledger.snapshot.lots, ...w.ledger.snapshot.orders].map(x => x.product))];
// A required text field of an Orders form, refused beside the field.
function words(f: FormData, k: string, what: string): string {
  const v = str(f, k);
  if (!v) throw new FieldError(`Enter ${what}.`, k);
  if (v.length > MAX_TEXT) throw new FieldError(`Keep ${what} to ${MAX_TEXT} characters.`, k);
  return v;
}
function yesNo(f: FormData, k: string, what: string): boolean {
  const v = str(f, k);
  if (v !== "yes" && v !== "no") throw new FieldError(what, k);
  return v === "yes";
}
// Which option a card offers, beyond its kind and amount: a contact, or a substitute and grade.
const target = (o: Option) => o.kind === "ask-grower" ? o.contactId : o.kind === "offer-substitute" ? `${o.product}/${o.grade}` : "buyer";
const amountOf = (o: Option) => o.kind === "offer-substitute" ? o.covers : o.amount;
function res(w: Workbench, f: FormData): Resolution {
  const id = str(f, "res"), r = w.resolutions.find(x => x.id === id);
  if (!r || r.orderId !== str(f, "order")) throw new Error("Unknown message for this order");
  return r;
}
// callBlank: a call may be recorded with no note (the domain says so in the history).
function answerOf(f: FormData, callBlank = false): { channel: "text" | "call"; text: string; quote?: string } {
  const channel = str(f, "channel");
  if (channel === "call") return { channel, text: callBlank && !str(f, "text") ? "" : words(f, "text", "the call note") };
  if (channel !== "text") throw new FieldError("Choose whether the answer came by text or by phone.", "channel");
  const text = words(f, "text", "the reply text"), quote = words(f, "quote", "the words that answer it");
  if (!text.includes(quote)) throw new FieldError("Copy these words exactly from the reply.", "quote");
  return { channel, text, quote };
}
// A notice from a message card names the card (res) and its form (on), so the page shows it
// there rather than at the top. A result focuses the card it is about.
function toOrders(order: string, resId: string, notice: Notice, kept: Record<string, string> = {}): never {
  revalidatePath("/", "layout");
  const q = new URLSearchParams({ order, ...kept, ...signNotice(notice, { page: "/orders", id: order }) });
  // A field problem (a missing name included) has no fragment, because the page moves focus to the field.
  redirect(`/orders?${q}${resId && !notice.field ? `#${resId}` : ""}`);
}
async function onOrder(f: FormData, change: (w: Workbench, who: string) => Workbench | Promise<Workbench>, step: Step, after?: (w: Workbench) => string): Promise<never> {
  const order = str(f, "order");
  let notice: Notice, resId = str(f, "res"), kept: Record<string, string> = {};
  try {
    const who = step.anon ? "" : await named(f);
    await act(Number(str(f, "version")), async w => { const next = await change(w, who); if (after) resId = after(next); return next; }, { rebase: step.rebase });
    notice = { text: step.done, ok: true, on: step.on, ...(resId ? { res: resId } : {}) };
  } catch (e) { notice = await failed(e, step.on, resId || undefined); if (step.keep) kept = keepTyped(f, step.keep); }
  toOrders(order, resId, notice, kept);
}

// The option a card offered, if the order still offers exactly it; its draft is started from that.
function startFrom(w: Workbench, f: FormData, who: string): Workbench {
  const order = str(f, "order"), index = Number(str(f, "index")), offered = options(w.ledger, order, CONTACTS);
  const o = Number.isSafeInteger(index) ? offered[index] : undefined;
  if (!o || o.kind !== str(f, "kind") || amountOf(o) !== Number(str(f, "amount")) || target(o) !== str(f, "target"))
    throw new Error("The options for this order changed since the page loaded. Review them and choose again.");
  const facts = factsFor(w, order, o, NAMES);
  return startResolution(w, order, o, CONTACTS, facts, templateDraft(facts, products(w), hubDay(now())), who, now());
}
export async function startResolutionAction(f: FormData) {
  return onOrder(f, (w, who) => startFrom(w, f, who), { on: "draft", done: "Message drafted. Check it, then send." }, w => w.resolutions.at(-1)!.id);
}

// The Next step's one button: draft (with the coordinator's own wording, if edited), check, and send, in one
// recorded step. If the words need confirming, or the check found something, only the draft is kept and the
// draft card shows it: those are the coordinator's to decide before anything is sent (src/resolve.ts).
export async function sendNowAction(f: FormData) {
  const step: Step = { on: "draft", done: "Recorded as sent.", keep: "send" };
  return onOrder(f, (w, who) => {
    const body = words(f, "body", "the message");
    let next = startFrom(w, f, who);
    const id = next.resolutions.at(-1)!.id;
    if (body !== next.resolutions.at(-1)!.text) next = editDraft(next, id, body, who, now());
    const r = next.resolutions.at(-1)!;
    if (!r.check.ok || !canSend(next, r, hubDay(now()))) {
      step.on = "draft";
      step.done = canSend(next, r, hubDay(now())) ? "Message drafted. The check found something. Look it over, then send." : "Message drafted. Confirm the words below, then send.";
      return next;
    }
    const sent = sendMessage(next, id, CONTACTS, who, now());
    step.on = "send";
    return sent;
  }, step, w => w.resolutions.at(-1)!.id);
}

// "Suggest other wording": a recorded or live model draft. Recorded drafts are replayed
// through the same checker as a live draft; a draft that fails it is replaced by the
// template, labelled with the reason (src/draft.ts). Every precondition is checked before
// any model call, and the call happens outside act(), so a refused action never spends the
// live allowance; redraft() checks the same state again. The model's name is kept in the
// draft's history, not on the card.
export async function museDraftAction(f: FormData) {
  const order = str(f, "order"), resId = str(f, "res");
  let notice: Notice;
  try {
    const version = Number(str(f, "version")), who = await named(f), { state: w, version: stored } = await current();
    if (stored !== version) throw new StaleView(staleMessage(w));
    const r = res(w, f);
    if (r.status !== "drafted") throw new Error(`This message was already ${r.status}; it can no longer change`);
    const known = products(w), on = hubDay(now()), recorded = recordedDraft(extras(), r.facts);
    let d: Draft;
    if (recorded !== undefined) d = { ...await draftMessage(r.facts, known, { enabled: true, model: DEMO_MODEL, ...DEMO_SETTINGS, budget: createBudget(1), transport: replay(JSON.stringify({ text: recorded })) }, "Muse Spark (recorded)", on), recorded: true };
    else if (await liveAllowance() > 0) d = await draftMessage(r.facts, known, await live(), "Muse Spark", on);
    else throw new Error("No other wording is available for this message. The current draft stands.");
    await act(version, next => redraft(next, r.id, d, who, now()));
    notice = { text: "Other wording suggested. Check it, then send.", ok: true, on: "redraft", res: resId };
  } catch (e) { notice = await failed(e, "redraft", resId || undefined); }
  toOrders(order, resId, notice);
}
export async function editDraftAction(f: FormData) { return onOrder(f, (w, who) => editDraft(w, res(w, f).id, words(f, "body", "the message"), who, now()), { on: "edit", done: "Edit saved and checked." }); }
export async function sendAction(f: FormData) { return onOrder(f, (w, who) => sendMessage(w, res(w, f).id, CONTACTS, who, now()), { on: "send", done: "Recorded as sent." }); }
// The words the page showed, so only those are confirmed (resolve.ts confirmDraft).
const shownWords = (f: FormData) => f.getAll("words").filter((v): v is string => typeof v === "string" && v.length <= 120).slice(0, 50);
export async function confirmDraftAction(f: FormData) { return onOrder(f, (w, who) => confirmDraft(w, res(w, f).id, shownWords(f), who, now()), { on: "confirm", done: "Words confirmed." }); }
export async function discardDraftAction(f: FormData) {
  return onOrder(f, (w, who) => discardDraft(w, res(w, f).id, words(f, "reason", "a reason to discard this draft"), who, now()), { on: "discard", done: "Draft discarded." });
}
// One tap: the pressed button says yes or no. A pasted text that holds that word supplies its own quote;
// otherwise the coordinator gives the words, and recordBuyerReply still requires them to be in the text.
export async function buyerReplyAction(f: FormData) {
  return onOrder(f, (w, who) => {
    const accept = yesNo(f, "accept", "Press They said yes or They said no.");
    const given = f.get("quote"), blank = typeof given !== "string" || !given.trim();
    if (str(f, "channel") === "text" && blank) {
      const quote = quoteFor(str(f, "text"), accept);
      if (!quote) throw new FieldError("Their words don't say plainly yes or no. Select or type the words that answer it.", "quote");
      f.set("quote", quote);
    }
    return recordBuyerReply(w, res(w, f).id, { ...answerOf(f, true), accept }, who, now());
  }, { on: "reply", done: "Reply recorded.", keep: "buyer" });
}
export async function supplyReplyAction(f: FormData) {
  return onOrder(f, (w, who) => {
    const r = res(w, f), yes = yesNo(f, "yes", "Choose whether they can supply.");
    if (!yes) return recordSupplyReply(w, r.id, { ...answerOf(f), yes }, who, now());
    const amount = Number(str(f, "amount")), grade = str(f, "grade");
    if (!Number.isFinite(amount) || amount <= 0) throw new FieldError("Enter the amount they can supply as a positive number.", "amount");
    if (!Number.isSafeInteger(amount)) throw new FieldError("Enter the amount they can supply as a whole number.", "amount");
    if (!w.ledger.snapshot.orders.find(o => o.id === r.orderId)?.acceptedGrades.includes(grade)) throw new FieldError("Choose a grade the order accepts.", "grade");
    return recordSupplyReply(w, r.id, { ...answerOf(f), yes, amount, grade }, who, now());
  }, { on: "reply", done: "Reply recorded." });
}
// A phone reply to an ask: the note is linked to the ask as its reply and goes to review.
export async function requestedCallAction(f: FormData) {
  return onOrder(f, (w, who) => receiveRequestedCall(w, res(w, f).id, words(f, "note", "what they said"), who, now()), { on: "call", done: "Call logged as their reply. It is in Review updates." });
}
export async function scriptedRequestReplyAction(f: FormData) {
  return onOrder(f, w => scriptedRequestReply(w, res(w, f).id, extras(), now()), { on: "script", done: "Their reply arrived. It is in Review updates.", anon: true });
}

// A phone call from a grower becomes an inbox message, read and reviewed like any other.
export async function logCallAction(f: FormData) {
  let error: Notice | undefined, item = "";
  const growerId = str(f, "grower"), kept = str(f, "note").slice(0, MAX_TEXT);
  try {
    const who = await named(f);
    if (!CONTACTS.some(c => c.id === growerId)) throw new FieldError("Choose who called.", "grower");
    const note = words(f, "note", "the call note");
    await act(Number(str(f, "version")), w => { const next = logCall(w, growerId, note, who, now()); item = next.items.at(-1)!.id; return next; });
  } catch (e) { error = await failed(e, "call"); }
  revalidatePath("/", "layout");
  if (error) redirect(`/call?${new URLSearchParams({ grower: growerId, note: kept, ...signNotice(error, { page: "/call", id: growerId }) })}`);
  redirect(`/review?${new URLSearchParams({ item, ...signNotice({ text: "Call logged. Review it below.", ok: true, on: "call" }, { page: "/review", id: item }) })}#item`);
}

// Buyer names stand in for order IDs in a refusal; the coordinator knows orders by buyer.
const byBuyer = (w: Workbench, e: unknown) => {
  const buyerOf = new Map(w.ledger.snapshot.orders.map(o => [o.id, BUYERS[o.buyerId] ?? o.buyerId]));
  return e instanceof Error ? new Error(e.message.replace(/\border-[\w-]+/g, id => buyerOf.get(id) ?? id)) : e;
};
const toPack = (n: Notice) => { revalidatePath("/", "layout"); redirect(`/pack?${new URLSearchParams(signNotice(n, { page: "/pack" }))}`); };

// Confirms today's plan: every allocation becomes a promise. The gate is recomputed by
// confirmPlan from the stored state, so the page's view of what is blocking is never trusted;
// the form only says whether the coordinator chose Ship short, and the version check refuses
// a page that is out of date.
export async function confirmAction(f: FormData) {
  let notice: Notice;
  const home = returnPage(str(f, "from"));
  try {
    const choice = str(f, "shipShort");
    if (choice !== "" && choice !== "yes") throw new Error("Ship short is either chosen or not");
    const who = await named(f);
    await act(Number(str(f, "version")), w => { try { return confirmPlan(w, who, now(), { shipShort: choice === "yes" }); } catch (e) { throw byBuyer(w, e); } });
    notice = { text: home ? "Plan confirmed." : "Plan confirmed. Print the sheets below.", ok: true, on: "lock" };
  } catch (e) { notice = e instanceof FieldError ? { text: e.message, on: "lock", field: e.field } : { text: e instanceof Error ? e.message : "The plan could not be confirmed" }; }
  // From the Overview's all-clear card it comes back there, where the card then points to Pack.
  if (home) { revalidatePath("/", "layout"); redirect(`${home}?${new URLSearchParams({ item: "plan", ...signNotice(notice, { page: home, id: "plan" }) })}`); }
  toPack(notice);
}

// Demo only: Birch Hollow's late harvest message arrives after the plan is confirmed, in the Review
// inbox unread. Refused before a confirm and once it has been received. The coordinator reads it by hand.
export async function lateMessageAction(f: FormData) {
  let notice: Notice;
  try {
    await named(f);
    await act(Number(str(f, "version")), w => {
      const refusal = lateRefusal(w);
      if (refusal) throw new Error(refusal);
      const next = receive(w, LATE.source, now());
      notice = { text: "Birch Hollow's late message is in Review.", ok: true, on: "late", res: next.items.at(-1)!.id };
      return next;
    });
  } catch (e) { notice = e instanceof FieldError ? { text: e.message, on: "late", field: e.field } : { text: e instanceof Error ? e.message : "The message could not be delivered" }; }
  toPack(notice!);
}

// Marks one order packed, or handed off. The domain refuses a stage that does not follow.
export async function stageAction(f: FormData) {
  let notice: Notice;
  const order = str(f, "order");
  try {
    const stage = str(f, "stage");
    if (stage !== "packed" && stage !== "handed-off") throw new Error("Choose packed or handed off");
    const who = await named(f);
    let said = "Saved. The sheet shows the new stage.";
    // The domain refuses a stage that does not follow, so a sheet from before another change still applies.
    await act(Number(str(f, "version")), w => {
      try { const next = markStage(w, order, stage, who, now()); said = `${buyer(w.ledger.snapshot.orders.find(o => o.id === order)?.buyerId ?? order)}'s order is marked ${stage === "packed" ? "packed" : "handed off"}.`; return next; } catch (e) { throw byBuyer(w, e); }
    }, { rebase: true });
    notice = { text: said, ok: true, on: "stage", res: str(f, "order") };
  } catch (e) { notice = e instanceof FieldError ? { text: e.message, on: "stage", field: e.field, res: order } : { text: e instanceof Error ? e.message : "The stage could not be saved" }; }
  toPack(notice);
}

// Marks every order that can take the stage, in one record. The domain skips an order that cannot (the same
// rules as one order's button), so a sheet from before another change still applies to the rest.
export async function stageAllAction(f: FormData) {
  let notice: Notice;
  const stage = str(f, "stage");
  try {
    if (stage !== "packed" && stage !== "handed-off") throw new Error("Choose packed or handed off");
    const who = await named(f);
    let said = "";
    await act(Number(str(f, "version")), w => {
      const { next, marked } = markAllStage(w, stage, who, now());
      said = `${marked.length} ${marked.length === 1 ? "order" : "orders"} marked ${stage === "packed" ? "packed" : "handed off"}.`;
      return next;
    }, { rebase: true });
    notice = { text: said, ok: true, on: "stageall", res: stage };
  } catch (e) { notice = e instanceof FieldError ? { text: e.message, on: "stageall", field: e.field, res: stage } : { text: e instanceof Error ? e.message : "The orders could not be marked" }; }
  toPack(notice);
}

// The coordinator's recorded choice of who takes the cut on a lot. The excess is the one the form
// showed, so a form from before another drop is refused by decideCut. Comes back to the page it was
// sent from (an allowlist, with the item or order that page had open).
export async function decideCutAction(f: FormData) {
  const lot = str(f, "lot"), { page, key: ctxKey } = cutPage(str(f, "page")), ctx = str(f, "ctx").slice(0, 200);
  const choice = str(f, "choice"), excess = Number(str(f, "excess"));
  let notice: Notice, kept: Record<string, string> = {};
  try {
    const who = await named(f);
    if (!choice) throw new FieldError("Choose who takes the cut.", "cut");
    await act(Number(str(f, "version")), w => {
      const c = conflicts(w.ledger).find(x => x.lotId === lot), ids = c?.promises.map(p => p.orderId) ?? [];
      if (!c) throw new Error("Supply changed since this was shown. Look at the current numbers and choose again.");
      const amount = (orderId: string) => { const v = str(f, `cut-${orderId}`); if (!/^\d{0,9}$/.test(v)) throw new FieldError("Enter whole numbers of pounds for the split.", "cut"); return Number(v); };
      const cuts = choice === "split" ? ids.map(orderId => ({ orderId, amount: amount(orderId) })) : ids.includes(choice) ? [{ orderId: choice, amount: excess }] : undefined;
      if (!cuts) throw new FieldError("Choose who takes the cut.", "cut");
      const next = decideCut(w, lot, cuts, excess, who, now()), taken = cuts.filter(x => x.amount > 0), product = c!.product, unit = c!.unit;
      const done = `${taken.map(x => `${buyer(w.ledger.snapshot.orders.find(o => o.id === x.orderId)?.buyerId ?? x.orderId)} takes the ${weight(x.amount, unit)} cut`).join(", ")}. Find more ${product} on Orders.`;
      notice = { text: done, ok: true, on: "cut", res: taken[0].orderId };
      return next;
    }, { rebase: true });
  } catch (e) {
    notice = await failed(e, "cut", lot);
    if (e instanceof Error && /^Supply changed since this was shown/.test(e.message)) notice.text = "Supply changed since this was shown. Look at the current numbers and choose again.";
    notice.field ??= "cut";
    // A refusal keeps what was chosen and typed, and a split that misses the total says what it came to.
    const typed = [...f.keys()].filter(k => /^cut-/.test(k) && /^\d{1,9}$/.test(str(f, k)));
    kept = { choice, ...Object.fromEntries(typed.map(k => [k, str(f, k)])) };
    const sum = typed.reduce((n, k) => n + Number(str(f, k)), 0);
    if (choice === "split" && e instanceof Error && /^The cuts must total exactly/.test(e.message)) notice.text = `You entered ${sum} lb; the cuts must total ${excess} lb.`;
  }
  revalidatePath("/", "layout");
  const q = ctxKey && ctx ? { [ctxKey]: ctx } : {};
  redirect(`${page}?${new URLSearchParams({ ...q, ...kept, ...signNotice(notice!, { page, id: ctx || undefined }) })}`);
}

// The header's "not you?" and "Who is working?": remembers the name for the forms that
// record it, by the same rules as a name typed on a form. It answers the header in place.
export type NameState = { error?: string; saved?: number };
export async function setNameAction(_prev: NameState, f: FormData): Promise<NameState> {
  await forgetOldName();
  const c = checkName(f.get("who"));
  if ("problem" in c) return { error: c.problem === "empty" ? "Enter your name." : NAME_PROBLEM[c.problem] };
  await rememberName(c.name);
  revalidatePath("/", "layout");
  return { saved: Date.now() };
}

export async function resetAction() {
  await resetDemo();
  await forgetName();
  revalidatePath("/", "layout");
  // The Overview moves focus to its heading and says the demo was reset.
  redirect(`/?${new URLSearchParams({ item: "reset", ...signNotice({ text: "Demo reset.", ok: true, on: "reset" }, { page: "/", id: "reset" }) })}`);
}
