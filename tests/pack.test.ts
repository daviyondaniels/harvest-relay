import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/quantity.ts";
import { CONTACTS } from "../src/demo.ts";
import { lockGate, lockPlan, lockState, orderSheets, pickLists } from "../src/pack.ts";
import { propose } from "../evaluation/scenario.ts";
import { proposeAllocations } from "../src/planner.ts";
import { recordBuyerReply, sendMessage, unresolved } from "../src/resolve.ts";
import type { Source } from "../src/updates.ts";
import { approve, interpret, preview, receive, type Workbench } from "../src/workbench.ts";
import { ME, MORE, T, askB, more, morning, pick, start, zucchini } from "./story.ts";

// The Task 7 story end state: order-b covered by 30 lb more tomatoes and zucchini by call note.
function resolved(): Workbench {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = receive(w, MORE, T(20));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, more(w), "test reading", ME, T(21));
  w = approve(w, id, ME, preview(w, id).reviewHash!, T(22));
  w = start(w, pick(w, zucchini), 30);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(31));
  return recordBuyerReply(w, "res-2", { channel: "call", text: "Called kitchen manager, zucchini is fine for the rest.", accept: true }, ME, T(40));
}

test("a resolved plan locks and is valid", () => {
  const w = resolved();
  assert.deepEqual(unresolved(w), []);
  assert.equal(lockState(w), "none");
  const locked = lockPlan(w, ME, T(50), { shipShort: false });
  assert.equal(lockState(locked), "valid");
  assert.equal(w.lock, undefined, "input unchanged");
  assert.deepEqual(locked.lock!.shippedShort, []);
  assert.equal(locked.lock!.lockedBy, ME);
});

test("pick lines say what is left over on the lot, and sheets carry the delivery day and grade", () => {
  const lock = lockPlan(resolved(), ME, T(50), { shipShort: false }).lock!;
  for (const l of pickLists(lock).flatMap(g => g.lines)) {
    const lot = lock.snapshot.lots.find(x => x.id === l.lotId)!;
    assert.equal(l.leftOver, normalize(lot.quantity).amount - l.total);
    assert.ok(l.leftOver >= 0);
    assert.equal(l.deliveryOn, lot.deliveryOn);
  }
  for (const s of orderSheets(lock)) {
    assert.equal(s.deliveryOn, lock.snapshot.orders.find(o => o.id === s.orderId)!.deliveryOn);
    for (const line of s.lines) assert.equal(line.grade, lock.snapshot.lots.find(x => x.id === line.lotId)!.grade);
  }
});

test("pick lists add up to the plan's allocations", () => {
  const lock = lockPlan(resolved(), ME, T(50), { shipShort: false }).lock!;
  const lists = pickLists(lock);
  assert.equal(new Set(lists.map(l => l.growerId)).size, lists.length);
  const listed = lists.flatMap(l => l.lines).reduce((n, x) => n + x.total, 0);
  assert.equal(listed, lock.plan.allocations.reduce((n, a) => n + a.amount, 0));
  for (const g of lists) for (const x of g.lines) assert.equal(x.total, x.to.reduce((n, t) => n + t.amount, 0));
  assert.ok(lists.find(l => l.growerId === "grower-b")!.lines.some(x => x.lotId === "lot-d" && x.product === "zucchini" && x.total === 30));
});

test("the order-b sheet shows the zucchini substitute and nothing short", () => {
  const sheets = orderSheets(lockPlan(resolved(), ME, T(50), { shipShort: false }).lock!);
  const b = sheets.find(s => s.orderId === "order-b")!;
  assert.deepEqual(b.lines.find(l => l.product === "zucchini"), { product: "zucchini", grade: "standard", lotId: "lot-d", growerId: "grower-b", amount: 30, substitute: true });
  assert.equal(b.lines.filter(l => !l.substitute).reduce((n, l) => n + l.amount, 0), 50);
  assert.equal(b.short, 0);
  assert.equal(b.shippedShortUntold, false);
  assert.equal(b.buyerId, "buyer-b");
});

test("Review Focus 4: approving another update lapses the lock", () => {
  let w = lockPlan(resolved(), ME, T(50), { shipShort: false });
  assert.equal(lockState(w), "valid");
  const extra: Source = { id: "msg-extra", revision: 1, growerId: "grower-a", text: "Another 10 lb of standard tomatoes Friday." };
  w = receive(w, extra, T(51));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, propose(w.ledger, "p-extra", extra, { operation: "add-quantity", lotId: "lot-a", quantity: { amount: 10, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another 10 lb of standard tomatoes", "Friday"] }), "test reading", ME, T(52));
  w = approve(w, id, ME, preview(w, id).reviewHash!, T(53));
  assert.equal(lockState(w), "lapsed");
  assert.ok(w.lock, "the old lock is kept so the UI can say it lapsed");
});

test("a fresh 60 lb short blocks the lock unless Ship short is chosen and recorded", () => {
  const w = morning();
  assert.deepEqual(lockGate(w).blocking, ["order-b"]);
  assert.throws(() => lockPlan(w, ME, T(50), { shipShort: false }), /resolve/);
  const locked = lockPlan(w, ME, T(50), { shipShort: true });
  assert.equal(lockState(locked), "valid");
  assert.deepEqual(locked.lock!.shippedShort, [{ orderId: "order-b", amount: 60, unit: "lb", buyerTold: false }]);
  const sheets = orderSheets(locked.lock!);
  const b = sheets.find(s => s.orderId === "order-b")!;
  assert.deepEqual([b.short, b.shippedShortUntold], [60, true]);
  assert.equal(sheets.find(s => s.orderId === "order-a")!.shippedShortUntold, false);
  assert.equal(w.lock, undefined);
});

test("warnings list inbox items still open, pending or returned and never block", () => {
  let w = resolved();
  const open: Source = { id: "msg-open", revision: 1, growerId: "grower-c", text: "Maybe some beans." };
  w = receive(w, open, T(45));
  const id = w.items.at(-1)!.id;
  assert.deepEqual(lockGate(w), { blocking: [], warnings: [id] });
  assert.equal(lockState(lockPlan(w, ME, T(50), { shipShort: false })), "valid");
});

test("the locked plan is the verified plan for the live ledger", () => {
  const w = resolved();
  assert.deepEqual(lockPlan(w, ME, T(50), { shipShort: false }).lock!.plan, proposeAllocations(w.ledger.snapshot));
});

test("a buyer-told short is not recorded as shipped short", () => {
  let w = morning();
  w = start(w, pick(w, o => o.kind === "notify-short"), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.deepEqual(lockGate(w).blocking, []);
  const locked = lockPlan(w, ME, T(50), { shipShort: false });
  assert.deepEqual(locked.lock!.shippedShort, []);
  const b = orderSheets(locked.lock!).find(s => s.orderId === "order-b")!;
  assert.deepEqual([b.short, b.shippedShortUntold], [60, false]);
});
