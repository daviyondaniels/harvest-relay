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
