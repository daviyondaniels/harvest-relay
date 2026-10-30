import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/quantity.ts";
import { CONTACTS } from "../src/demo.ts";
import { confirmPlan, conflicts, planOf } from "../src/commitments.ts";
import { lockGate, orderSheets, pickLists } from "../src/pack.ts";
import { propose } from "../evaluation/scenario.ts";
import { proposeAllocations } from "../src/planner.ts";
import { sendMessage, unresolved } from "../src/resolve.ts";
import type { Source } from "../src/updates.ts";
import { approve, interpret, preview, receive } from "../src/workbench.ts";
import { ME, T, morning, pick, resolved, start } from "./story.ts";

test("a resolved plan confirms and promises every allocation", () => {
  const w = resolved();
  assert.deepEqual(unresolved(w), []);
  assert.equal(w.ledger.commitments, undefined);
  const c = confirmPlan(w, ME, T(50), { shipShort: false });
  assert.equal(w.ledger.commitments, undefined, "input unchanged");
  assert.deepEqual(c.ledger.commitments!.shippedShort, []);
  assert.equal(c.ledger.commitments!.confirmed.by, ME);
  assert.deepEqual(conflicts(c.ledger), []);
});

test("pick lines say what is left over on the lot, and sheets carry the delivery day and grade", () => {
  const l = confirmPlan(resolved(), ME, T(50), { shipShort: false }).ledger;
  for (const x of pickLists(l).flatMap(g => g.lines)) {
    const lot = l.snapshot.lots.find(y => y.id === x.lotId)!;
    assert.equal(x.leftOver, normalize(lot.quantity).amount - x.total);
    assert.ok(x.leftOver >= 0);
    assert.equal(x.deliveryOn, lot.deliveryOn);
  }
  for (const s of orderSheets(l)) {
    assert.equal(s.deliveryOn, l.snapshot.orders.find(o => o.id === s.orderId)!.deliveryOn);
    for (const line of s.lines) assert.equal(line.grade, l.snapshot.lots.find(x => x.id === line.lotId)!.grade);
  }
});

test("pick lists add up to the plan's allocations", () => {
  const l = confirmPlan(resolved(), ME, T(50), { shipShort: false }).ledger;
  const lists = pickLists(l);
  assert.equal(new Set(lists.map(x => x.growerId)).size, lists.length);
  const listed = lists.flatMap(x => x.lines).reduce((n, x) => n + x.total, 0);
  assert.equal(listed, planOf(l).allocations.reduce((n, a) => n + a.amount, 0));
  for (const g of lists) for (const x of g.lines) assert.equal(x.total, x.to.reduce((n, t) => n + t.amount, 0));
  assert.ok(lists.find(x => x.growerId === "grower-b")!.lines.some(x => x.lotId === "lot-d" && x.product === "zucchini" && x.total === 30));
});

test("the order-b sheet shows the zucchini substitute and nothing short", () => {
  const sheets = orderSheets(confirmPlan(resolved(), ME, T(50), { shipShort: false }).ledger);
  const b = sheets.find(s => s.orderId === "order-b")!;
  assert.deepEqual(b.lines.find(l => l.product === "zucchini"), { product: "zucchini", grade: "standard", lotId: "lot-d", growerId: "grower-b", amount: 30, substitute: true });
  assert.equal(b.lines.filter(l => !l.substitute).reduce((n, l) => n + l.amount, 0), 50);
  assert.equal(b.short, 0);
  assert.equal(b.shippedShortUntold, false);
  assert.equal(b.buyerId, "buyer-b");
  assert.equal(b.stage, "promised");
  assert.equal(orderSheets(resolved().ledger).find(s => s.orderId === "order-b")!.stage, "planned");
});

test("Review Focus 4: approving another update after a confirm keeps the promises and plans the extra", () => {
  let w = confirmPlan(resolved(), ME, T(50), { shipShort: false });
  const extra: Source = { id: "msg-extra", revision: 1, growerId: "grower-a", text: "Another 10 lb of standard tomatoes Friday." };
  w = receive(w, extra, T(51));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, propose(w.ledger, "p-extra", extra, { operation: "add-quantity", lotId: "lot-a", quantity: { amount: 10, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another 10 lb of standard tomatoes", "Friday"] }), "test reading", ME, T(52));
  w = approve(w, id, ME, preview(w, id).reviewHash!, T(53));
  assert.ok(w.ledger.commitments, "the commitments are kept");
  assert.deepEqual(conflicts(w.ledger), []);
  assert.equal(orderSheets(w.ledger).find(s => s.orderId === "order-a")!.lines.length, 2);
});

test("a fresh 60 lb short blocks the confirm unless Ship short is chosen and recorded", () => {
  const w = morning();
  assert.deepEqual(lockGate(w).blocking, ["order-b"]);
  assert.throws(() => confirmPlan(w, ME, T(50), { shipShort: false }), /resolve/);
  const c = confirmPlan(w, ME, T(50), { shipShort: true });
  assert.deepEqual(c.ledger.commitments!.shippedShort, [{ orderId: "order-b", amount: 60, unit: "lb", buyerTold: false }]);
  const sheets = orderSheets(c.ledger);
  const b = sheets.find(s => s.orderId === "order-b")!;
  assert.deepEqual([b.short, b.shippedShortUntold], [60, true]);
  assert.equal(sheets.find(s => s.orderId === "order-a")!.shippedShortUntold, false);
  assert.equal(w.ledger.commitments, undefined);
});

test("warnings list inbox items still open, pending or returned and never block", () => {
  let w = resolved();
  const open: Source = { id: "msg-open", revision: 1, growerId: "grower-c", text: "Maybe some beans." };
  w = receive(w, open, T(45));
  const id = w.items.at(-1)!.id;
  assert.deepEqual(lockGate(w), { blocking: [], warnings: [id] });
  assert.ok(confirmPlan(w, ME, T(50), { shipShort: false }).ledger.commitments);
});

test("before any confirm the plan is the verified plan for the live ledger", () => {
  const w = resolved();
  assert.deepEqual(planOf(w.ledger), proposeAllocations(w.ledger.snapshot));
});

test("a buyer-told short is not recorded as shipped short", () => {
  let w = morning();
  w = start(w, pick(w, o => o.kind === "notify-short"), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.deepEqual(lockGate(w).blocking, []);
  const c = confirmPlan(w, ME, T(50), { shipShort: false });
  assert.deepEqual(c.ledger.commitments!.shippedShort, []);
  const b = orderSheets(c.ledger).find(s => s.orderId === "order-b")!;
  assert.deepEqual([b.short, b.shippedShortUntold], [60, false]);
});
