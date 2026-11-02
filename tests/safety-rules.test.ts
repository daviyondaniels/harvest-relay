import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedWorkbench } from "../src/seed.ts";
import { confirmPlan, markAllStage } from "../src/commitments.ts";
import { FieldError } from "../app/lib/errors.ts";
import { callMissing, callRefusal, handFields } from "../app/lib/hand.ts";
import { CHANGED, WAITING_HAND, WAITING_REPLY, stopNote, unreadNote } from "../app/lib/state.ts";
import { RECHECK } from "../app/lib/notice.ts";
import { dayDone, overview, rowAction } from "../app/lib/view.ts";
import { answerRecorded, answerRecordedAndApprove, previewAnswers, previewHand, previewRecordedAnswers, readByHandAndApprove, reply, replyAndApprove, replyIsRecorded, type HandReading, type Workbench } from "../src/workbench.ts";

// Behaviour tests for the safety rules, run on the seed. Each rule used to be guarded by a check of the source text;
// these run the rule itself.
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z", ME = "Hub coordinator";
const seed = () => seedWorkbench(JSON.parse(readFileSync(new URL("../data/seed-readings.json", import.meta.url), "utf8")), NOW);
const by = (w: Workbench, id: string) => w.items.find(i => i.source.id === id)!;
const actionOf = (w: Workbench, id: string) => rowAction(w, by(w, id), overview(w).previews);

test("Overview row action: tomato reviews, forecast notes, the injection dismisses, questions open Review", async () => {
  const w = await seed();
  assert.equal(actionOf(w, "msg-tomato"), "review", "it leaves a buyer short");
  assert.equal(actionOf(w, "msg-forecast"), "note");
  assert.equal(actionOf(w, "msg-injection"), "dismiss");
  assert.equal(actionOf(w, "msg-cucumber"), "open", "a question is open on case size");
  assert.equal(actionOf(w, "msg-zucchini"), "open");
});

test("Overview row action: never approve an update that would leave anyone short, before or after hand-off", async () => {
  let w = confirmPlan(await seed(), ME, NOW, { shipShort: true });
  assert.equal(actionOf(w, "msg-tomato"), "review");
  w = markAllStage(w, "packed", ME, LATER).next;
  w = markAllStage(w, "handed-off", ME, LATER).next;
  assert.equal(dayDone(w), true, "every order is handed off");
  const p = overview(w).previews.get(by(w, "msg-tomato").id)!;
  assert.ok(p.orders.some(o => o.after.short > o.before.short), "the update would still leave a buyer short");
  assert.equal(actionOf(w, "msg-tomato"), "review", "never a one-tap Approve");
  assert.equal(actionOf(w, "msg-forecast"), "note", "an update that leaves nobody short stays one tap");
});

// A reading of the tomato message by hand: the shown hash is the one the form's preview carried.
const HAND: HandReading = { operation: "replace-total", lotId: "lot-a", quantity: { amount: 100, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quote: "Only 60 lb" };
const REPLY = { id: "msg-cucumber-reply", revision: 1, growerId: "grower-a", text: "6 lb in each" };
const PACK = { field: "pack" as const, quote: "6 lb in each", value: { amount: 6, unit: "lb" } };
const state = (w: Workbench, id: string) => w.items.find(i => i.id === id)!.state;

test("readByHandAndApprove approves only the hash that was shown, and never without one", async () => {
  const w = await seed(), id = by(w, "msg-tomato").id, shown = previewHand(w, id, HAND, LATER)!.reviewHash;
  assert.ok(shown);
  const ok = readByHandAndApprove(w, id, HAND, ME, LATER, shown);
  assert.deepEqual([ok.approved, state(ok.next, id)], [true, "approved"]);
  for (const bad of [undefined, "", "not-the-hash", previewHand(w, id, { ...HAND, quantity: { amount: 90, unit: "lb" } }, LATER)!.reviewHash]) {
    const r = readByHandAndApprove(w, id, HAND, ME, LATER, bad);
    assert.deepEqual([r.approved, r.changed, state(r.next, id)], [false, true, "open"], `shown ${String(bad)}: saved, not approved, the new outcome is shown first`);
  }
});

test("replyAndApprove approves only the hash that was shown", async () => {
  const w = await seed(), id = by(w, "msg-cucumber").id, shown = previewAnswers(w, id, REPLY, [PACK], LATER)!.reviewHash;
  assert.ok(shown);
  const ok = replyAndApprove(w, id, REPLY, [PACK], [], ME, LATER, shown);
  assert.deepEqual([ok.approved, state(ok.next, id)], [true, "approved"]);
  const stale = replyAndApprove(w, id, REPLY, [PACK], [], ME, LATER, "an-earlier-hash");
  assert.deepEqual([stale.approved, stale.changed, state(stale.next, id)], [false, true, "open"]);
  assert.equal(stale.next.items.find(i => i.id === id)!.replies.length, 1, "the reply itself is kept");
  assert.equal(replyAndApprove(w, id, REPLY, [PACK], [], ME, LATER).approved, false, "a form with no preview approves nothing");
});

test("answerRecordedAndApprove approves only the hash that was shown", async () => {
  let w = await seed();
  const id = by(w, "msg-zucchini").id, whole = { id: "msg-zucchini-reply", revision: 1, growerId: "grower-b", text: "That's the whole lot, 10 lb in each case." };
  w = reply(w, id, whole, [{ field: "operation", quote: "That's the whole lot", value: "replace-total" }], [], ME, NOW);
  assert.equal(replyIsRecorded(w, id), true, "the case size is still open");
  const pack = { field: "pack" as const, quote: "10 lb in each case", value: { amount: 10, unit: "lb" } };
  const shown = previewRecordedAnswers(w, id, [pack], LATER)!.reviewHash;
  assert.ok(shown);
  const ok = answerRecordedAndApprove(w, id, [pack], [], ME, LATER, shown);
  assert.deepEqual([ok.approved, state(ok.next, id)], [true, "approved"]);
  const stale = answerRecordedAndApprove(w, id, [pack], [], ME, LATER, "an-earlier-hash");
  assert.deepEqual([stale.approved, stale.changed, state(stale.next, id)], [false, true, "open"]);
  assert.equal(answerRecorded(w, id, [pack], [], ME, LATER).items.find(i => i.id === id)!.replies.length, 1, "recorded once");
});

test("composed approves never rebase: on a stale version, act with the default options refuses", async () => {
  process.env.HARVEST_DB = join(mkdtempSync(join(tmpdir(), "hr-t25-")), "t25.db");
  const { StaleView, act, current } = await import("../app/lib/hub.ts");
  const first = await current(), id = by(first.state, "msg-tomato").id;
  const shown = previewHand(first.state, id, HAND, LATER)!.reviewHash;
  const compose = (w: Workbench) => readByHandAndApprove(w, id, HAND, ME, LATER, shown).next;
  // Another tab moves the stored version on.
  await act(first.version, w => w);
  await assert.rejects(act(first.version, compose), StaleView);
  assert.equal(by((await current()).state, "msg-tomato").state, "open", "nothing was approved");
  // Only an action that asks for a rebase runs on the newer version.
  await act(first.version, w => w, { rebase: true });
  // What the composed actions pass to act: no rebase option (the three that do are approve, confirm/stage and the cut).
  const actions = readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8");
  for (const [from, to] of [["export async function replyAction", "export async function scriptedReplyAction"], ["export async function readByHandAction", "export async function confirmLotAction"]]) {
    assert.doesNotMatch(actions.slice(actions.indexOf(from), actions.indexOf(to)), /rebase:/, from);
  }
});

test("a stored version that moved refuses the second of two tabs", async () => {
  // hub.ts reads HARVEST_DB once at import, so this reuses the first test's temp store.
  const { act, current } = await import("../app/lib/hub.ts");
  const s = await current();
  await act(s.version, w => w);
  await assert.rejects(act(s.version, w => w), /Something changed in another tab/);
});

test("the hand form: -5 and 0 are refused with the plain message beside Amount", () => {
  const form = (o: Record<string, string>) => (k: string) => ({ operation: "replace-total", lot: "lot-a", amount: "60", unit: "lb", grade: "standard", day: "2026-10-30", quote: "Only 60 lb", ...o })[k] ?? "";
  for (const amount of ["-5", "0", "-0"]) {
    assert.throws(() => handFields(form({ amount }), false), (e: unknown) => e instanceof FieldError && e.message === "Enter an amount above zero." && e.field === "amount", amount);
  }
  assert.throws(() => handFields(form({ amount: "6.5" }), false), (e: unknown) => e instanceof FieldError && e.message === "Enter the amount as a whole number.");
  assert.throws(() => handFields(form({ amount: "" }), false), (e: unknown) => e instanceof FieldError && e.message === "Enter the amount." && e.field === "amount");
  assert.deepEqual(handFields(form({}), false).quantity, { amount: 60, unit: "lb" });
  assert.throws(() => handFields(form({ quote: "" }), false), (e: unknown) => e instanceof FieldError && e.field === "quote", "words from the message are needed");
  assert.equal(handFields(form({ quote: "" }), true).quote, undefined, "a call note is its own evidence");
});

test("an empty Log a call names every missing field, in page order, and focuses the first", () => {
  assert.deepEqual(callMissing("", "", true).map(m => m.field), ["grower", "note", "who"]);
  const e = callRefusal("", "", true)!;
  assert.equal(e.message, "Still needed: who called, the call note and your name.");
  assert.equal(e.field, "grower");
  assert.equal(callRefusal("grower-a", "", true)?.message, "Still needed: the call note and your name.");
  assert.equal(callRefusal("grower-a", "", false), undefined, "one missing field keeps its own message");
  assert.equal(callRefusal("grower-a", "Rang about Friday", false), undefined);
});

test("Review says one honest thing per state", () => {
  const base = { call: false, closed: false, handShown: false, startComplete: false, live: 0 };
  assert.equal(unreadNote(base), "This message has not been read yet. Enter the details below.");
  assert.equal(unreadNote({ ...base, handShown: true }), "This message has not been read yet. Check the details below, then save and approve.");
  assert.equal(unreadNote({ ...base, startComplete: true }), "This message has not been read yet. Save these details, then approve.");
  assert.equal(unreadNote({ ...base, live: 2 }), "This message has not been read yet. Use Read automatically below, or enter the details yourself.");
  assert.equal(unreadNote({ ...base, call: true }), "Check what they said. Enter the details below.");
  assert.equal(unreadNote({ ...base, closed: true }), "This message has not been read yet.");
  assert.deepEqual(stopNote("hand", true), { text: CHANGED, on: RECHECK }, "the recheck message");
  assert.deepEqual(stopNote("reply", true), { text: CHANGED, on: RECHECK });
  assert.deepEqual(stopNote("reply", false), { text: WAITING_REPLY }, "the waiting note");
  assert.deepEqual(stopNote("hand", false), { text: WAITING_HAND });
  assert.equal(WAITING_REPLY, "Answers applied. One more detail needs an answer.");
  assert.equal(CHANGED, "You changed the details, so check the change below, then approve.");
});

test("the actions pass the shown hash through to the composed approves, and the row offers Dismiss only for a dismiss row", () => {
  const actions = readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8"), page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(actions, /readByHandAndApprove\(.*, shown\)/);
  assert.match(actions, /replyAndApprove\(.*, shown\)/);
  assert.match(page, /action === "dismiss" \? \(\s*<form action=\{dismissNoChangeAction\}/);
  assert.match(page, /action === "review" && ready \? \(\s*<span className="act"><a [^>]*href=\{`\/review\?item=/, "Review it is a link, never a form");
});
