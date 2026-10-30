import test from "node:test";
import assert from "node:assert/strict";
import { CONTACTS } from "../src/demo.ts";
import { PROMPT_VERSION } from "../src/interpret.ts";
import { checkDraft } from "../src/messages.ts";
import { measures } from "../src/measures.ts";
import { changedSinceConfirm, conflicts, confirmPlan, decideCut } from "../src/commitments.ts";
import { propose } from "../evaluation/scenario.ts";
import { options } from "../src/orders.ts";
import { orderSheets } from "../src/pack.ts";
import { recommend } from "../src/orders.ts";
import { orderStatus, recordBuyerReply, sendMessage, unresolved } from "../src/resolve.ts";
import { BUYER_REPLIES, DEMO_MODEL, LATE, scriptedRequestReply, type Extras } from "../src/seed.ts";
import { approve, preview } from "../src/workbench.ts";
import { ME, T, askB, known, morning, pick, resolved, short, start, take, zucchini } from "./story.ts";

// A hand-written reading of the grower's reply, shaped like the replay recordings in seed.test.ts.
const reading = JSON.stringify({ operation: "add-quantity", lotId: "lot-b", quantity: { amount: 30, unit: "lb", pack: null }, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: null,
  evidence: [{ field: "quantity", quote: "another 30 lb of standard tomatoes" }, { field: "operation", quote: "another" }, { field: "grade", quote: "standard" }, { field: "date", quote: "Friday" }, { field: "lot", quote: "tomatoes" }], unresolved: [], questions: [] });
const extras: Extras = { model: DEMO_MODEL, promptVersion: PROMPT_VERSION, recordedAt: "2026-10-28T15:00:00Z", drafts: {}, readings: { "msg-tomato-more": reading } };

test("the demo path: ask, grower reply, zucchini offer, call note, confirm, sheets", async () => {
  let w = morning();
  assert.equal(short(w), 60);
  assert.deepEqual(unresolved(w), ["order-b"]);

  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = await scriptedRequestReply(w, "res-1", extras, T(20));
  const item = w.items.at(-1)!;
  assert.ok(item.proposal, "the reply arrives read");
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(22));
  assert.equal(short(w), 30);

  w = start(w, pick(w, zucchini), 30);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(31));
  w = recordBuyerReply(w, "res-2", { ...BUYER_REPLIES["buyer-b"], accept: true }, ME, T(40));

  assert.deepEqual(unresolved(w), []);
  assert.equal(short(w), 0);
  assert.equal(orderStatus(w, "order-b"), "substitute-agreed");

  assert.equal(w.outbox.length, 2);
  for (const m of w.outbox) {
    const facts = w.resolutions.find(r => r.id === m.resolutionId)!.facts;
    const check = checkDraft(m.text, facts, known(w));
    assert.deepEqual(check, { ok: true, problems: [], confirm: [] }, m.text);
  }

  w = confirmPlan(w, ME, T(50), { shipShort: false });
  assert.deepEqual(w.ledger.commitments!.shippedShort, []);
  const sheet = orderSheets(w.ledger).find(s => s.orderId === "order-b")!;
  assert.equal(sheet.short, 0);

  const tomato = w.items.find(i => i.source.id === "msg-tomato")!;
  assert.deepEqual(measures(w), {
    shortsDetected: 1,
    resolvedBy: { grower: 1, substitute: 1, notice: 0, shipShort: 0 },
    minutesToBuyerNotice: [{ orderId: "order-b", minutes: (Date.parse(w.outbox[1].sentAt) - Date.parse(tomato.receivedAt)) / 60000 }]
  });
});

test("Task 23: Orders recommends reading the reply, then the zucchini offer once Birch Hollow has answered", async () => {
  let w = morning();
  assert.deepEqual(recommend(w, "order-b", CONTACTS), pick(w, askB), "first, ask the grower who holds the tomatoes");
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = await scriptedRequestReply(w, "res-1", extras, T(20));
  const item = w.items.at(-1)!, before = structuredClone(w);
  assert.deepEqual(recommend(w, "order-b", CONTACTS), { kind: "review-reply", contactId: "grower-b", itemId: item.id }, "a reply waiting in Review is read before anyone is asked again");
  assert.deepEqual(w, before, "recommend reads and never writes");
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(22));
  assert.equal(short(w), 30, "the reply of 30 left 30 lb short");
  const next = recommend(w, "order-b", CONTACTS);
  assert.deepEqual(next, pick(w, zucchini), "Birch Hollow answered, so the next step is the zucchini offer");
  assert.deepEqual(recommend(w, "order-b", CONTACTS), next, "deterministic");
});

test("Final review: once the buyer has declined the zucchini offer, Orders does not recommend it again", async () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = await scriptedRequestReply(w, "res-1", extras, T(20));
  const item = w.items.at(-1)!;
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(22));
  assert.deepEqual(recommend(w, "order-b", CONTACTS), pick(w, zucchini));
  w = start(w, pick(w, zucchini), 30);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(31));
  w = recordBuyerReply(w, "res-2", { ...BUYER_REPLIES["buyer-b"], accept: false }, ME, T(40));
  const next = recommend(w, "order-b", CONTACTS);
  assert.ok(next && !(next.kind === "offer-substitute" && next.product === "zucchini"), "the declined offer is not recommended again");
});

test("after confirming, Birch Hollow's late drop is one conflict, settled by the suggested cut", () => {
  let w = confirmPlan(resolved(), ME, T(50), { shipShort: false });
  const northside = () => orderSheets(w.ledger).find(s => s.orderId === "order-a")!.lines.filter(x => x.product === "tomatoes").map(x => [x.lotId, x.amount]);
  const before = northside();
  assert.deepEqual(conflicts(w.ledger), []);
  w = take(w, { ...LATE.source }, w => propose(w.ledger, "p-late", LATE.source,
    { operation: "replace-total", lotId: "lot-b", quantity: { amount: 70, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["only have 70 lb of standard", "Friday", "not 110"] }), 55);
  const found = conflicts(w.ledger);
  assert.equal(found.length, 1);
  assert.equal(found[0].lotId, "lot-b");
  assert.equal(found[0].excess, 40);
  assert.deepEqual(found[0].suggestion, [{ orderId: "order-b", amount: 40 }]);
  assert.deepEqual(northside(), before, "Northside's tomatoes are unchanged");
  w = decideCut(w, "lot-b", found[0].suggestion!, found[0].excess, ME, T(56));
  assert.deepEqual(conflicts(w.ledger), []);
  assert.equal(short(w), 40, "order-b is short 40 again");
  assert.ok(options(w.ledger, "order-b", CONTACTS).some(askB), "asks for the shortfall are offered");
  assert.deepEqual(changedSinceConfirm(w.ledger).filter(c => c.orderId === "order-b" && c.lotId === "lot-b"), [{ orderId: "order-b", lotId: "lot-b", was: 50, now: 10, unit: "lb" }]);
});
