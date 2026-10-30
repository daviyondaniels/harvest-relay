import test from "node:test";
import assert from "node:assert/strict";
import { scenario, shortage, surplus } from "../evaluation/scenario.ts";
import { proposeAllocations, verifyPlan, snapshotHash, type Promised, type Snapshot } from "../src/planner.ts";
import { demoSnapshot } from "../src/demo.ts";
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
  assert.throws(() => normalize({ amount: 4, unit: "oz" } as unknown as Quantity), /Unsupported/);
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

test("a capped substitute is allocated no more than its cap, with residuals still accounted", () => {
  // order-c wants 30 kg of cucumber, has 20, and may take zucchini; 30 kg of zucchini is on hand.
  const s = scenario(), o = s.orders[2];
  s.lots[3].quantity.amount = 30;
  const given = (p: ReturnType<typeof proposeAllocations>) => p.allocations.filter(a => a.orderId === o.id && a.kind === "approved-substitution").reduce((n, a) => n + a.amount, 0);
  assert.equal(given(proposeAllocations(s)), 10_000);
  const capped = structuredClone(s);
  capped.orders[2].approvedSubstitutions[0].maxAmount = 4000;
  const plan = proposeAllocations(capped);
  verifyPlan(capped, plan);
  assert.equal(given(plan), 4000, "the cap binds");
  assert.deepEqual(plan.unfilled.map(u => [u.orderId, u.amount]), [["order-c", 6000]]);
  assert.deepEqual(proposeAllocations(capped), plan);
  assert.throws(() => { const bad = structuredClone(capped); bad.orders[2].approvedSubstitutions[0].maxAmount = 0; proposeAllocations(bad); }, /cap/);
});

// Promised allocations are placed first; the priority/ID rule then plans the rest.
const promiseSnap = (lotAmount: number): Snapshot => {
  const lb = (amount: number) => ({ amount, unit: "lb" as const }), base = { acceptedGrades: ["standard"], deliveryOn: "2026-10-30", approvedSubstitutions: [] };
  return { version: 0,
    lots: [{ id: "lot-x", growerId: "grower-a", product: "tomato", grade: "standard", quantity: lb(lotAmount), deliveryOn: "2026-10-30", confirmed: true }],
    orders: [{ id: "order-hi", buyerId: "buyer-a", product: "tomato", quantity: lb(100), priority: 2, ...base }, { id: "order-lo", buyerId: "buyer-b", product: "tomato", quantity: lb(60), priority: 1, ...base }] };
};
const promiseLo = (amount: number): Promised => ({ orderId: "order-lo", lotId: "lot-x", amount, unit: "lb", kind: "requested" });
const got = (plan: ReturnType<typeof proposeAllocations>, orderId: string) => plan.allocations.filter(a => a.orderId === orderId).reduce((n, a) => n + a.amount, 0);

test("with no promises the plan is unchanged", () => {
  const s = demoSnapshot(), plain = proposeAllocations(s), none = proposeAllocations(s, []);
  assert.deepEqual(none, plain);
  assert.equal("promisesHash" in plain, false); assert.equal("promisesHash" in none, false);
});

test("promised supply stays with its order even when priority would move it", () => {
  const s = promiseSnap(100), copy = structuredClone(s), plan = proposeAllocations(s, [promiseLo(60)]);
  assert.equal(got(plan, "order-lo"), 60); assert.equal(got(plan, "order-hi"), 40);
  assert.deepEqual(plan.unfilled.map(u => [u.orderId, u.amount]), [["order-hi", 60]]);
  assert.ok(plan.promisesHash);
  verifyPlan(s, plan, [promiseLo(60)]);
  assert.deepEqual(s, copy);
});

test("extra supply goes to remaining need only", () => {
  const plan = proposeAllocations(promiseSnap(160), [promiseLo(60)]);
  assert.equal(got(plan, "order-hi"), 100); assert.equal(got(plan, "order-lo"), 60);
  verifyPlan(promiseSnap(160), plan, [promiseLo(60)]);
});

test("a zero-amount promise places nothing", () => {
  const plan = proposeAllocations(promiseSnap(100), [promiseLo(0)]);
  assert.equal(got(plan, "order-hi"), 100); assert.equal(got(plan, "order-lo"), 0);
});

test("promises above the lot or the order are refused", () => {
  assert.throws(() => proposeAllocations(promiseSnap(50), [promiseLo(60)]), /Promises exceed the lot/);
  assert.throws(() => proposeAllocations(promiseSnap(100), [promiseLo(61)]), /Promises exceed the order/);
  assert.throws(() => proposeAllocations(promiseSnap(100), [promiseLo(40), promiseLo(30)]), /Promises exceed the order/);
});

test("ineligible promises are refused", () => {
  assert.throws(() => proposeAllocations(promiseSnap(100), [{ ...promiseLo(10), lotId: "nope" }]), /Ineligible promise/);
  assert.throws(() => proposeAllocations(promiseSnap(100), [{ ...promiseLo(10), kind: "approved-substitution" }]), /Ineligible promise/);
});

test("two promises on one lot that together exceed it are refused", () => {
  const hi: Promised = { ...promiseLo(30), orderId: "order-hi" };
  assert.throws(() => proposeAllocations(promiseSnap(50), [hi, promiseLo(30)]), /Promises exceed the lot/);
  assert.doesNotThrow(() => proposeAllocations(promiseSnap(60), [hi, promiseLo(30)]));
});

test("a promise is ineligible when the date, unit or grade does not match", () => {
  const dated = promiseSnap(100); dated.lots[0].deliveryOn = "2026-10-31";
  assert.throws(() => proposeAllocations(dated, [promiseLo(10)]), /Ineligible promise/);
  assert.throws(() => proposeAllocations(promiseSnap(100), [{ ...promiseLo(10), unit: "case" as never }]), /Ineligible promise/);
  const graded = promiseSnap(100); graded.lots[0].grade = "premium";
  assert.throws(() => proposeAllocations(graded, [promiseLo(10)]), /Ineligible promise/);
});

test("verifyPlan leaves its inputs unchanged", () => {
  const s = promiseSnap(100), promised = [promiseLo(60)], plan = proposeAllocations(s, promised);
  const before = JSON.stringify([s, plan, promised]);
  verifyPlan(s, plan, promised);
  assert.throws(() => verifyPlan(s, proposeAllocations(s), promised), /Plan drops a promise/);
  assert.equal(JSON.stringify([s, plan, promised]), before);
});

test("verifyPlan refuses a plan that drops a promise", () => {
  const s = promiseSnap(100), promised = [promiseLo(60)], plan = proposeAllocations(s, promised);
  const cut = structuredClone(plan), a = cut.allocations.find(x => x.orderId === "order-lo")!;
  a.amount -= 10;
  const un = cut.unfilled.find(u => u.orderId === "order-lo");
  if (un) un.amount += 10; else cut.unfilled.push({ orderId: "order-lo", amount: 10, unit: "lb", reason: "x" });
  cut.unallocated.push({ lotId: "lot-x", amount: 10, unit: "lb", confirmed: true });
  assert.throws(() => verifyPlan(s, cut, promised), /Plan drops a promise|Residual/);
  const lowered = { ...cut, promisesHash: plan.promisesHash };
  assert.throws(() => verifyPlan(s, lowered, promised), /Plan drops a promise/);
  assert.throws(() => verifyPlan(s, proposeAllocations(s), promised), /Plan drops a promise/);
});

test("a promised substitute counts toward its cap", () => {
  const s = demoSnapshot();
  s.orders.find(o => o.id === "order-c")!.approvedSubstitutions[0].maxAmount = 30;
  s.lots.find(l => l.id === "lot-d")!.quantity = { amount: 40, unit: "lb" };
  s.lots.find(l => l.id === "lot-c")!.quantity = { amount: 0, unit: "lb" }; // no cucumbers, so the cap is what binds
  const promised: Promised[] = [{ orderId: "order-c", lotId: "lot-d", amount: 20, unit: "lb", kind: "approved-substitution" }];
  const plan = proposeAllocations(s, promised);
  assert.equal(plan.allocations.filter(a => a.orderId === "order-c" && a.kind === "approved-substitution").reduce((n, a) => n + a.amount, 0), 30);
  verifyPlan(s, plan, promised);
  assert.throws(() => proposeAllocations(s, [{ ...promised[0], amount: 31 }]), /over the agreed substitute amount/i);
});
