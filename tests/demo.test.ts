import assert from "node:assert/strict";
import test from "node:test";
import { BUYERS, CONTACTS, demoSnapshot } from "../src/demo.ts";
import { proposeAllocations, validateSnapshot } from "../src/planner.ts";
import { SEED, seedWorkbench } from "../src/seed.ts";

test("the demo hub snapshot is valid and in pounds", () => {
  validateSnapshot(demoSnapshot());
  assert.ok(demoSnapshot().lots.every(l => l.quantity.unit === "lb"));
});

test("the demo hub's only shortfall is cucumber, with no zucchini yet", () => {
  const { unfilled } = proposeAllocations(demoSnapshot());
  assert.equal(unfilled.length, 1);
  assert.deepEqual({ orderId: unfilled[0].orderId, amount: unfilled[0].amount, unit: unfilled[0].unit }, { orderId: "order-c", amount: 20, unit: "lb" });
});

test("the demo seeds four uninterpreted messages in pounds and cases", async () => {
  const w = await seedWorkbench(undefined);
  assert.equal(w.items.length, 4);
  assert.ok(!w.items.some(i => i.source.id === "msg-injection"), "the rule-changing message is delivered by Demo tools, not seeded");
  assert.ok(w.items.every(i => !i.proposal));
  assert.ok(SEED.every(m => /lb|cases/.test(m.source.text)));
});

test("contacts name the growers and an outside source; buyers are named", () => {
  assert.deepEqual(CONTACTS.map(c => [c.id, c.kind]), [["grower-a", "member"], ["grower-b", "member"], ["grower-c", "member"], ["outside-1", "outside"]]);
  assert.equal(BUYERS["buyer-c"], "Eastside Community Pantry");
});

test("the seed is stamped at reset time: the same offsets between messages, received just before each now", async () => {
  const offsets = (w: Awaited<ReturnType<typeof seedWorkbench>>) => w.items.map(i => Date.parse(i.receivedAt) - Date.parse(w.items[0].receivedAt));
  const nowA = "2026-11-04T15:00:00.000Z", nowB = "2027-02-10T09:30:00.000Z";
  const a = await seedWorkbench(undefined, nowA), b = await seedWorkbench(undefined, nowB);
  const authored = SEED.map(m => Date.parse(m.receivedAt) - Date.parse(SEED[0].receivedAt));
  assert.deepEqual(offsets(a), authored);
  assert.deepEqual(offsets(b), authored);
  for (const [w, now] of [[a, nowA], [b, nowB]] as const) {
    const times = w.items.map(i => Date.parse(i.receivedAt));
    assert.ok(times.every(t => t <= Date.parse(now) && Date.parse(now) - t <= 3 * 3600_000), "every message is received within the three hours before now");
    assert.equal(Math.max(...times), Date.parse(now), "the newest message arrives at reset time");
    assert.ok(w.items.every(i => i.decisions[0].at === i.receivedAt));
  }
});
