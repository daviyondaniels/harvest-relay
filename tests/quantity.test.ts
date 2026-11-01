import test from "node:test";
import assert from "node:assert/strict";
import { scenario, shortage } from "../evaluation/scenario.ts";
import { normalize } from "../src/quantity.ts";
import { createLedger, reviewUpdate } from "../src/updates.ts";

test("pounds are their own base unit, exact and never converted to grams", () => {
  assert.deepEqual(normalize({ amount: 30, unit: "lb" }), { amount: 30, unit: "lb" });
  assert.deepEqual(normalize({ amount: 4, unit: "case", pack: { amount: 10, unit: "lb" } }), { amount: 40, unit: "lb" });
});

test("a kg quantity against a lb lot asks for a compatible unit", () => {
  const l = createLedger(scenario());
  l.snapshot.lots[0].quantity = { amount: 100, unit: "lb" };
  const p = shortage(l);
  assert.ok(reviewUpdate(l, p).questions.some(q => q.field === "unit"));
});

test("amount limits: more than the hub handles is refused, the limit itself is allowed", async () => {
  const { MAX_AMOUNT } = await import("../src/quantity.ts");
  assert.equal(MAX_AMOUNT, 100_000);
  assert.deepEqual(normalize({ amount: MAX_AMOUNT, unit: "lb" }), { amount: 100_000, unit: "lb" });
  for (const q of [{ amount: 100_001, unit: "lb" }, { amount: 100_001, unit: "each" }, { amount: 100_001, unit: "kg" }] as const) assert.throws(() => normalize(q), /more than this hub handles \(over 100,000 lb, or 2,000 per case\)\. Check it\./);
  assert.throws(() => normalize({ amount: 99_999_999_999, unit: "lb" }), /more than this hub handles/);
});

test("case packs: zero and more than 2,000 per case are refused, 2,000 is allowed", () => {
  const c = (amount: number) => ({ amount: 2, unit: "case", pack: { amount, unit: "lb" } }) as const;
  assert.throws(() => normalize(c(0)), /Case contents must be more than zero/);
  assert.throws(() => normalize(c(2001)), /more than this hub handles \(over 100,000 lb, or 2,000 per case\)\. Check it\./);
  assert.deepEqual(normalize(c(2000)), { amount: 4000, unit: "lb" });
});
