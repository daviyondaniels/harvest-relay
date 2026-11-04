import test from "node:test";
import assert from "node:assert/strict";
import { commitOrderChange, previewOrderChange } from "../src/order-change.ts";
import { CONFIRM_FIRST, changedOrderQuantities, confirmPlan, markStage, stageable } from "../src/commitments.ts";
import { changedBuyers } from "../src/pack.ts";
import { snapshotHash } from "../src/planner.ts";
import { dayRecord } from "../app/lib/record.ts";
import { changedSheets } from "../app/lib/cut.ts";
import { staleSinceConfirm } from "../app/lib/view.ts";
import { ME, T, morning, start, pick, zucchini } from "./story.ts";
const change = { orderId: "order-a", amount: 130, reason: "Buyer requested ten more pounds by phone." };
const apply = (w: ReturnType<typeof morning>, c = change) => commitOrderChange(w, c, previewOrderChange(w, c).reviewHash, ME, T(80));

test("order preview is pure; named commit records exact demand, reason and hashes in the day export", () => {
  const w = morning(), before = JSON.stringify(w), p = previewOrderChange(w, change);
  assert.equal(JSON.stringify(w), before);
  assert.equal(p.before.amount, 120); assert.equal(p.after.amount, 130);
  assert.ok(p.impact.some(x => x.orderId === change.orderId));
  assert.throws(() => commitOrderChange(w, change, "", ME, T(80)), /matches the preview/);
  assert.throws(() => commitOrderChange(w, change, p.reviewHash, "", T(80)), /Actor name/);
  const next = apply(w), e = next.orderChanges![0];
  assert.equal(JSON.stringify(w), before);
  assert.equal(next.ledger.version, w.ledger.version + 1); assert.equal(next.ledger.snapshot.version, w.ledger.snapshot.version + 1);
  assert.equal(e.beforeHash, snapshotHash(w.ledger.snapshot)); assert.equal(e.afterHash, snapshotHash(next.ledger.snapshot));
  assert.equal(e.by, ME); assert.equal(e.reason, change.reason);
  assert.deepEqual(dayRecord(next, 2, T(90)).orderChanges, next.orderChanges);
  assert.throws(() => commitOrderChange(next, change, p.reviewHash, ME, T(90)), /different quantity/);
});

test("preview confirmation binds supply, demand, reason and commitment state", () => {
  const w = morning(), p = previewOrderChange(w, change);
  for (const mutate of [
    (x: typeof w) => { x.ledger.snapshot.lots[0].quantity.amount--; },
    (x: typeof w) => { x.ledger.version++; },
    (x: typeof w) => { x.ledger.snapshot.orders[1].quantity.amount++; }
  ]) {
    const moved = structuredClone(w); mutate(moved);
    assert.throws(() => commitOrderChange(moved, change, p.reviewHash, ME, T(80)), /matches the preview/);
  }
  assert.throws(() => commitOrderChange(w, { ...change, reason: "Different reason" }, p.reviewHash, ME, T(80)), /matches the preview/);
  const confirmed = confirmPlan(w, ME, T(70), { shipShort: true });
  assert.throws(() => commitOrderChange(confirmed, change, p.reviewHash, ME, T(80)), /matches the preview/);
});

test("invalid changes, reductions below promises, packed orders and open requests are refused atomically", () => {
  const w = morning(), before = JSON.stringify(w);
  for (const c of [{ ...change, amount: 0 }, { ...change, amount: -1 }, { ...change, amount: 1.5 }, { ...change, amount: 100001 }, { ...change, reason: "" }, { ...change, orderId: "missing" }]) assert.throws(() => previewOrderChange(w, c));
  assert.equal(JSON.stringify(w), before);
  const confirmed = confirmPlan(w, ME, T(70), { shipShort: true });
  assert.throws(() => previewOrderChange(confirmed, { ...change, amount: 119 }), /promised/);
  const packed = markStage(confirmed, "order-a", "packed", ME, T(75));
  assert.throws(() => previewOrderChange(packed, change), /already packed/);
  const handed = markStage(packed, "order-a", "handed-off", ME, T(76));
  assert.throws(() => previewOrderChange(handed, change), /already packed/);
  const requested = start(w, pick(w, zucchini), 10);
  assert.throws(() => previewOrderChange(requested, { ...change, orderId: "order-b" }), /open request/);
});

test("quantity-only change marks the sheet stale even when allocations do not move, and reconfirmation restores packing", () => {
  const w = confirmPlan(morning(), ME, T(70), { shipShort: true }), next = apply(w);
  assert.deepEqual(next.ledger.commitments!.promised, w.ledger.commitments!.promised);
  assert.deepEqual(changedOrderQuantities(next.ledger), ["order-a"]);
  assert.equal(staleSinceConfirm(next), true); assert.ok(changedSheets(next.ledger).orders.has("order-a"));
  assert.ok(changedBuyers(next.ledger).includes(w.ledger.snapshot.orders.find(o => o.id === "order-a")!.buyerId));
  assert.throws(() => markStage(next, "order-a", "packed", ME, T(81)), { message: CONFIRM_FIRST });
  assert.ok(!stageable(next, "packed").includes("order-a"));
  const confirmed = confirmPlan(next, ME, T(82), { shipShort: true });
  assert.ok(stageable(confirmed, "packed").includes("order-a")); assert.equal(staleSinceConfirm(confirmed), false);
});

test("legacy confirmations acquire pre-edit demand without pretending the edited demand was confirmed", () => {
  const w = confirmPlan(morning(), ME, T(70), { shipShort: true });
  delete w.ledger.commitments!.confirmed.orderQuantities;
  const next = apply(w);
  assert.equal(next.ledger.commitments!.confirmed.orderQuantities!["order-a"].amount, 120);
  assert.deepEqual(changedOrderQuantities(next.ledger), ["order-a"]);
});

test("impact preview includes other buyers whose proposed allocations change", () => {
  const w = morning(), p = previewOrderChange(w, { ...change, amount: 100 });
  assert.ok(p.impact.some(x => x.orderId === "order-b" && x.afterCovered > x.beforeCovered));
  const next = apply(w, { ...change, amount: 100 });
  assert.deepEqual(next.ledger.snapshot.orders[0].approvedSubstitutions, w.ledger.snapshot.orders[0].approvedSubstitutions);
});
