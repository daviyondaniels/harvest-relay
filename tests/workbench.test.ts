import test from "node:test";
import assert from "node:assert/strict";
import { propose, scenario } from "../evaluation/scenario.ts";
import { ME, morning, short } from "./story.ts";
import { logCall } from "../src/resolve.ts";
import { normalize } from "../src/quantity.ts";
import { createLedger, type Ledger } from "../src/updates.ts";
import { BY_HAND, madeShort, needingRefresh, readByHand, suggestReading, approve, ask, confirmLot, correct, createWorkbench, dismiss, interpret, leavePending, preview, receive, refresh, refreshAll, refreshAndApprove, refreshableItems, reply, returnForClarification, type Workbench } from "../src/workbench.ts";

// The coordinator workbench on the synthetic hub. Every action returns a new state and
// leaves the old one untouched, so a rejected action cannot corrupt the inbox.
const T = (m: number) => new Date(Date.UTC(2026, 9, 28, 9, m)).toISOString();
const CUKE = { id: "msg-cuke", revision: 1, growerId: "grower-a", text: "Another four cases of standard cucumbers for Friday." };
const cukeReading = (l: Ledger, operation: "add-quantity" | "replace-total" = "add-quantity") => propose(l, "p-cuke", CUKE,
  { operation, lotId: "lot-c", quantity: { amount: 4, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another four cases", "standard cucumbers", "Friday"] });
function inbox(): Workbench {
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, CUKE, T(12));
  return interpret(w, "item-1", cukeReading(w.ledger), "saved Meta reading", "coordinator", T(13));
}

test("four cases stay blocked until case contents arrive, then preview add 12 kg -> 32 kg and the order impact", () => {
  let w = inbox();
  const blocked = preview(w, "item-1");
  assert.deepEqual(blocked.questions.map(q => q.field), ["pack"]);
  assert.equal(blocked.change, undefined);
  assert.deepEqual(blocked.orders.find(o => o.orderId === "order-c")!.before, { direct: 20000, substitute: 0, short: 10000 });
  assert.throws(() => approve(w, "item-1", "coordinator", blocked.reviewHash!, T(14)), /Clarification required/);

  w = ask(w, "item-1", "pack", "How much is in each case?", "coordinator", T(14));
  w = reply(w, "item-1", { id: "msg-cuke-reply", revision: 1, growerId: "grower-a", text: "3 kg in each" }, [{ field: "pack", quote: "3 kg in each", value: { amount: 3, unit: "kg" } }], [], "coordinator", T(31));
  const ready = preview(w, "item-1");
  assert.deepEqual(ready.questions, []);
  assert.deepEqual([ready.change!.effect, normalize(ready.change!.before).amount, normalize(ready.change!.after).amount], ["add-quantity", 20000, 32000]);
  assert.deepEqual(ready.orders.find(o => o.orderId === "order-c")!.after, { direct: 30000, substitute: 0, short: 0 });
  assert.deepEqual(ready.unallocated.find(u => u.lotId === "lot-c"), { lotId: "lot-c", unit: "g", before: 0, after: 2000 });

  w = approve(w, "item-1", "coordinator", ready.reviewHash!, T(33));
  const done = w.items[0];
  assert.deepEqual([done.state, done.eventId, normalize(w.ledger.snapshot.lots.find(l => l.id === "lot-c")!.quantity).amount], ["approved", "event-1", 32000]);
  assert.deepEqual(done.decisions.map(d => d.kind), ["received", "interpreted", "asked", "replied", "approved"]);
  assert.deepEqual([done.decisions.at(-1)!.actor, done.decisions.at(-1)!.eventId], ["coordinator", "event-1"]);
  assert.deepEqual(done.replies.map(r => r.text), ["3 kg in each"]);
  assert.throws(() => dismiss(w, "item-1", "too late", "coordinator", T(40)), /approved/);
});

test("a change to inventory before approval requires a refreshed review, and rejected actions leave state unchanged", () => {
  let w = inbox();
  w = reply(w, "item-1", { id: "msg-cuke-reply", revision: 1, growerId: "grower-a", text: "3 kg in each" }, [{ field: "pack", quote: "3 kg in each", value: { amount: 3, unit: "kg" } }], [], "coordinator", T(20));
  const reviewed = preview(w, "item-1").reviewHash!;
  const tomato = { id: "msg-tom", revision: 1, growerId: "grower-a", text: "Only 30 kg of standard tomatoes for Friday, replacing the earlier 60 kg total." };
  w = receive(w, tomato, T(21));
  w = interpret(w, "item-2", propose(w.ledger, "p-tom", tomato, { operation: "replace-total", lotId: "lot-a", quantity: { amount: 30, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30",
    quotes: ["Only 30 kg of standard tomatoes", "Friday", "replacing the earlier 60 kg total"] }), "saved Meta reading", "coordinator", T(22));
  w = approve(w, "item-2", "coordinator", preview(w, "item-2").reviewHash!, T(23));

  const stale = preview(w, "item-1");
  assert.equal(stale.stale, true);
  assert.deepEqual([stale.needsRefresh, stale.error], [false, undefined], "checked again against current supply, read-only");
  const before = structuredClone(w);
  assert.throws(() => approve(w, "item-1", "coordinator", reviewed, T(24)), /Stale/);
  assert.deepEqual(w, before, "a rejected approval changes nothing");

  w = refresh(w, "item-1", "coordinator", T(25));
  const fresh = preview(w, "item-1");
  assert.notEqual(fresh.reviewHash, reviewed, "the old approval no longer matches");
  assert.throws(() => approve(w, "item-1", "coordinator", reviewed, T(26)), /Named approval/);
  w = approve(w, "item-1", "coordinator", fresh.reviewHash!, T(26));
  assert.equal(w.items[0].eventId, "event-2");
});

test("the coordinator corrects a reading from the message's own words, and the correction is recorded", () => {
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, CUKE, T(12));
  w = interpret(w, "item-1", cukeReading(w.ledger, "replace-total"), "saved Meta reading", "coordinator", T(13));
  assert.throws(() => correct(w, "item-1", [{ field: "operation", quote: "four cases more", value: "add-quantity" }], "coordinator", T(14)), /Literal source evidence/);
  w = correct(w, "item-1", [{ field: "operation", quote: "Another", value: "add-quantity" }], "coordinator", T(14));
  const d = w.items[0].decisions.at(-1)!;
  assert.equal(d.kind, "corrected");
  assert.deepEqual(d.corrections, [{ field: "operation", from: "replace-total", to: "add-quantity", quote: "Another" }]);
  assert.equal(w.items[0].proposal!.interpretation.operation, "add-quantity");
  assert.ok(w.items[0].proposal!.clarifications.some(c => c.question.startsWith("Coordinator reading of the message corrects operation")));
  w = confirmLot(w, "item-1", "coordinator", T(15));
  assert.equal(w.items[0].decisions.at(-1)!.note, "lot-c");
});

test("pending, returned and dismissed updates keep their history; a reply reopens a returned update", () => {
  let w = inbox();
  assert.throws(() => leavePending(w, "item-1", " ", "coordinator", T(14)), /Note required/);
  w = leavePending(w, "item-1", "Waiting for the grower's pack size", "coordinator", T(14));
  w = returnForClarification(w, "item-1", "Please confirm the weight per case", "coordinator", T(15));
  assert.equal(w.items[0].state, "returned");
  w = reply(w, "item-1", { id: "msg-cuke-reply", revision: 1, growerId: "grower-a", text: "3 kg in each" }, [{ field: "pack", quote: "3 kg in each", value: { amount: 3, unit: "kg" } }], [], "coordinator", T(16));
  assert.equal(w.items[0].state, "open");
  assert.throws(() => dismiss(w, "item-1", "", "coordinator", T(17)), /Reason required/);
  w = dismiss(w, "item-1", "Grower withdrew the update by phone", "coordinator", T(17));
  assert.deepEqual(w.items[0].decisions.map(d => d.kind), ["received", "interpreted", "left-pending", "returned", "replied", "dismissed"]);
  assert.equal(w.ledger.version, 0, "nothing reached inventory");
  assert.throws(() => interpret(w, "item-1", cukeReading(w.ledger), "x", "coordinator", T(18)), /dismissed/);
  assert.throws(() => receive(w, CUKE, T(19)), /already in the inbox/);
  const other = receive(inbox(), { ...CUKE, id: "msg-other" }, T(20));
  assert.throws(() => interpret(other, "item-2", cukeReading(other.ledger), "x", "coordinator", T(21)), /this item's message/);
});

// Task 17: a stale item is checked again read-only; replies, corrections and approvals
// refresh it first, under the same coordinator, in the same state change.
const TOM = { id: "msg-tom", revision: 1, growerId: "grower-a", text: "Only 30 kg of standard tomatoes for Friday, replacing the earlier 60 kg total." };
const tomReading = (l: Ledger) => propose(l, "p-tom", TOM, { operation: "replace-total", lotId: "lot-a", quantity: { amount: 30, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30",
  quotes: ["Only 30 kg of standard tomatoes", "Friday", "replacing the earlier 60 kg total"] });
const CUKE_REPLY = { id: "msg-cuke-reply", revision: 1, growerId: "grower-a", text: "3 kg in each" };
const PACK = [{ field: "pack" as const, quote: "3 kg in each", value: { amount: 3, unit: "kg" } }];
// The cucumber item (open pack question) made stale by approving a tomato cut.
function staleInbox(): Workbench {
  let w = inbox();
  w = receive(w, TOM, T(21));
  w = interpret(w, "item-2", tomReading(w.ledger), "saved Meta reading", "coordinator", T(22));
  return approve(w, "item-2", "coordinator", preview(w, "item-2").reviewHash!, T(23));
}
// Item-2 is open and needs a refresh (a newer correction raises a question); item-1 is approved.
function needingInbox(): Workbench {
  const TOMB = (id: string, text: string) => ({ id, revision: 1, growerId: "grower-b", text });
  let w = createWorkbench(createLedger(scenario()));
  const add = TOMB("msg-add", "Picked another 10 kg of standard tomatoes for Friday.");
  w = receive(w, add, T(1));
  w = interpret(w, "item-1", propose(w.ledger, "p-add", add, { operation: "add-quantity", lotId: "lot-b", quantity: { amount: 10, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["another 10 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(1));
  w = approve(w, "item-1", "coordinator", preview(w, "item-1").reviewHash!, T(2));
  const fix = TOMB("msg-fix", "Sorry, the first pick of standard tomatoes for Friday was 5 kg, not 10.");
  w = receive(w, fix, T(3));
  w = interpret(w, "item-2", propose(w.ledger, "p-fix", fix, { operation: "correction", lotId: "lot-b", quantity: { amount: 5, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: "event-1", quotes: ["5 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(3));
  const fix2 = TOMB("msg-fix-2", "Correction: the first pick of standard tomatoes for Friday was 7 kg.");
  w = receive(w, fix2, T(5));
  w = interpret(w, "item-3", propose(w.ledger, "p-fix-2", fix2, { operation: "correction", lotId: "lot-b", quantity: { amount: 7, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: "event-1", quotes: ["7 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(5));
  return approve(w, "item-3", "coordinator", preview(w, "item-3").reviewHash!, T(5));
}
const kinds = (w: Workbench, id: string) => w.items.find(i => i.id === id)!.decisions.map(d => [d.kind, d.actor]);

test("a stale item previews against current supply without changing state, and shows as normal when nothing new comes up", () => {
  const w = staleInbox(), before = structuredClone(w);
  const p = preview(w, "item-1");
  assert.deepEqual(w, before, "a preview never changes state");
  assert.deepEqual([p.stale, p.needsRefresh, p.error], [true, false, undefined]);
  assert.deepEqual(p.questions.map(q => q.field), ["pack"], "the same open question as before");
  assert.equal(p.reviewHash, preview(refresh(w, "item-1", "coordinator", T(24)), "item-1").reviewHash, "the hash of the review a refresh would produce");
});

test("a reply on a stale item refreshes it first under the same coordinator; approval still needs the new hash", () => {
  let w = staleInbox();
  const old = w.items[0].proposal!.baseVersion;
  w = reply(w, "item-1", CUKE_REPLY, PACK, [], "evening coordinator", T(30));
  assert.deepEqual(kinds(w, "item-1").slice(-2), [["refreshed", "evening coordinator"], ["replied", "evening coordinator"]]);
  assert.notEqual(w.items[0].proposal!.baseVersion, old);
  const ready = preview(w, "item-1");
  assert.deepEqual([ready.stale, ready.questions.length], [false, 0]);
  assert.throws(() => approve(w, "item-1", "coordinator", "not-the-hash", T(31)), /Named approval/);
  w = approve(w, "item-1", "coordinator", ready.reviewHash!, T(31));
  assert.equal(w.items[0].state, "approved");
});

test("a correction or a question on a stale item refreshes it first; a fresh item gets no refresh decision", () => {
  const corrected = correct(staleInbox(), "item-1", [{ field: "operation", quote: "Another", value: "add-quantity" }], "coordinator", T(30));
  assert.deepEqual(kinds(corrected, "item-1").slice(-2).map(([k]) => k), ["refreshed", "corrected"]);
  const asked = ask(staleInbox(), "item-1", "pack", "How much is in each case?", "coordinator", T(30));
  assert.deepEqual(kinds(asked, "item-1").slice(-2).map(([k]) => k), ["refreshed", "asked"]);
  const fresh = reply(inbox(), "item-1", CUKE_REPLY, PACK, [], "coordinator", T(30));
  assert.ok(!kinds(fresh, "item-1").some(([k]) => k === "refreshed"));
});

test("Refresh all leaves quietly stale items alone and refuses when nothing needs a refresh", () => {
  let w = staleInbox();
  const OTHER = { ...CUKE, id: "msg-other", text: "Another four cases of standard cucumbers for Friday, again." };
  w = receive(w, OTHER, T(24));
  w = interpret(w, "item-3", propose(w.ledger, "p-other", OTHER, { operation: "add-quantity", lotId: "lot-c", quantity: { amount: 4, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another four cases", "standard cucumbers", "Friday"] }), "saved Meta reading", "coordinator", T(24));
  const before = structuredClone(w);
  assert.deepEqual(refreshableItems(w), ["item-1"]);
  assert.deepEqual(needingRefresh(w), [], "item-1 is only quietly checked again, so nothing needs a refresh");
  assert.throws(() => refreshAll(w, "coordinator", T(25)), /Nothing needs a refresh/, "Refresh all does only what the count says");
  assert.deepEqual(w, before, "the caller's state is untouched");
  const one = refresh(w, "item-1", "coordinator", T(25));
  assert.equal(preview(one, "item-1").stale, false);
  assert.deepEqual(refreshableItems(one), []);
});

test("approving a stale item refreshes and approves at once, against the rebased review that was shown", () => {
  let w = staleInbox();
  w = reply(w, "item-1", CUKE_REPLY, PACK, [], "coordinator", T(24));
  // Supply moves again after the reply: the item is stale, and its rebased review is what the page shows.
  const CUT = { id: "msg-cut", revision: 1, growerId: "grower-a", text: "Only 20 kg of standard tomatoes for Friday, replacing the earlier 30 kg total." };
  w = receive(w, CUT, T(25));
  w = interpret(w, "item-3", propose(w.ledger, "p-cut", CUT, { operation: "replace-total", lotId: "lot-a", quantity: { amount: 20, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 20 kg of standard tomatoes", "Friday", "replacing the earlier 30 kg total"] }), "saved Meta reading", "coordinator", T(25));
  w = approve(w, "item-3", "coordinator", preview(w, "item-3").reviewHash!, T(26));
  const shown = preview(w, "item-1");
  assert.deepEqual([shown.stale, shown.needsRefresh, shown.questions.length], [true, false, 0]);
  assert.ok(shown.change, "the change is worked out against current supply");

  // The rebased review differs from what was shown (supply moved again): approval is refused, state unchanged.
  const CUT2 = { ...CUT, id: "msg-cut-2", text: "Only 10 kg of standard tomatoes for Friday, replacing the earlier 20 kg total." };
  let moved = receive(w, CUT2, T(27));
  moved = interpret(moved, "item-4", propose(moved.ledger, "p-cut-2", CUT2, { operation: "replace-total", lotId: "lot-a", quantity: { amount: 10, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 10 kg of standard tomatoes", "Friday", "replacing the earlier 20 kg total"] }), "saved Meta reading", "coordinator", T(27));
  moved = approve(moved, "item-4", "coordinator", preview(moved, "item-4").reviewHash!, T(28));
  const snapshot = structuredClone(moved);
  assert.throws(() => refreshAndApprove(moved, "item-1", "coordinator", shown.reviewHash!, T(29)), /Named approval/);
  assert.deepEqual(moved, snapshot, "a refused approval changes nothing");
  assert.throws(() => refreshAndApprove(w, "item-1", "coordinator", "not-the-hash", T(29)), /Named approval/);

  w = refreshAndApprove(w, "item-1", "coordinator", shown.reviewHash!, T(29));
  assert.deepEqual(kinds(w, "item-1").slice(-2), [["refreshed", "coordinator"], ["approved", "coordinator"]]);
  assert.equal(w.items[0].state, "approved");
});

test("Needs refresh only when the rebased review differs: a new question, or a reading that no longer applies", () => {
  const TOMB = (id: string, text: string) => ({ id, revision: 1, growerId: "grower-b", text });
  let w = createWorkbench(createLedger(scenario()));
  const add = TOMB("msg-add", "Picked another 10 kg of standard tomatoes for Friday.");
  w = receive(w, add, T(1));
  w = interpret(w, "item-1", propose(w.ledger, "p-add", add, { operation: "add-quantity", lotId: "lot-b", quantity: { amount: 10, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["another 10 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(1));
  w = approve(w, "item-1", "coordinator", preview(w, "item-1").reviewHash!, T(2));
  // A correction of that pick, ready to approve.
  const fix = TOMB("msg-fix", "Sorry, the first pick of standard tomatoes for Friday was 5 kg, not 10.");
  w = receive(w, fix, T(3));
  w = interpret(w, "item-2", propose(w.ledger, "p-fix", fix, { operation: "correction", lotId: "lot-b", quantity: { amount: 5, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: "event-1", quotes: ["5 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(3));
  // A revision 2 of another message, and its revision 1 still open.
  const r1 = TOMB("msg-rev", "Lot B: 52 kg of standard tomatoes for Friday."), r2 = { ...r1, revision: 2, text: "Lot B: 54 kg of standard tomatoes for Friday." };
  w = receive(w, r1, T(4));
  w = interpret(w, "item-3", propose(w.ledger, "p-rev-1", r1, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 52, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["52 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(4));
  assert.equal(preview(w, "item-2").questions.length, 0);
  // Another correction of the same pick is approved, and revision 2 supersedes revision 1.
  const fix2 = TOMB("msg-fix-2", "Correction: the first pick of standard tomatoes for Friday was 7 kg.");
  w = receive(w, fix2, T(5));
  w = interpret(w, "item-4", propose(w.ledger, "p-fix-2", fix2, { operation: "correction", lotId: "lot-b", quantity: { amount: 7, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: "event-1", quotes: ["7 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(5));
  w = approve(w, "item-4", "coordinator", preview(w, "item-4").reviewHash!, T(5));
  w = receive(w, r2, T(6));
  w = interpret(w, "item-5", propose(w.ledger, "p-rev-2", r2, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 54, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["54 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(6));
  w = approve(w, "item-5", "coordinator", preview(w, "item-5").reviewHash!, T(6));

  const question = preview(w, "item-2");
  assert.deepEqual([question.stale, question.needsRefresh], [true, true]);
  assert.deepEqual(needingRefresh(w), ["item-2"], "a new question needs a refresh; a reading that can no longer be reviewed is left as it is");
  assert.match(question.questions.map(q => q.question).join(), /newer correction/);
  assert.throws(() => refreshAndApprove(w, "item-2", "coordinator", question.reviewHash!, T(7)), /Clarification required/);
  const gone = preview(w, "item-3");
  assert.deepEqual([gone.stale, gone.needsRefresh], [true, true]);
  assert.match(gone.error!, /Superseded/);
});

test("Fix round 1: decisions on a stale item keep what the coordinator saw, so it does not turn to Needs refresh", () => {
  for (const act of [
    (w: Workbench) => leavePending(w, "item-1", "Waiting on the pack size", "coordinator", T(30)),
    (w: Workbench) => returnForClarification(w, "item-1", "Please confirm the pack size", "coordinator", T(30)),
    (w: Workbench) => confirmLot(w, "item-1", "coordinator", T(30))
  ]) {
    const w = act(staleInbox());
    assert.deepEqual(w.items[0].lastQuestions?.length, 1, "the pack question is still what was seen");
    assert.equal(preview(w, "item-1").needsRefresh, false);
  }
});

test("Fix round 1: a reply that fails after the refresh leaves the state unchanged", () => {
  const w = staleInbox(), before = structuredClone(w);
  assert.throws(() => reply(w, "item-1", CUKE_REPLY, [{ field: "pack", quote: "not in the reply", value: { amount: 3, unit: "kg" } }], [], "coordinator", T(30)));
  assert.deepEqual(w, before);
});

test("Final review: refreshAll refreshes exactly the items needingRefresh counts", () => {
  const w = needingInbox(), before = structuredClone(w);
  assert.deepEqual(needingRefresh(w), ["item-2"]);
  const next = refreshAll(w, "coordinator", T(30));
  assert.deepEqual(w, before);
  assert.deepEqual(next.items.map(i => i.decisions.filter(d => d.kind === "refreshed").length), [0, 1, 0]);
  assert.deepEqual(needingRefresh(next), []);
});

test("Fix round 1: refreshAll skips only items whose review fails, and rethrows anything else", () => {
  const w = needingInbox();
  w.items[1].decisions = Array.from({ length: 200 }, () => structuredClone(w.items[1].decisions[0]));
  assert.throws(() => refreshAll(w, "coordinator", T(30)), /Decision history is full/);
});

test("Fix round 1: a stale preview says what moved when the change starts from a different amount", () => {
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, TOM, T(1));
  w = interpret(w, "item-1", tomReading(w.ledger), "saved Meta reading", "coordinator", T(1));
  const ADD = { id: "msg-add", revision: 1, growerId: "grower-a", text: "Another 10 kg of standard tomatoes for Friday." };
  w = receive(w, ADD, T(2));
  w = interpret(w, "item-2", propose(w.ledger, "p-add", ADD, { operation: "add-quantity", lotId: "lot-a", quantity: { amount: 10, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another 10 kg", "standard tomatoes", "Friday"] }), "saved Meta reading", "coordinator", T(2));
  w = approve(w, "item-2", "coordinator", preview(w, "item-2").reviewHash!, T(3));
  const p = preview(w, "item-1");
  assert.deepEqual([p.stale, p.needsRefresh], [true, false]);
  assert.deepEqual(p.moved, { was: 60000, now: 70000, unit: "g" });
  assert.equal(preview(staleInbox(), "item-1").moved, undefined, "an item with no change yet has nothing to compare");
});

test("H2: a forecast previews the forecast amount, not the lot total, and changes no confirmed supply", () => {
  let w = createWorkbench(createLedger(scenario()));
  const source = { id: "msg-maybe", revision: 1, growerId: "grower-b", text: "Might have another 20 kg of standard tomatoes for Friday." };
  w = receive(w, source, T(10));
  w = interpret(w, "item-1", propose(w.ledger, "p-maybe", source, { operation: "forecast", lotId: "lot-b", quantity: { amount: 20, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30",
    quotes: ["another 20 kg of standard tomatoes", "Friday"] }), "saved reading", "coordinator", T(11));
  const c = preview(w, "item-1").change!;
  assert.equal(c.effect, "forecast");
  assert.deepEqual(normalize(c.expected!), { amount: 20000, unit: "g" }, "the forecast amount, not the 40 kg lot total");
  assert.deepEqual([normalize(c.before).amount, normalize(c.after).amount], [40000, 40000], "confirmed supply does not move");
});

test("Task 19: a reply's history keeps the grower's words and, apart, who read them", () => {
  let w = inbox();
  w = reply(w, "item-1", { id: "msg-cuke-reply", revision: 1, growerId: "grower-a", text: "3 kg in each" }, [{ field: "pack", quote: "3 kg in each", value: { amount: 3, unit: "kg" } }], [], "Hub coordinator", T(20));
  const d = w.items[0].decisions.at(-1)!;
  assert.deepEqual([d.kind, d.actor, d.note, d.by], ["replied", "Hub coordinator", "3 kg in each", "coordinator"]);
  assert.throws(() => approve(w, "item-1", "x".repeat(81), preview(w, "item-1").reviewHash!, T(21)), /at most 80 characters/, "the same name limit as the name field");
});

// Task 20: the coordinator writes the reading by hand, and the next step after an approval.
const callNote = (growerId: string, text: string) => logCall(morning(), growerId, text, ME, T(30));
test("a call note is read by hand: the form is prefilled from the words, the note is its own evidence, and approval changes supply", () => {
  const w0 = callNote("grower-b", "Called: we can add 30 lb of standard tomatoes for Friday.");
  assert.equal(w0.items.at(-1)!.proposal, undefined);
  const guess = suggestReading(w0, "item-4");
  assert.deepEqual(guess, { operation: "add-quantity", lotId: "lot-b", quantity: { amount: 30, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30" });
  const before = structuredClone(w0), hand = { ...guess, operation: "add-quantity" as const, lotId: "lot-b", quantity: { amount: 30, unit: "lb" as const }, grade: "standard", deliveryOn: "2026-10-30" };
  const w = readByHand(w0, "item-4", hand, ME, T(31));
  assert.deepEqual(w0, before);
  const it = w.items.at(-1)!;
  assert.deepEqual(it.decisions.map(d => d.kind), ["received", "interpreted", "corrected"]);
  assert.equal(it.interpretedBy, BY_HAND);
  const p = preview(w, "item-4");
  assert.deepEqual(p.questions, []);
  assert.equal(p.change?.effect, "add-quantity");
  assert.equal(short(w), 60);
  const done = approve(w, "item-4", ME, p.reviewHash!, T(32));
  assert.equal(short(done), 30);
  assert.deepEqual(madeShort(done, "item-4"), []);
});

test("hand entry on a typed message needs words from the message; wrong words and a bad lot are refused and change nothing", () => {
  let w = morning();
  w = receive(w, { id: "msg-hand", revision: 1, growerId: "grower-b", text: "We can bring another 30 lb of standard tomatoes Friday." }, T(40));
  const id = w.items.at(-1)!.id, hand = { operation: "add-quantity" as const, lotId: "lot-b", quantity: { amount: 30, unit: "lb" as const }, grade: "standard", deliveryOn: "2026-10-30" };
  const before = structuredClone(w);
  assert.throws(() => readByHand(w, id, hand, ME, T(41)), /Literal source evidence/);
  assert.throws(() => readByHand(w, id, { ...hand, quote: "not in the message" }, ME, T(41)), /Literal source evidence/);
  assert.throws(() => readByHand(w, id, { ...hand, quote: "another 30 lb", quantity: { amount: 1.5, unit: "lb" } }, ME, T(41)), /whole numbers/);
  assert.deepEqual(w, before);
  const ok = readByHand(w, id, { ...hand, quote: "another 30 lb" }, ME, T(41));
  assert.deepEqual(preview(ok, id).questions, []);
  // A lot of another grower is not accepted: review asks about it.
  const wrong = readByHand(w, id, { ...hand, lotId: "lot-a", quote: "another 30 lb" }, ME, T(41));
  assert.ok(preview(wrong, id).questions.some(q => q.field === "lot"));
  // A hand entry over an existing reading is a recorded correction.
  const fixed = readByHand(ok, id, { ...hand, quantity: { amount: 20, unit: "lb" }, quote: "another 30 lb" }, ME, T(42));
  assert.deepEqual(fixed.items.at(-1)!.decisions.at(-1)!.corrections?.map(c => c.field), ["quantity"]);
});

test("an approval that lowers a lot lists the orders it made short", () => {
  const w0 = callNote("grower-a", "Called: down to 20 lb of standard tomatoes for Friday, replacing the earlier total.");
  const guess = suggestReading(w0, "item-4");
  assert.equal(guess.operation, "replace-total");
  const w = readByHand(w0, "item-4", guess as Required<typeof guess>, ME, T(31));
  const done = approve(w, "item-4", ME, preview(w, "item-4").reviewHash!, T(32));
  const made = madeShort(done, "item-4");
  assert.ok(made.length > 0 && made.every(m => m.added > 0 && m.short >= m.added));
  assert.equal(made.reduce((n, m) => n + m.added, 0), short(done) + short(done, "order-a") - short(w) - short(w, "order-a"));
});
