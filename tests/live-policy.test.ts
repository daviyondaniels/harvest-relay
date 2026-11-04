import test from "node:test";
import assert from "node:assert/strict";
import { remainingLiveCalls } from "../src/live-policy.ts";
test("public demos cannot consume paid inference even when the private server has a key and allowance", () => {
  const env = { HARVEST_PUBLIC_DEMO: "1", HARVEST_LIVE_CALLS: "100", MODEL_API_KEY: "test-only-not-a-key" };
  assert.equal(remainingLiveCalls(env, 0), 0);
  assert.equal(remainingLiveCalls({ ...env, HARVEST_PUBLIC_DEMO: "0" }, 2), 98);
  assert.equal(remainingLiveCalls({ ...env, HARVEST_PUBLIC_DEMO: "0" }, 101), 0);
});
test("private calls require an explicit positive integer budget and a key", () => {
  for (const cap of [undefined, "", "-1", "1.5", "NaN", "Infinity"]) assert.equal(remainingLiveCalls({ HARVEST_LIVE_CALLS: cap, MODEL_API_KEY: "test-only" }, 0), 0);
  assert.equal(remainingLiveCalls({ HARVEST_LIVE_CALLS: "10" }, 0), 0);
});
