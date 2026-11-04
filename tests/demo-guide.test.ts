import test from "node:test";
import assert from "node:assert/strict";
import { demoProgress } from "../src/demo-guide.ts";
import { demoSnapshot } from "../src/demo.ts";
import { createLedger } from "../src/updates.ts";
import { createWorkbench } from "../src/workbench.ts";
import { confirmPlan } from "../src/commitments.ts";
import { previewOrderChange, commitOrderChange } from "../src/order-change.ts";
import { ME, T, morning } from "./story.ts";

test("guide never counts untouched seed coverage as resolving the later shortage", () => {
  assert.deepEqual(demoProgress(createWorkbench(createLedger(demoSnapshot()))), { reduction: false, cases: false, covered: false, confirmed: false, late: false });
  assert.deepEqual(demoProgress(morning()), { reduction: true, cases: true, covered: false, confirmed: false, late: false });
});

test("guide confirmation progress follows current demand, not merely presence of a confirmation record", () => {
  const w = confirmPlan(morning(), ME, T(70), { shipShort: true });
  assert.equal(demoProgress(w).confirmed, true); assert.equal(demoProgress(w).late, false);
  const change = { orderId: "order-a", amount: 130, reason: "Buyer requested more" };
  const next = commitOrderChange(w, change, previewOrderChange(w, change).reviewHash, ME, T(80));
  assert.equal(demoProgress(next).confirmed, false);
});
