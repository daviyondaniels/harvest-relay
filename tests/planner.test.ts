import test from "node:test";
import assert from "node:assert/strict";
import { scenario, shortage, surplus } from "../evaluation/scenario.ts";
import { proposeAllocations, verifyPlan, snapshotHash } from "../src/planner.ts";
import { normalize, type Quantity } from "../src/quantity.ts";
import { commitUpdate, createLedger, reviewUpdate } from "../src/updates.ts";

test("baseline and approved changes preserve shortages and surplus honestly", () => {
  let l = createLedger(scenario());
  const original = scenario();
  const before = proposeAllocations(l.snapshot); verifyPlan(l.snapshot, before);
  assert.deepEqual(before.unfilled.map(x => [x.orderId, x.amount]), [["order-c", 10000]]);
  const p = shortage(l);
  l = commitUpdate(l, p, { reviewer: "test", reviewHash: reviewUpdate(l, p).hash });
  const unknown = surplus(l);
  assert.deepEqual(reviewUpdate(l, unknown).questions.map(q => q.field).sort(), ["operation", "pack"]);
  assert.throws(() => commitUpdate(l, unknown, { reviewer: "test", reviewHash: reviewUpdate(l, unknown).hash }), /Clarification/);
  const q = surplus(l, true);
  l = commitUpdate(l, q, { reviewer: "test", reviewHash: reviewUpdate(l, q).hash });
  const s = l.snapshot, after = proposeAllocations(s); verifyPlan(s, after);
  assert.deepEqual(after.unfilled.map(x => [x.orderId, x.amount]), [["order-b", 30000]]);
  assert.deepEqual(after.unallocated.map(x => [x.lotId, x.amount]), [["lot-d", 10000]]);
  assert.equal(after.allocations.find(x => x.kind === "approved-substitution")?.amount, 10000);
  assert.equal(s.version, 2);
  assert.deepEqual(original, scenario());
});

test("unit conversion requires explicit pack size and never guesses weight from counts", () => {
  assert.deepEqual(normalize({ amount: 4, unit: "case", pack: { amount: 5000, unit: "g" } }), { amount: 20000, unit: "g" });
  assert.throws(() => normalize({ amount: 4, unit: "case" }), /Clarify/);
  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => normalize({ amount, unit: "kg" }));
  }
  assert.throws(() => normalize({ amount: 4, unit: "lb" } as unknown as Quantity), /Unsupported/);
  const s = scenario(); s.lots[0].quantity = { amount: 60000, unit: "each" };
  const plan = proposeAllocations(s); verifyPlan(s, plan);
  assert.ok(!plan.allocations.some(x => x.lotId === "lot-a"));
});

test("unconfirmed supply, wrong date, grade and unapproved substitutions cannot satisfy orders", () => {
  for (const alter of [
    (s: ReturnType<typeof scenario>) => { s.lots[0].confirmed = false; },
    (s: ReturnType<typeof scenario>) => { s.lots[0].deliveryOn = "2026-10-31"; },
    (s: ReturnType<typeof scenario>) => { s.lots[0].grade = "processing"; },
    (s: ReturnType<typeof scenario>) => { s.lots[0].product = "pepper"; }
  ]) {
    const s = scenario(); alter(s); const p = proposeAllocations(s); verifyPlan(s, p);
    assert.ok(!p.allocations.some(a => a.lotId === "lot-a"));
  }
  const s = scenario(); s.lots[3].quantity.amount = 20; s.orders[2].approvedSubstitutions = [];
  const p = proposeAllocations(s); verifyPlan(s, p);
  assert.ok(!p.allocations.some(a => a.lotId === "lot-d"));
});

test("all direct demand is considered before another order consumes approved substitutes", () => {
  const s = scenario(); s.lots[3].quantity.amount = 20;
  s.orders.push({ ...structuredClone(s.orders[2]), id: "order-z", product: "zucchini", quantity: { amount: 20, unit: "kg" }, priority: 0, approvedSubstitutions: [] });
  const p = proposeAllocations(s); verifyPlan(s, p);
  assert.ok(p.allocations.some(a => a.orderId === "order-z" && a.amount === 20000));
  assert.ok(p.unfilled.some(a => a.orderId === "order-c" && a.amount === 10000));
});

test("duplicate IDs and invalid dates fail before planning", () => {
  const s = scenario(); s.lots.push(structuredClone(s.lots[0]));
  assert.throws(() => proposeAllocations(s), /Duplicate/);
  for (const value of ["2026-02-30", "Friday", "2026-13-01"]) {
    const t = scenario(); t.orders[0].deliveryOn = value;
    assert.throws(() => proposeAllocations(t), /date/);
  }
});

test("stale snapshots, altered proposals, missing evidence and unit-changing updates are blocked", () => {
  const l = createLedger(scenario()), p = shortage(l), approval = { reviewer: "test", reviewHash: reviewUpdate(l, p).hash };
  const changed = structuredClone(p); changed.interpretation.quantity!.amount = 29;
  assert.throws(() => commitUpdate(l, changed, approval), /approval/);
  const first = commitUpdate(l, p, approval);
  assert.throws(() => commitUpdate(first, p, approval), /Duplicate/);
  assert.throws(() => commitUpdate(l, p, { ...approval, reviewer: " " }), /approval/);
  assert.throws(() => reviewUpdate(l, { ...p, interpretation: { ...p.interpretation, spans: [{ start: 0, end: 9999 }] } }), /evidence/);
  assert.match(reviewUpdate(l, { ...p, interpretation: { ...p.interpretation, quantity: { amount: 30, unit: "each" } } }).questions[0].question, /base unit/);
  assert.equal(first.events[0].beforeHash, snapshotHash(l.snapshot));
  assert.equal(first.events[0].afterHash, snapshotHash(first.snapshot));
});

test("independent verifier rejects overselling, missing residuals and forbidden products", () => {
  const s = scenario(); const p = proposeAllocations(s);
  const excessive = structuredClone(p); excessive.allocations[0].amount += 1;
  assert.throws(() => verifyPlan(s, excessive), /Over-allocation/);
  const hidden = structuredClone(p); hidden.unfilled = [];
  assert.throws(() => verifyPlan(s, hidden), /Residual/);
  const forged = structuredClone(p); forged.allocations[0].lotId = "lot-c";
  assert.throws(() => verifyPlan(s, forged), /Unapproved/);
  const changed = structuredClone(s); changed.version += 1;
  assert.throws(() => verifyPlan(changed, p), /Stale/);
});

test("deterministic generated cases conserve every lot and order across permissions and units", () => {
  // Repeatable development property checks, not a customer or model holdout.
  let seed = 9301;
  const rand = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let i = 0; i < 200; i++) {
    const s = scenario();
    for (const l of s.lots) { l.quantity.amount = rand(100); l.confirmed = rand(4) !== 0; if (rand(4) === 0) l.grade = "processing"; }
    for (const o of s.orders) { o.quantity.amount = rand(100); o.priority = rand(4); if (rand(2) === 0) o.approvedSubstitutions = []; }
    const before = structuredClone(s);
    const p = proposeAllocations(s); verifyPlan(s, p);
    assert.deepEqual(s, before);
    assert.deepEqual(proposeAllocations({ ...s, lots: [...s.lots].reverse(), orders: [...s.orders].reverse() }).allocations, p.allocations);
  }
});
