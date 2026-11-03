import test from "node:test";
import assert from "node:assert/strict";
import { propose } from "../evaluation/scenario.ts";
import { changedSinceConfirm, confirmPlan, conflicts, decideCut, held, markAllStage, markStage, planOf, stageOf, stageable } from "../src/commitments.ts";
import { changedBuyers, lockGate, orderSheets, pickLists } from "../src/pack.ts";
import { acceptSubstitute, addLot } from "../src/orders.ts";
import { proposeAllocations, snapshotHash } from "../src/planner.ts";
import { LATE, canReceiveLate, lateRefusal, needsReset } from "../src/seed.ts";
import type { Source } from "../src/updates.ts";
import { approve, interpret, preview, receive, type Workbench } from "../src/workbench.ts";
import { promiseText, weight } from "../app/lib/format.ts";
import { ME, T, morning, resolved } from "./story.ts";

const confirmed = () => confirmPlan(resolved(), ME, T(50), { shipShort: false });
let n = 0;
// The grower of lot-b (Birch Hollow) approves a new total or an addition for it.
function change(w: Workbench, operation: "replace-total" | "add-quantity", amount: number, m = 60): Workbench {
  const source: Source = { id: `msg-lot-b-${++n}`, revision: 1, growerId: "grower-b", text: `${operation === "replace-total" ? "Down to" : "Another"} ${amount} lb of standard tomatoes Friday.` };
  w = receive(w, source, T(m));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, propose(w.ledger, `p-${n}`, source, { operation, lotId: "lot-b", quantity: { amount, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: [`${amount} lb of standard tomatoes`, "Friday"] }), "test reading", ME, T(m));
  return approve(w, id, ME, preview(w, id).reviewHash!, T(m));
}
const drop = (w: Workbench, to: number, m = 60) => change(w, "replace-total", to, m);
const total = (w: Workbench, orderId: string) => planOf(w.ledger).allocations.filter(a => a.orderId === orderId).reduce((s, a) => s + a.amount, 0);
const short = (w: Workbench, orderId: string) => planOf(w.ledger).unfilled.find(u => u.orderId === orderId)?.amount ?? 0;

test("before any confirm the plan is the same as today", () => {
  const w = resolved();
  assert.deepEqual(planOf(w.ledger), proposeAllocations(w.ledger.snapshot));
  assert.deepEqual(held(w.ledger), []);
  assert.deepEqual(conflicts(w.ledger), []);
  assert.deepEqual(changedSinceConfirm(w.ledger), []);
  assert.deepEqual(stageOf(w.ledger, "order-a"), { stage: "planned", promised: 0, ordered: 120, unit: "lb", confirmedBefore: false });
});

test("reading the commitments never changes the ledger", () => {
  const w = drop(markStage(confirmed(), "order-a", "packed", ME, T(55)), 70);
  const before = JSON.stringify(w.ledger);
  const plan = planOf(w.ledger); conflicts(w.ledger); held(w.ledger); stageOf(w.ledger, "order-a"); changedSinceConfirm(w.ledger, plan); changedSinceConfirm(w.ledger);
  assert.equal(JSON.stringify(w.ledger), before);
});

test("confirming promises every allocation and records who and when", () => {
  const w = resolved(), before = JSON.stringify(w), c = confirmPlan(w, ME, T(50), { shipShort: false }), m = c.ledger.commitments!;
  assert.equal(JSON.stringify(w), before, "input unchanged");
  assert.deepEqual(m.promised, planOf(w.ledger).allocations.map(a => ({ orderId: a.orderId, lotId: a.lotId, amount: a.amount, unit: a.unit, kind: a.kind })));
  assert.deepEqual(m.confirmed, { by: ME, at: T(50), promised: m.promised });
  assert.deepEqual(m.log, [{ kind: "confirmed", by: ME, at: T(50), promised: m.promised, shipShort: [] }]);
  assert.equal(c.ledger.version, w.ledger.version, "promises do not move the ledger version");
  assert.equal(snapshotHash(c.ledger.snapshot), snapshotHash(w.ledger.snapshot));
  assert.deepEqual(stageOf(c.ledger, "order-a"), { stage: "promised", promised: 120, ordered: 120, unit: "lb", confirmedBefore: true });
  assert.deepEqual(planOf(c.ledger).allocations, planOf(w.ledger).allocations, "nothing moves with no supply change");
  assert.equal(planOf(c.ledger).promisesHash !== undefined, true);
  assert.throws(() => confirmPlan(w, " ", T(50), { shipShort: false }), /Actor name/);
  assert.throws(() => confirmPlan(w, ME, "later", { shipShort: false }), /timestamp/);
});

test("a drop below promises is a conflict that names the lot, the drop and the suggested cut", () => {
  const c = confirmed(), w = drop(c, 70), [k, ...rest] = conflicts(w.ledger);
  assert.equal(rest.length, 0);
  assert.deepEqual(k, {
    lotId: "lot-b", product: "tomato", unit: "lb", lot: 70, promisedTotal: 110, excess: 40,
    promises: [{ orderId: "order-a", amount: 60, stage: "promised" }, { orderId: "order-b", amount: 50, stage: "promised" }],
    suggestion: [{ orderId: "order-b", amount: 40 }]
  });
  assert.equal(total(w, "order-a"), 120);
  assert.equal(short(w, "order-b"), 40);
  assert.equal(w.ledger.commitments!.promised.find(p => p.orderId === "order-b" && p.lotId === "lot-b")!.amount, 50, "the recorded promise waits for the coordinator");
  assert.deepEqual(changedSinceConfirm(w.ledger), [{ orderId: "order-b", lotId: "lot-b", was: 50, now: 10, unit: "lb" }]);
  const sheet = orderSheets(w.ledger).find(s => s.orderId === "order-b")!;
  assert.equal(sheet.lines.find(l => l.lotId === "lot-b")!.was, 50);
  assert.equal(sheet.lines.find(l => l.lotId === "lot-d")!.was, undefined);
  assert.equal(sheet.short, 40);
  assert.equal(pickLists(w.ledger).flatMap(g => g.lines).find(l => l.lotId === "lot-b")!.total, 70);
});

test("an open conflict blocks packing and confirming, even with Ship short", () => {
  const w = drop(confirmed(), 70), before = JSON.stringify(w);
  assert.ok(lockGate(w).blocking.includes("order-a") && lockGate(w).blocking.includes("order-b"));
  assert.throws(() => confirmPlan(w, ME, T(70), { shipShort: false }), /Decide who takes the cut first/);
  assert.throws(() => confirmPlan(w, ME, T(70), { shipShort: true }), /Decide who takes the cut first/);
  assert.throws(() => markStage(w, "order-a", "packed", ME, T(70)), /Decide who takes the cut first/);
  assert.throws(() => markStage(w, "order-b", "packed", ME, T(70)), /Decide who takes the cut first/);
  assert.equal(JSON.stringify(w), before);
});

// The cut event also records the exact promise lines it reduced (used to change a cut); these tests look at the rest.
const noRemoved = (e: unknown) => { const { removed: _r, ...rest } = e as Record<string, unknown>; return rest; };
test("deciding the suggested cut rewrites the promise and logs it as suggested", () => {
  const w = drop(confirmed(), 70), before = JSON.stringify(w), d = decideCut(w, "lot-b", [{ orderId: "order-b", amount: 40 }], 40, ME, T(71));
  assert.equal(JSON.stringify(w), before, "input unchanged");
  assert.deepEqual(conflicts(d.ledger), []);
  assert.equal(d.ledger.commitments!.promised.find(p => p.orderId === "order-b" && p.lotId === "lot-b")!.amount, 10);
  assert.deepEqual(noRemoved(d.ledger.commitments!.log.at(-1)), { kind: "cut", by: ME, at: T(71), lotId: "lot-b", cuts: [{ orderId: "order-b", amount: 40 }], suggested: true });
  assert.equal(d.ledger.version, w.ledger.version);
  assert.equal(total(d, "order-a"), 120);
  assert.equal(short(d, "order-b"), 40);
  assert.ok(confirmPlan(d, ME, T(72), { shipShort: true }).ledger.commitments, "confirming is open again");
});

test("the coordinator can give the cut to another order on the lot", () => {
  const d = decideCut(drop(confirmed(), 70), "lot-b", [{ orderId: "order-a", amount: 40 }], 40, ME, T(71));
  assert.deepEqual(noRemoved(d.ledger.commitments!.log.at(-1)), { kind: "cut", by: ME, at: T(71), lotId: "lot-b", cuts: [{ orderId: "order-a", amount: 40 }], suggested: false });
  assert.equal(total(d, "order-b"), 80);
  assert.equal(short(d, "order-a"), 40);
  assert.deepEqual(conflicts(d.ledger), []);
  const split = decideCut(drop(confirmed(), 70), "lot-b", [{ orderId: "order-a", amount: 15 }, { orderId: "order-b", amount: 25 }], 40, ME, T(71));
  assert.deepEqual(noRemoved(split.ledger.commitments!.log.at(-1)), { kind: "cut", by: ME, at: T(71), lotId: "lot-b", cuts: [{ orderId: "order-a", amount: 15 }, { orderId: "order-b", amount: 25 }], suggested: false });
});

test("a cut that does not total the excess, exceeds a promise, or names a stale excess is refused and changes nothing", () => {
  const w = drop(confirmed(), 70), before = JSON.stringify(w);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 30 }], 40, ME, T(71)), /total exactly 40/);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 50 }], 40, ME, T(71)), /total exactly 40/);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 40 }], 30, ME, T(71)), /Supply changed since this was shown/);
  assert.throws(() => decideCut(w, "lot-x", [{ orderId: "order-b", amount: 40 }], 40, ME, T(71)), /Supply changed/);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 20 }, { orderId: "order-b", amount: 20 }], 40, ME, T(71)), /once/);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 41 }, { orderId: "order-a", amount: -1 }], 40, ME, T(71)), /whole number/);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 40 }], 40, " ", T(71)), /Actor name/);
  // A promise cannot be cut by more than it holds: lot-b to 0 leaves excess 110.
  const zero = drop(confirmed(), 0), b0 = JSON.stringify(zero);
  assert.throws(() => decideCut(zero, "lot-b", [{ orderId: "order-b", amount: 60 }, { orderId: "order-a", amount: 50 }], 110, ME, T(71)), /more than that order's promise/);
  assert.equal(JSON.stringify(w), before);
  assert.equal(JSON.stringify(zero), b0);
});

test("a second drop on an open conflict recomputes it for the total drop", () => {
  const w = drop(drop(confirmed(), 70, 60), 50, 61), [k] = conflicts(w.ledger);
  assert.equal(conflicts(w.ledger).length, 1);
  assert.deepEqual([k.lot, k.promisedTotal, k.excess], [50, 110, 60]);
  assert.deepEqual(k.suggestion, [{ orderId: "order-b", amount: 50 }, { orderId: "order-a", amount: 10 }]);
  assert.equal(total(w, "order-a"), 110, "the provisional cut covers the whole drop");
  assert.equal(short(w, "order-b"), 80 - 30);
  assert.throws(() => decideCut(w, "lot-b", [{ orderId: "order-b", amount: 40 }], 40, ME, T(71)), /Supply changed/);
});

test("a lot dropping to zero cuts every promise on it", () => {
  const w = drop(confirmed(), 0), [k] = conflicts(w.ledger);
  assert.equal(k.excess, 110);
  assert.deepEqual(k.promises.map(p => p.orderId), ["order-a", "order-b"]);
  assert.deepEqual(k.suggestion, [{ orderId: "order-b", amount: 50 }, { orderId: "order-a", amount: 60 }]);
  assert.ok(planOf(w.ledger).allocations.every(a => a.lotId !== "lot-b"));
  const d = decideCut(w, "lot-b", k.suggestion!, 110, ME, T(71));
  assert.ok(d.ledger.commitments!.promised.every(p => p.lotId !== "lot-b"), "promises that reach 0 are dropped");
  assert.deepEqual(conflicts(d.ledger), []);
});

test("extra supply after confirm is planned, not promised, until confirmed again", () => {
  const w = confirmPlan(morning(), ME, T(50), { shipShort: true }), was = stageOf(w.ledger, "order-b").promised;
  assert.deepEqual(w.ledger.commitments!.shippedShort.map(s => s.orderId), ["order-b"]);
  const more = change(w, "add-quantity", 20);
  assert.deepEqual(conflicts(more.ledger), []);
  assert.equal(stageOf(more.ledger, "order-b").promised, was, "the promise did not grow");
  assert.equal(total(more, "order-b"), was + 20, "the extra is planned");
  assert.deepEqual(changedSinceConfirm(more.ledger), [{ orderId: "order-b", lotId: "lot-b", was: 20, now: 40, unit: "lb" }]);
  assert.equal(orderSheets(more.ledger).find(s => s.orderId === "order-b")!.lines.find(l => l.lotId === "lot-b")!.was, 20);
  const again = confirmPlan(more, ME, T(80), { shipShort: true });
  assert.equal(stageOf(again.ledger, "order-b").promised, was + 20);
  assert.deepEqual(changedSinceConfirm(again.ledger), []);
});

test("only packed orders on the lot: no suggestion, and the coordinator must choose", () => {
  let w = confirmed();
  w = markStage(w, "order-a", "packed", ME, T(51));
  w = markStage(w, "order-b", "packed", ME, T(52));
  w = drop(w, 70);
  const [k] = conflicts(w.ledger);
  assert.equal(k.suggestion, undefined);
  assert.deepEqual(k.promises.map(p => p.stage), ["packed", "packed"]);
  assert.equal(planOf(w.ledger).allocations.filter(a => a.lotId === "lot-b").reduce((n, a) => n + a.amount, 0), 70, "the plan verifies and hands out exactly what is left of the lot");
  const d = decideCut(w, "lot-b", [{ orderId: "order-b", amount: 40 }], 40, ME, T(71));
  assert.deepEqual(noRemoved(d.ledger.commitments!.log.at(-1)), { kind: "cut", by: ME, at: T(71), lotId: "lot-b", cuts: [{ orderId: "order-b", amount: 40 }], suggested: false });
  // With a packed and a promised order, only the promised one is suggested.
  const mixed = drop(markStage(confirmed(), "order-b", "packed", ME, T(51)), 70);
  assert.deepEqual(conflicts(mixed.ledger)[0].suggestion, [{ orderId: "order-a", amount: 40 }]);
});

test("stages: packed needs promised, handed off needs packed, and both are recorded with a name", () => {
  const w0 = resolved();
  assert.throws(() => markStage(w0, "order-a", "packed", ME, T(50)), /promised order/);
  const w = confirmPlan(w0, ME, T(50), { shipShort: false }), before = JSON.stringify(w);
  assert.throws(() => markStage(w, "order-a", "handed-off", ME, T(51)), /packed order/);
  assert.throws(() => markStage(w, "order-x", "packed", ME, T(51)), /Unknown order/);
  assert.throws(() => markStage(w, "order-a", "packed", "", T(51)), /Actor name/);
  const p = markStage(w, "order-a", "packed", ME, T(51));
  assert.equal(JSON.stringify(w), before, "input unchanged");
  assert.equal(stageOf(p.ledger, "order-a").stage, "packed");
  assert.equal(stageOf(p.ledger, "order-b").stage, "promised");
  assert.throws(() => markStage(p, "order-a", "packed", ME, T(52)), /promised order/);
  const h = markStage(p, "order-a", "handed-off", "Driver", T(60));
  assert.equal(stageOf(h.ledger, "order-a").stage, "handed-off");
  assert.deepEqual(h.ledger.commitments!.log.slice(-2), [
    { kind: "stage", by: ME, at: T(51), orderId: "order-a", stage: "packed" }, { kind: "stage", by: "Driver", at: T(60), orderId: "order-a", stage: "handed-off" }]);
  assert.equal(orderSheets(h.ledger).find(s => s.orderId === "order-a")!.stage, "handed-off");
});

test("changed lines show what was confirmed", () => {
  const c = confirmed();
  assert.deepEqual(changedSinceConfirm(c.ledger), []);
  const gone = decideCut(drop(c, 0), "lot-b", [{ orderId: "order-b", amount: 50 }, { orderId: "order-a", amount: 60 }], 110, ME, T(71));
  assert.deepEqual(changedSinceConfirm(gone.ledger), [{ orderId: "order-a", lotId: "lot-b", was: 60, now: 0, unit: "lb" }, { orderId: "order-b", lotId: "lot-b", was: 50, now: 0, unit: "lb" }]);
  const sheets = orderSheets(gone.ledger);
  // A cut line stays on the sheet at 0, marked with what was confirmed.
  for (const [id, was] of [["order-a", 60], ["order-b", 50]] as const) {
    const line = sheets.find(s => s.orderId === id)!.lines.find(l => l.lotId === "lot-b");
    assert.ok(line, `${id} keeps its cut line`);
    assert.deepEqual([line.amount, line.was], [0, was]);
  }
  // A line on a lot the order had no promise on is new: was 0.
  const w = confirmPlan(morning(), ME, T(50), { shipShort: true });
  const added = addLot(w.ledger, { id: "lot-e", growerId: "grower-c", product: "tomato", grade: "standard", quantity: { amount: 10, unit: "lb" }, deliveryOn: "2026-10-30", confirmed: true },
    { messageId: "in-3", channel: "text", quote: "10 lb more" }, ME);
  const fresh = changedSinceConfirm(added);
  assert.ok(fresh.length > 0 && fresh.every(x => x.lotId === "lot-e" && x.was === 0 && x.now > 0), JSON.stringify(fresh));
  const x = fresh[0], newLine = orderSheets(added).find(s => s.orderId === x.orderId)!.lines.find(l => l.lotId === "lot-e")!;
  assert.deepEqual([newLine.amount, newLine.was], [x.now, 0]);
});

test("ledger updates keep the commitments", () => {
  const c = confirmed(), kept = structuredClone(c.ledger.commitments);
  const updated = drop(c, 100);
  assert.deepEqual(updated.ledger.commitments, kept, "commitUpdate");
  const sub = acceptSubstitute(c.ledger, "order-a", { product: "cucumber", acceptedGrades: ["standard"] }, { messageId: "in-1", channel: "call", quote: "Cucumbers are fine" }, ME);
  assert.deepEqual(sub.commitments, kept, "acceptSubstitute");
  const added = addLot(c.ledger, { id: "lot-e", growerId: "grower-c", product: "tomato", grade: "standard", quantity: { amount: 10, unit: "lb" }, deliveryOn: "2026-10-30", confirmed: true },
    { messageId: "in-2", channel: "text", quote: "10 lb more" }, ME);
  assert.deepEqual(added.commitments, kept, "addLot");
  assert.equal("commitments" in morning().ledger, false, "a fresh ledger has none");
});

test("needsReset is true for a stored state with the old lock", () => {
  const w = morning();
  assert.equal(needsReset(w), false);
  assert.equal(needsReset({ ...w, lock: { snapshotHash: "x" } } as never), true);
});

test("the late message is refused before a confirm and once it has arrived", () => {
  const w = resolved(), c = confirmed();
  assert.equal(canReceiveLate(w), false); assert.equal(lateRefusal(w), "Confirm today's plan first");
  assert.equal(canReceiveLate(c), true); assert.equal(lateRefusal(c), undefined);
  const got = receive(c, LATE.source, T(60));
  assert.equal(canReceiveLate(got), false); assert.equal(lateRefusal(got), "That message has already arrived");
});

test("sheets and pick lists say a cut is not decided while a conflict is open", () => {
  const c = confirmed(), calm = orderSheets(c.ledger);
  assert.ok(calm.every(s => s.undecided === false) && pickLists(c.ledger).every(g => g.lines.every(x => x.undecided === false)));
  const w = drop(c, 70), before = JSON.stringify(w), sheets = orderSheets(w.ledger);
  assert.equal(JSON.stringify(w), before);
  assert.deepEqual(sheets.map(s => [s.orderId, s.undecided]), sheets.map(s => [s.orderId, s.orderId === "order-a" || s.orderId === "order-b"]));
  const lines = pickLists(w.ledger).flatMap(g => g.lines);
  assert.equal(lines.find(x => x.lotId === "lot-b")!.undecided, true);
  assert.ok(lines.filter(x => x.lotId !== "lot-b").every(x => !x.undecided));
  const d = decideCut(w, "lot-b", [{ orderId: "order-b", amount: 40 }], 40, ME, T(71));
  assert.ok(orderSheets(d.ledger).every(s => !s.undecided) && pickLists(d.ledger).every(g => g.lines.every(x => !x.undecided)));
});

test("pick lists mark changed lines with what was confirmed", () => {
  const w = drop(confirmed(), 70), to = pickLists(w.ledger).flatMap(g => g.lines).find(x => x.lotId === "lot-b")!.to;
  assert.equal(to.find(t => t.orderId === "order-b")!.was, 50);
  assert.equal(to.find(t => t.orderId === "order-a")!.was, undefined);
});

test("confirming again keeps earlier shipped-short records", () => {
  const w = confirmPlan(morning(), ME, T(50), { shipShort: true }), first = structuredClone(w.ledger.commitments!.shippedShort);
  assert.equal(first.length, 1);
  const filled = change(w, "add-quantity", 200), before = JSON.stringify(filled);
  assert.equal(short(filled, "order-b"), 0);
  const again = confirmPlan(filled, ME, T(80), { shipShort: true });
  assert.equal(JSON.stringify(filled), before);
  assert.deepEqual(again.ledger.commitments!.shippedShort, first, "the record stays, with its amount");
  const part = confirmPlan(change(w, "add-quantity", 20), ME, T(81), { shipShort: true });
  assert.deepEqual(part.ledger.commitments!.shippedShort, first, "no duplicate and the first amount stands");
});

test("an order cut to 0 after a confirm still reads as promised, 0 of N", () => {
  const w = structuredClone(confirmed()), m = w.ledger.commitments!;
  m.promised = m.promised.filter(p => p.orderId !== "order-b");
  const s = stageOf(w.ledger, "order-b");
  assert.deepEqual([s.stage, s.promised, s.confirmedBefore], ["promised", 0, true]);
  assert.deepEqual(promiseText(s, 0), [`Promised 0 of ${weight(s.ordered, s.unit)}`]);
  assert.throws(() => markStage(w, "order-b", "packed", ME, T(72)), /promised order/);
  const never = stageOf(morning().ledger, "order-b");
  assert.deepEqual([never.stage, never.confirmedBefore], ["planned", false]);
  assert.deepEqual(promiseText(never, 0), []);
});

test("mark all marks every order that can take the stage, and refuses the rest as markStage would", () => {
  const c = confirmed(), ids = c.ledger.snapshot.orders.map(o => o.id), before = JSON.stringify(c);
  const both = stageable(c, "packed");
  assert.ok(both.length >= 2);
  assert.deepEqual(stageable(c, "handed-off"), [], "nothing is packed yet, so nothing can be handed off");
  assert.throws(() => markAllStage(c, "handed-off", ME, T(60)), /No order can be marked handed off/);
  const one = markStage(c, both[0], "packed", ME, T(55)), rest = markAllStage(one, "packed", ME, T(56));
  assert.deepEqual(rest.marked, both.slice(1), "an order already packed is skipped");
  assert.ok(ids.every(id => !both.includes(id) || stageOf(rest.next.ledger, id).stage === "packed"));
  assert.equal(JSON.stringify(c), before, "input unchanged");
  assert.deepEqual(stageable(rest.next, "handed-off"), both);
  assert.equal(markAllStage(rest.next, "handed-off", ME, T(57)).marked.length, both.length);
  assert.throws(() => markAllStage(c, "packed", " ", T(60)), /Actor name/);
});

test("mark all skips an order an open cut touches, exactly as markStage refuses it", () => {
  const w = drop(confirmed(), 70);
  assert.throws(() => markStage(w, "order-b", "packed", ME, T(70)), /Decide who takes the cut first/);
  assert.ok(!stageable(w, "packed").includes("order-b") && !stageable(w, "packed").includes("order-a"));
});

test("the stale banner names the buyers whose lines changed", () => {
  const c = confirmed();
  assert.deepEqual(changedBuyers(c.ledger), []);
  const w = drop(c, 70), owner = (id: string) => w.ledger.snapshot.orders.find(o => o.id === id)!.buyerId;
  assert.deepEqual(changedBuyers(w.ledger), [owner("order-b")]);
  assert.deepEqual(changedBuyers(morning().ledger), [], "nothing is stale before a confirm");
});
