import test from "node:test";
import assert from "node:assert/strict";
import { CONTACTS } from "../src/demo.ts";
import { measures } from "../src/measures.ts";
import { approve, interpret, preview } from "../src/workbench.ts";
import { receiveRequestedReply, recordBuyerReply, sendMessage } from "../src/resolve.ts";
import { propose } from "../evaluation/scenario.ts";
import { ME, MORE, T, askB, more, morning, notice, pick, start, zucchini } from "./story.ts";

function story() {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = receiveRequestedReply(w, "res-1", MORE, T(20));
  const item = w.items.at(-1)!;
  w = interpret(w, item.id, more(w), "test reading", ME, T(21));
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(22));
  w = start(w, pick(w, zucchini), 30);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(31));
  return recordBuyerReply(w, "res-2", { channel: "call", text: "Called kitchen manager, zucchini is fine for the rest.", accept: true }, ME, T(40));
}

test("before anything is short or resolved, nothing is claimed", () => {
  const w = morning();
  assert.equal(w.resolutions.length, 0);
  assert.deepEqual(measures(w), { shortsDetected: 1, resolvedBy: { grower: 0, substitute: 0, notice: 0, shipShort: 0 }, minutesToBuyerNotice: [] });
});

test("Task 7 story: one short, caught by a grower and a substitute, buyer told 28 minutes after the cut", () => {
  const w = story();
  const m = measures(w);
  assert.equal(m.shortsDetected, 1);
  assert.equal(m.resolvedBy.grower, 1);
  assert.equal(m.resolvedBy.substitute, 1);
  assert.equal(m.resolvedBy.notice, 0);
  assert.equal(m.resolvedBy.shipShort, 0);
  assert.equal(m.minutesToBuyerNotice.length, 1);
  assert.equal(m.minutesToBuyerNotice[0].orderId, "order-b");
  const tomato = w.items.find(i => i.source.id === "msg-tomato")!;
  assert.equal(m.minutesToBuyerNotice[0].minutes, (Date.parse(w.outbox[1].sentAt) - Date.parse(tomato.receivedAt)) / 60000);
  assert.equal(w.resolutions[0].causeItemId, tomato.id);
  assert.equal(w.resolutions[1].causeItemId, tomato.id);
});

test("a message to a grower is not a buyer notice", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.deepEqual(measures(w).minutesToBuyerNotice, []);
});

test("a notice counts, and the minutes are not rounded", () => {
  let w = morning();
  w = start(w, pick(w, notice), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, "2026-10-28T14:10:30.000Z");
  const m = measures(w);
  assert.equal(m.resolvedBy.notice, 1);
  assert.equal(m.minutesToBuyerNotice[0].minutes, 7.5);
});

test("ship-short counts the commitments' shipped-short orders, and an order only there is still a short", () => {
  const w = morning();
  const commitments = { promised: [], confirmed: { by: "x", at: "x", promised: [] }, log: [], shippedShort: [{ orderId: "order-b", amount: 60, unit: "lb", buyerTold: false }] } as never;
  const withShort = (x: typeof w) => ({ ...x, ledger: { ...x.ledger, commitments } });
  assert.equal(measures(withShort(w)).resolvedBy.shipShort, 1);
  // Commitments-only: make the order covered by raising its supply, then only the commitments name it.
  const covered = { ...w, ledger: { ...w.ledger, snapshot: { ...w.ledger.snapshot, lots: w.ledger.snapshot.lots.map(l => l.id === "lot-b" ? { ...l, quantity: { amount: 500, unit: "lb" as const } } : l) } } };
  assert.equal(measures(covered).shortsDetected, 0);
  assert.equal(measures(withShort(covered)).shortsDetected, 1);
});

// An ask to grower-b, answered by a reply read as `op`, approved.
function answered(op: "replace-total" | "forecast", amount: number) {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = receiveRequestedReply(w, "res-1", MORE, T(20));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, propose(w.ledger, "p-reply", MORE, { operation: op, lotId: "lot-b", quantity: { amount, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["another 30 lb of standard tomatoes", "Friday"] }), "test reading", ME, T(21));
  return approve(w, id, ME, preview(w, id).reviewHash!, T(22));
}

test("a linked reply that lowers supply is not a grower resolution", () => {
  const w = answered("replace-total", 10);
  assert.equal(w.items.at(-1)!.state, "approved");
  assert.equal(measures(w).resolvedBy.grower, 0);
});

test("a linked reply that is only a forecast is not a grower resolution", () => {
  const w = answered("forecast", 30);
  assert.equal(w.items.at(-1)!.state, "approved");
  assert.equal(measures(w).resolvedBy.grower, 0);
});
