import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTACTS } from "../src/demo.ts";
import { confirmPlan, conflicts, decideCut, planOf } from "../src/commitments.ts";
import { orderStatus, recordBuyerReply, sendMessage } from "../src/resolve.ts";
import { BUYER_REPLIES, LATE } from "../src/seed.ts";
import { propose } from "../evaluation/scenario.ts";
import { ORDER_STATUS, mergeLines, resolvingLabel } from "../app/lib/format.ts";
import { ME, T, pick, resolved, start, take, zucchini } from "./story.ts";

// Task 30: Orders after telling the buyer.
const page = readFileSync(new URL("../app/orders/page.tsx", import.meta.url), "utf8");

// README steps 1-7: the story, confirmed, the late drop, the cut, then a second zucchini offer the buyer accepts.
function walk() {
  let w = confirmPlan(resolved(), ME, T(50), { shipShort: false });
  w = take(w, { ...LATE.source }, w => propose(w.ledger, "p-late", LATE.source,
    { operation: "replace-total", lotId: "lot-b", quantity: { amount: 70, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["only have 70 lb of standard", "Friday", "not 80"] }), 55);
  const found = conflicts(w.ledger)[0];
  w = decideCut(w, "lot-b", found.suggestion!, found.excess, ME, T(56));
  w = start(w, pick(w, zucchini), 60);
  w = sendMessage(w, "res-3", CONTACTS, ME, T(61));
  return recordBuyerReply(w, "res-3", { ...BUYER_REPLIES["buyer-b"], accept: true }, ME, T(62));
}

test("two zucchini lines on one lot are one lot of 40 lb: the planner splits them by permission, the page merges them", () => {
  const w = walk();
  const subs = planOf(w.ledger).allocations.filter(a => a.orderId === "order-b" && a.kind === "approved-substitution");
  assert.deepEqual(subs.map(a => [a.lotId, a.amount]), [["lot-d", 30], ["lot-d", 10]], "the planner returns two allocations on the same lot");
  assert.deepEqual(mergeLines(subs).map(a => [a.lotId, a.amount]), [["lot-d", 40]]);
  // A different lot or kind is a different line.
  const mixed = [...planOf(w.ledger).allocations.filter(a => a.orderId === "order-b")];
  assert.deepEqual(mergeLines(mixed).map(a => [a.lotId, a.kind, a.amount]), [["lot-b", "requested", 10], ["lot-d", "approved-substitution", 40]]);
});

test("the demo cannot cover Riverbend after the late drop: every lb of zucchini is used and tomatoes are all promised", () => {
  const w = walk();
  const plan = planOf(w.ledger);
  const zuke = w.ledger.snapshot.lots.find(l => l.id === "lot-d")!;
  assert.equal(plan.allocations.filter(a => a.lotId === "lot-d").reduce((n, a) => n + a.amount, 0), 40, "all 4 cases x 10 lb are Riverbend's");
  assert.ok(zuke);
  assert.equal(plan.unfilled.find(u => u.orderId === "order-b")?.amount, 30, "30 lb short is the true state of the demo supply; Cedar Row holds no lot");
});

test("the list label follows who the order is waiting on", () => {
  assert.equal(ORDER_STATUS.resolving.label, "Asked, waiting for the grower");
  assert.equal(resolvingLabel(["ask-grower"]), "Asked, waiting for the grower");
  assert.equal(resolvingLabel(["offer-substitute"]), "Offered, waiting for the buyer");
  assert.equal(resolvingLabel(["ask-grower", "offer-substitute"]), "Waiting for an answer");
  assert.equal(resolvingLabel([]), "Asked, waiting for the grower");
  const w = walk();
  assert.equal(orderStatus(w, "order-b"), "resolving", "res-1 is still an open ask in this walk");
});

test("once the buyer is told, the Next step offers nothing to send", () => {
  assert.match(page, /pick = told && rec\?\.kind !== "review-reply" \? undefined : rec/, "no recommended offer while the buyer has been told");
  assert.match(page, /alts = picked \?/, "the Or buttons only follow a pick");
  assert.match(page, /resolvingLabel\(/, "the list label is chosen from what is open");
});
