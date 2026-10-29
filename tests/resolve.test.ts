import test from "node:test";
import assert from "node:assert/strict";
import { answer, propose } from "../evaluation/scenario.ts";
import { BUYERS, CONTACTS, demoSnapshot } from "../src/demo.ts";
import { templateDraft } from "../src/draft.ts";
import { options, permissionSource, shortages, type Option } from "../src/orders.ts";
import { SEED } from "../src/seed.ts";
import { createLedger, type Source } from "../src/updates.ts";
import { hubDay } from "../src/hub.ts";
import { proposeAllocations, verifyPlan } from "../src/planner.ts";
import { approve, createWorkbench, interpret, preview, receive, type Workbench } from "../src/workbench.ts";
import { canSend, confirmDraft, discardDraft, editDraft, factsFor, isOpen, logCall, openFor, orderStatus, quoteFor, receiveRequestedCall, receiveRequestedReply, recordBuyerReply, recordSupplyReply, redraft, sendMessage, startResolution, toConfirm, unresolved } from "../src/resolve.ts";

// Order resolution on the demo hub: after the morning's three updates, order-b is 60 lb short.
const T = (m: number) => new Date(Date.UTC(2026, 9, 28, 14, m)).toISOString();
const ME = "Hub coordinator";
const names: Record<string, string> = { ...Object.fromEntries(CONTACTS.map(c => [c.id, c.name])), ...BUYERS };
const seed = (id: string) => SEED.find(m => m.source.id === id)!;
const known = (w: Workbench) => [...new Set([...w.ledger.snapshot.lots, ...w.ledger.snapshot.orders].map(x => x.product))];
const short = (w: Workbench, orderId = "order-b") => shortages(w.ledger).find(s => s.orderId === orderId)?.short ?? 0;

function take(w: Workbench, source: Source, reading: (w: Workbench) => ReturnType<typeof propose>, m: number): Workbench {
  w = receive(w, source, T(m));
  const id = w.items.at(-1)!.id;
  w = interpret(w, id, reading(w), "test reading", ME, T(m));
  return approve(w, id, ME, preview(w, id).reviewHash!, T(m));
}
function morning(): Workbench {
  let w = createWorkbench(createLedger(demoSnapshot()));
  const cuke = seed("msg-cucumber"), zuke = seed("msg-zucchini"), tom = seed("msg-tomato");
  w = take(w, cuke.source, w => propose(w.ledger, "p-cuke", cuke.source,
    { operation: "add-quantity", lotId: "lot-c", quantity: { amount: 4, unit: "case", pack: { amount: 6, unit: "lb" } }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another four cases", "standard cucumbers", "Friday"] },
    [answer("pack", "How much is in each case?", cuke.reply!, "6 lb in each")]), 1);
  w = take(w, zuke.source, w => propose(w.ledger, "p-zuke", zuke.source,
    { operation: "replace-total", lotId: "lot-d", quantity: { amount: 4, unit: "case", pack: { amount: 10, unit: "lb" } }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["four cases of standard zucchini", "Friday"] },
    [answer("pack", "How much is in each case?", zuke.reply!, "10 lb in each case"), answer("operation", "Is this the new total?", zuke.reply!, "That's the whole lot")]), 2);
  w = take(w, tom.source, w => propose(w.ledger, "p-tom", tom.source,
    { operation: "replace-total", lotId: "lot-a", quantity: { amount: 60, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 60 lb of standard tomatoes", "Friday", "replacing the earlier 120 lb total"] }), 3);
  return w;
}
function pick(w: Workbench, f: (o: Option) => boolean, orderId = "order-b"): Option {
  const o = options(w.ledger, orderId, CONTACTS).find(f);
  assert.ok(o, "option offered");
  return o;
}
function start(w: Workbench, o: Option, m: number, orderId = "order-b"): Workbench {
  const facts = factsFor(w, orderId, o, names);
  return startResolution(w, orderId, o, CONTACTS, facts, templateDraft(facts, known(w)), ME, T(m));
}
const askB = (o: Option) => o.kind === "ask-grower" && o.contactId === "grower-b";
const zucchini = (o: Option) => o.kind === "offer-substitute" && o.product === "zucchini";
const notice = (o: Option) => o.kind === "notify-short";
const MORE: Source = { id: "msg-tomato-more", revision: 1, growerId: "grower-b", text: "We can bring another 30 lb of standard tomatoes Friday." };
const more = (w: Workbench) => propose(w.ledger, "p-more", MORE, { operation: "add-quantity", lotId: "lot-b", quantity: { amount: 30, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["another 30 lb of standard tomatoes", "Friday"] });

test("the demo morning leaves order-b 60 lb short", () => {
  const w = morning();
  assert.equal(short(w), 60);
  assert.equal(orderStatus(w, "order-b"), "short");
  assert.deepEqual(unresolved(w), ["order-b"]);
});

test("an order waits on a reply only after a message is sent; a draft alone leaves it short", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  assert.equal(w.resolutions[0].status, "drafted");
  assert.equal(orderStatus(w, "order-b"), "short");
  assert.deepEqual(unresolved(w), ["order-b"]);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.equal(orderStatus(w, "order-b"), "resolving");
});

test("ask, linked reply, substitute by call: order-b ends substitute-agreed", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  assert.deepEqual([w.resolutions[0].id, w.resolutions[0].status, w.resolutions[0].facts.amount, w.resolutions[0].facts.to.name], ["res-1", "drafted", 60, "Birch Hollow Gardens"]);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.equal(w.outbox.length, 1);
  assert.deepEqual([w.outbox[0].id, w.outbox[0].resolutionId, w.outbox[0].sentBy], ["out-1", "res-1", ME]);
  assert.equal(orderStatus(w, "order-b"), "resolving");
  assert.deepEqual(unresolved(w), ["order-b"]);

  w = receiveRequestedReply(w, "res-1", MORE, T(20));
  const item = w.items.at(-1)!;
  assert.equal(item.requestId, "res-1");
  assert.equal(w.resolutions[0].linkedItemId, item.id);
  assert.throws(() => receiveRequestedReply(w, "res-1", { ...MORE, revision: 2 }, T(21)), /already/);
  assert.equal(orderStatus(w, "order-b"), "resolving");
  w = interpret(w, item.id, more(w), "test reading", ME, T(21));
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(22));
  assert.equal(short(w), 30);
  assert.equal(orderStatus(w, "order-b"), "short", "the ask is closed once its reply is approved");

  const offer = pick(w, zucchini);
  assert.equal(offer.kind === "offer-substitute" && offer.covers, 30);
  w = start(w, offer, 30);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(31));
  w = recordBuyerReply(w, "res-2", { channel: "call", text: "Called kitchen manager, zucchini is fine for the rest.", accept: true }, ME, T(40));
  const r = w.resolutions[1];
  assert.deepEqual([r.status, r.reply], ["accepted", { id: "in-1", channel: "call", text: "Called kitchen manager, zucchini is fine for the rest.", quote: "Called kitchen manager, zucchini is fine for the rest." }]);
  assert.equal(orderStatus(w, "order-b"), "substitute-agreed");
  assert.deepEqual(unresolved(w), []);
  const p = permissionSource(w.ledger, "order-b", "zucchini");
  assert.equal(p.kind, "agreed");
  assert.equal(p.kind === "agreed" && p.record.evidence.channel, "call");
  assert.equal(p.kind === "agreed" && p.record.evidence.messageId, "in-1");
});

test("a no-lot ask: a recorded yes becomes a new lot and the shortfall falls", () => {
  let w = morning();
  w = start(w, pick(w, o => o.kind === "ask-grower" && o.contactId === "outside-1"), 10);
  assert.equal(w.resolutions[0].facts.to.name, "Valley Produce Wholesale");
  assert.throws(() => recordSupplyReply(w, "res-1", { channel: "text", text: "Yes, 20 lb Friday", quote: "20 lb", yes: true, amount: 20, grade: "standard" }, ME, T(12)), /not been sent/);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.throws(() => receiveRequestedReply(w, "res-1", MORE, T(12)), /grower who holds a lot/);
  assert.throws(() => recordSupplyReply(w, "res-1", { channel: "text", text: "Yes, 20 lb Friday", quote: "30 lb", yes: true, amount: 20, grade: "standard" }, ME, T(12)), /quote/);
  w = recordSupplyReply(w, "res-1", { channel: "text", text: "Yes, 20 lb Friday", quote: "20 lb", yes: true, amount: 20, grade: "standard" }, ME, T(12));
  const lot = w.ledger.snapshot.lots.find(l => l.id === "lot-outside-1-1");
  assert.deepEqual(lot, { id: "lot-outside-1-1", growerId: "outside-1", product: "tomato", grade: "standard", quantity: { amount: 20, unit: "lb" }, deliveryOn: "2026-10-30", confirmed: true });
  assert.equal(short(w), 40);
  assert.equal(w.resolutions[0].status, "accepted");
  assert.equal(w.ledger.records.at(-1)!.kind, "lot-added");
  assert.throws(() => recordSupplyReply(w, "res-1", { channel: "text", text: "Yes, 20 lb Friday", quote: "20 lb", yes: true, amount: 20, grade: "standard" }, ME, T(13)), /already/);

  w = start(w, pick(w, o => o.kind === "ask-grower" && o.contactId === "grower-c"), 14);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(15));
  w = recordSupplyReply(w, "res-2", { channel: "call", text: "Cedar Row has none this week.", yes: false }, ME, T(16));
  assert.equal(w.resolutions[1].status, "declined");
  assert.equal(short(w), 40);
});

test("Review Focus 1: a notice smaller than a later shortfall leaves the order short", () => {
  let w = morning();
  w = receive(w, MORE, T(5));
  w = interpret(w, "item-4", more(w), "test reading", ME, T(5));
  w = approve(w, "item-4", ME, preview(w, "item-4").reviewHash!, T(5));
  assert.equal(short(w), 30);
  w = start(w, pick(w, notice), 10);
  assert.equal(orderStatus(w, "order-b"), "short", "a drafted notice has told no one");
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.equal(orderStatus(w, "order-b"), "buyer-told");
  assert.deepEqual(unresolved(w), []);
  const cut: Source = { id: "msg-tomato-cut", revision: 1, growerId: "grower-b", text: "Only 90 lb of standard tomatoes for Friday after all." };
  w = take(w, cut, w => propose(w.ledger, "p-cut", cut, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 90, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 90 lb of standard tomatoes", "Friday"] }), 20);
  assert.equal(short(w), 50);
  assert.equal(orderStatus(w, "order-b"), "short");
  assert.deepEqual(unresolved(w), ["order-b"]);
});

test("Review Focus 2: replies need a sent offer and are recorded once", () => {
  let w = morning();
  w = start(w, pick(w, zucchini), 10);
  const reply = { channel: "text" as const, text: "Yes, zucchini works for us.", quote: "zucchini works", accept: true };
  let before = structuredClone(w);
  assert.throws(() => recordBuyerReply(w, "res-1", reply, ME, T(12)), /not been sent/);
  assert.deepEqual(w, before);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, T(11)), /already/);
  assert.throws(() => recordBuyerReply(w, "res-1", { ...reply, quote: undefined }, ME, T(12)), /quote/);
  assert.throws(() => recordBuyerReply(w, "res-1", { ...reply, quote: "zucchini is fine" }, ME, T(12)), /quote/);
  w = recordBuyerReply(w, "res-1", { ...reply, accept: false }, ME, T(12));
  assert.equal(w.resolutions[0].status, "declined");
  before = structuredClone(w);
  assert.throws(() => recordBuyerReply(w, "res-1", reply, ME, T(13)), /already/);
  assert.throws(() => redraft(w, "res-1", templateDraft(w.resolutions[0].facts, known(w)), ME, T(13)), /already/);
  assert.deepEqual(w, before);
  w = start(w, pick(w, askB), 20);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(21));
  assert.throws(() => recordBuyerReply(w, "res-2", reply, ME, T(22)), /offer/);
});

test("Review Focus 5: edits are bounded, call notes required, checker problems kept but sendable", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  assert.throws(() => editDraft(w, "res-1", "", ME, T(11)), /empty/);
  assert.throws(() => editDraft(w, "res-1", "x".repeat(481), ME, T(11)), /480/);
  w = editDraft(w, "res-1", "Hi Birch Hollow Gardens, could you bring another 40 lb of tomato for Friday?", ME, T(11));
  const r = w.resolutions[0];
  assert.equal(r.check.ok, false);
  assert.equal(r.draftedBy, ME);
  w = redraft(w, "res-1", templateDraft(r.facts, known(w)), ME, T(12));
  assert.equal(w.resolutions[0].check.ok, true);
  w = editDraft(w, "res-1", "Hi Birch Hollow Gardens, could you bring another 40 lb of tomato for Friday?", ME, T(13));
  w = sendMessage(w, "res-1", CONTACTS, ME, T(14));
  assert.equal(w.outbox[0].text, "Hi Birch Hollow Gardens, could you bring another 40 lb of tomato for Friday?");
  assert.throws(() => editDraft(w, "res-1", "Hello", ME, T(15)), /already/);
  assert.deepEqual(w.resolutions[0].decisions.map(d => d.kind), ["drafted", "edited", "redrafted", "edited", "sent"]);

  w = start(w, pick(w, zucchini), 20);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(21));
  assert.throws(() => recordBuyerReply(w, "res-2", { channel: "call", text: "", accept: true }, ME, T(22)), /note/);
  assert.throws(() => recordBuyerReply(w, "res-2", { channel: "call", text: "x".repeat(501), accept: true }, ME, T(22)), /note/);
});

test("starting a resolution needs a short order and a currently offered option with matching facts", () => {
  const w = morning(), o = pick(w, askB), facts = factsFor(w, "order-b", o, names), draft = templateDraft(facts, known(w));
  assert.throws(() => startResolution(w, "order-a", o, CONTACTS, factsFor(w, "order-a", o, names), draft, ME, T(10)), /not short/);
  assert.throws(() => startResolution(w, "order-b", { ...o, contactId: "grower-c" } as Option, CONTACTS, facts, draft, ME, T(10)), /no longer offered/);
  assert.throws(() => startResolution(w, "order-b", o, CONTACTS, { ...facts, amount: 50 }, draft, ME, T(10)), /amount/);
  assert.throws(() => startResolution(w, "order-b", pick(w, zucchini), CONTACTS, facts, draft, ME, T(10)), /facts/);
  assert.throws(() => factsFor(w, "order-b", o, {}), /name/);
  assert.deepEqual(factsFor(w, "order-b", pick(w, zucchini), names),
    { kind: "offer", to: { kind: "buyer", id: "buyer-b", name: "Riverbend School Kitchen" }, product: "tomato", substitute: "zucchini", amount: 40, unit: "lb", deliveryOn: "2026-10-30" });
  assert.deepEqual(factsFor(w, "order-b", pick(w, notice), names),
    { kind: "notice", to: { kind: "buyer", id: "buyer-b", name: "Riverbend School Kitchen" }, product: "tomato", amount: 60, unit: "lb", deliveryOn: "2026-10-30" });
});

test("staleness: an accepted substitute moves the ledger, so an open reading is stale", () => {
  let w = morning();
  const late: Source = { id: "msg-late", revision: 1, growerId: "grower-a", text: "Another 10 lb of standard tomatoes for Friday." };
  w = receive(w, late, T(5));
  w = interpret(w, "item-4", propose(w.ledger, "p-late", late, { operation: "add-quantity", lotId: "lot-a", quantity: { amount: 10, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Another 10 lb of standard tomatoes", "Friday"] }), "test reading", ME, T(5));
  assert.equal(preview(w, "item-4").stale, false);
  w = start(w, pick(w, zucchini), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = recordBuyerReply(w, "res-1", { channel: "text", text: "Yes, zucchini works for us.", quote: "zucchini works", accept: true }, ME, T(12));
  assert.equal(preview(w, "item-4").stale, true);
});

test("logCall puts the coordinator's note in the inbox as call-n", () => {
  let w = morning();
  const before = w.items.length;
  w = logCall(w, "grower-a", "Alder Creek called: 20 lb more tomatoes Friday", ME, T(10));
  const i = w.items.at(-1)!;
  assert.equal(w.items.length, before + 1);
  assert.deepEqual(i.source, { id: "call-1", revision: 1, growerId: "grower-a", text: "Alder Creek called: 20 lb more tomatoes Friday" });
  assert.equal(w.calls, 1);
  assert.equal(i.decisions[0].note, `Call note by ${ME}`);
  w = logCall(w, "grower-b", "Birch Hollow called back", ME, T(11));
  assert.equal(w.items.at(-1)!.source.id, "call-2");
  assert.throws(() => logCall(w, "grower-a", "", ME, T(12)), /note/);
  assert.throws(() => logCall(w, "grower-a", "x".repeat(501), ME, T(12)), /note/);
});

test("fix 1: a no-lot ask must name a known contact", () => {
  const w = morning(), o = { kind: "ask-grower", contactId: "grower-x", hasLot: false, contactKind: "member", amount: 60, unit: "lb" } as Option;
  const facts = factsFor(w, "order-b", o, { "grower-x": "Unknown Farm" });
  assert.throws(() => startResolution(w, "order-b", o, CONTACTS, facts, templateDraft(facts, known(w)), ME, T(10)), /no longer offered|Unknown contact/);
});

test("fix 2: sending re-matches the live option and refuses if it changed", () => {
  let w = morning();
  w = start(w, pick(w, zucchini), 10);
  w = start(w, pick(w, notice), 11);
  w = take(w, MORE, more, 12);
  assert.equal(short(w), 30);
  const before = structuredClone(w);
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, T(13)), /changed/, "covers fell from 40 to 30");
  assert.deepEqual(w, before);
  assert.throws(() => sendMessage(w, "res-2", CONTACTS, ME, T(13)), /changed/, "a 60 lb notice would overstate a 30 lb shortfall");
  assert.deepEqual(w, before);
  w = start(w, pick(w, notice), 14);
  const cut: Source = { id: "msg-tomato-cut", revision: 1, growerId: "grower-b", text: "Only 90 lb of standard tomatoes for Friday after all." };
  w = take(w, cut, w => propose(w.ledger, "p-cut", cut, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 90, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 90 lb of standard tomatoes", "Friday"] }), 15);
  assert.throws(() => sendMessage(w, "res-3", CONTACTS, ME, T(16)), /changed/, "a 30 lb notice no longer covers a 50 lb shortfall");
});

test("fix 3: one open offer per product per order", () => {
  let w = morning();
  w = start(w, pick(w, zucchini), 10);
  assert.throws(() => start(w, pick(w, zucchini), 11), /already/);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(12));
  assert.throws(() => start(w, pick(w, zucchini), 13), /already/);
  w = recordBuyerReply(w, "res-1", { channel: "text", text: "No thanks, not zucchini.", quote: "No thanks", accept: false }, ME, T(14));
  w = start(w, pick(w, zucchini), 15);
  assert.equal(w.resolutions.length, 2);
});

test("fix 4: a supply yes needs an accepted grade; a fallback is bounded", () => {
  let w = morning();
  w = start(w, pick(w, o => o.kind === "ask-grower" && o.contactId === "outside-1"), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.throws(() => recordSupplyReply(w, "res-1", { channel: "text", text: "Yes, 20 lb seconds", quote: "20 lb", yes: true, amount: 20, grade: "seconds" }, ME, T(12)), /grade/);
  const o = pick(w, askB), facts = factsFor(w, "order-b", o, names);
  assert.throws(() => startResolution(w, "order-b", o, CONTACTS, facts, { ...templateDraft(facts, known(w)), fallback: "x".repeat(501) }, ME, T(13)), /Fallback/);
});

// Fix round 1, item 1: a call answering an ask is linked to it, like a requested text reply.
const askA = (o: Option) => o.kind === "ask-grower" && o.contactId === "grower-a";
const NOTE = "Alder Creek can add 20 lb of standard tomatoes Friday.";
test("a logged call answering a sent ask is linked to it, and a second reply is refused", () => {
  let w = morning();
  w = start(w, pick(w, askA), 10);
  const drafted = structuredClone(w);
  assert.throws(() => receiveRequestedCall(w, "res-1", NOTE, ME, T(11)), /not been sent/);
  assert.deepEqual(w, drafted);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  const sent = structuredClone(w);
  assert.throws(() => receiveRequestedCall(w, "res-1", "", ME, T(12)), /480/);
  assert.throws(() => receiveRequestedCall(w, "res-1", "x".repeat(481), ME, T(12)), /480/);
  assert.throws(() => receiveRequestedCall(w, "res-9", NOTE, ME, T(12)), /Unknown resolution/);
  assert.deepEqual(w, sent, "refusals leave the state unchanged");
  w = receiveRequestedCall(w, "res-1", NOTE, ME, T(12));
  const item = w.items.at(-1)!, r = w.resolutions[0];
  assert.deepEqual([item.source.id, item.source.growerId, item.source.text, item.requestId], ["call-1", "grower-a", NOTE, "res-1"]);
  assert.equal(item.decisions[0].note, `Call note by ${ME}`);
  assert.equal(w.calls, 1);
  assert.equal(r.linkedItemId, item.id);
  assert.equal(r.decisions.at(-1)!.kind, "grower-replied");
  assert.equal(orderStatus(w, "order-b"), "resolving");
  assert.throws(() => receiveRequestedCall(w, "res-1", NOTE, ME, T(13)), /already/);
  assert.throws(() => receiveRequestedReply(w, "res-1", { id: "msg-a-more", revision: 1, growerId: "grower-a", text: NOTE }, T(13)), /already/);
});

test("approving a linked call from a grower other than grower-b closes the ask; the order is short again", () => {
  let w = morning();
  w = start(w, pick(w, askA), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = receiveRequestedCall(w, "res-1", NOTE, ME, T(12));
  const item = w.items.at(-1)!;
  w = interpret(w, item.id, propose(w.ledger, "p-call", item.source, { operation: "add-quantity", lotId: "lot-a", quantity: { amount: 20, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["add 20 lb of standard tomatoes", "Friday"] }), "test reading", ME, T(13));
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(14));
  assert.equal(short(w), 40);
  assert.equal(orderStatus(w, "order-b"), "short");
});

test("a call reply needs a sent ask to a grower who holds a lot", () => {
  let w = morning();
  w = start(w, pick(w, o => o.kind === "ask-grower" && o.contactId === "outside-1"), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.throws(() => receiveRequestedCall(w, "res-1", NOTE, ME, T(12)), /holds a lot/);
  w = start(w, pick(w, notice), 13);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(14));
  assert.throws(() => receiveRequestedCall(w, "res-2", NOTE, ME, T(15)), /holds a lot/);
});

// Fix round 1, item 4: who wrote the draft is structured, never read from a name.
test("the draft's author is recorded as data, so a coordinator named Template still reads as a coordinator", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  assert.equal(w.resolutions[0].author, "template");
  const facts = w.resolutions[0].facts, model = { ...templateDraft(facts, known(w)), by: "Muse Spark", author: "model" as const };
  w = redraft(w, "res-1", { ...model, recorded: true }, ME, T(11));
  assert.equal(w.resolutions[0].author, "model-recorded");
  w = redraft(w, "res-1", model, ME, T(12));
  assert.equal(w.resolutions[0].author, "model-live");
  w = editDraft(w, "res-1", w.resolutions[0].text, "Template", T(13));
  assert.equal(w.resolutions[0].author, "coordinator");
  w = redraft(w, "res-1", { ...templateDraft(facts, known(w)), recorded: true }, ME, T(14));
  assert.equal(w.resolutions[0].author, "template", "a template fallback is a template even on the recorded path");
});

// Final fix I1: the Orders page asks the domain which message is still open for an option.
test("after a sent 30 lb notice and a cut to 50 lb short, a 50 lb notice can be started and sent", () => {
  let w = morning();
  w = take(w, MORE, w => more(w), 5);
  assert.equal(short(w), 30);
  w = start(w, pick(w, notice), 10);
  assert.equal(openFor(w, "order-b", pick(w, notice))?.id, "res-1", "a drafted notice is open");
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.equal(isOpen(w, w.resolutions[0]), false, "a sent notice is closed");
  const cut: Source = { id: "msg-tomato-cut", revision: 1, growerId: "grower-b", text: "Only 90 lb of standard tomatoes for Friday after all." };
  w = take(w, cut, w => propose(w.ledger, "p-cut", cut, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 90, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 90 lb of standard tomatoes", "Friday"] }), 20);
  assert.equal(short(w), 50);
  const fifty = pick(w, notice);
  assert.equal(fifty.kind === "notify-short" && fifty.amount, 50);
  assert.equal(openFor(w, "order-b", fifty), undefined, "the sent 30 lb notice does not block a new one");
  w = start(w, fifty, 21);
  assert.equal(w.resolutions[1].facts.amount, 50);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(22));
  assert.equal(orderStatus(w, "order-b"), "buyer-told");
});

test("after a has-lot ask's linked reply is approved and the order is still short, the same grower can be asked again", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  assert.equal(openFor(w, "order-b", pick(w, askB))?.id, "res-1", "a sent ask awaiting its reply is open");
  w = receiveRequestedReply(w, "res-1", MORE, T(20));
  const item = w.items.at(-1)!;
  assert.equal(openFor(w, "order-b", pick(w, askB))?.id, "res-1", "a reply still in review keeps the ask open");
  w = interpret(w, item.id, more(w), "test reading", ME, T(21));
  w = approve(w, item.id, ME, preview(w, item.id).reviewHash!, T(22));
  assert.equal(short(w), 30);
  assert.equal(isOpen(w, w.resolutions[0]), false, "an ask whose linked reply was approved is closed");
  const again = pick(w, askB);
  assert.equal(openFor(w, "order-b", again), undefined);
  w = start(w, again, 30);
  assert.deepEqual([w.resolutions[1].facts.to.id, w.resolutions[1].facts.amount], ["grower-b", 30]);
});

test("the open rule keeps a second open offer of the same product refused", () => {
  let w = morning();
  w = start(w, pick(w, zucchini), 10);
  assert.equal(openFor(w, "order-b", pick(w, zucchini))?.id, "res-1");
  assert.throws(() => start(w, pick(w, zucchini), 11), /already open/);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(12));
  assert.equal(isOpen(w, w.resolutions[0]), true, "a sent offer awaits the buyer");
  assert.throws(() => start(w, pick(w, zucchini), 13), /already open/);
  w = recordBuyerReply(w, "res-1", { channel: "text", text: "No thanks, not zucchini.", quote: "No thanks", accept: false }, ME, T(14));
  assert.equal(openFor(w, "order-b", pick(w, zucchini)), undefined);
});

// Final fix M6: a supply yes is a whole number in the ask's unit, refused in plain words.
test("a supply yes with a fractional amount is refused with a clear message", () => {
  let w = morning();
  w = start(w, pick(w, o => o.kind === "ask-grower" && o.contactId === "outside-1"), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  const sent = structuredClone(w);
  const reply = { channel: "text" as const, text: "Yes, 20.5 lb Friday", quote: "20.5 lb", yes: true, grade: "standard" };
  assert.throws(() => recordSupplyReply(w, "res-1", { ...reply, amount: 20.5 }, ME, T(12)), /^Error: The amount must be a whole number of lb$/);
  assert.deepEqual(w, sent);
});

const FRID = "Hi Birch Hollow Gardens, could you bring another 60 lb of tomato for Frid? Reply with how much you can do. Thanks!";

test("Review Focus 4: unconfirmed words block sending, leave state unchanged, and confirming lets it send; edits reset it", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  assert.throws(() => confirmDraft(w, "res-1", [], ME, T(11)), /nothing to confirm/);
  w = editDraft(w, "res-1", FRID, ME, T(11));
  assert.deepEqual(w.resolutions[0].check.confirm.map(c => c.token), ["Frid"]);
  const before = structuredClone(w);
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, T(12)), /onfirm/);
  assert.deepEqual(w, before);
  w = confirmDraft(w, "res-1", ["Frid"], ME, T(12));
  assert.deepEqual(w.resolutions[0].confirmation, { by: ME, at: T(12), items: ["Frid"] });
  assert.equal(w.resolutions[0].check.ok, false, "confirming never clears problems");
  assert.deepEqual(w.resolutions[0].decisions.at(-1)!.kind, "confirmed");
  w = editDraft(w, "res-1", FRID + " ", ME, T(13));
  assert.equal(w.resolutions[0].confirmation, undefined);
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, T(14)), /onfirm/);
  w = confirmDraft(w, "res-1", ["Frid"], ME, T(14));
  w = redraft(w, "res-1", { ...templateDraft(w.resolutions[0].facts, known(w), "2026-10-28") }, ME, T(15));
  assert.equal(w.resolutions[0].confirmation, undefined);
  w = editDraft(w, "res-1", FRID, ME, T(16));
  w = confirmDraft(w, "res-1", ["Frid"], ME, T(17));
  w = sendMessage(w, "res-1", CONTACTS, ME, T(18));
  assert.equal(w.outbox[0].text, FRID);
  assert.throws(() => confirmDraft(w, "res-1", ["Frid"], ME, T(19)), /already/);
});

test("Review Focus 1: the coordinator's edit is checked against the day it is written", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  const tmrw = "Hi Birch Hollow Gardens, could you bring another 60 lb of tomato for Friday, tmrw? Thanks!";
  const wed = editDraft(w, "res-1", tmrw, ME, "2026-10-28T14:00:00Z"), thu = editDraft(w, "res-1", tmrw, ME, "2026-10-29T14:00:00Z");
  assert.ok(wed.resolutions[0].check.problems.some(p => /tmrw/.test(p)));
  assert.equal(thu.resolutions[0].check.ok, true);
});

test("Review Focus 3: a discarded draft keeps its text, and its option can be started again", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  const text = w.resolutions[0].text;
  assert.throws(() => discardDraft(w, "res-1", "", ME, T(11)), /Reason/);
  const before = structuredClone(w);
  w = discardDraft(w, "res-1", "Wrong grower", ME, T(11));
  assert.notDeepEqual(w, before);
  assert.equal(w.resolutions[0].status, "discarded");
  assert.equal(w.resolutions[0].text, text);
  assert.deepEqual(w.resolutions[0].decisions.at(-1), { at: T(11), actor: ME, kind: "discarded", note: "Wrong grower", text });
  assert.equal(isOpen(w, w.resolutions[0]), false);
  assert.equal(openFor(w, "order-b", w.resolutions[0].option), undefined);
  assert.throws(() => editDraft(w, "res-1", "Hello", ME, T(12)), /already/);
  assert.throws(() => discardDraft(w, "res-1", "again", ME, T(12)), /already/);
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, T(12)), /already/);
  w = start(w, pick(w, askB), 13);
  assert.equal(w.resolutions.length, 2);
  assert.equal(openFor(w, "order-b", w.resolutions[1].option)?.id, "res-2");
  w = sendMessage(w, "res-2", CONTACTS, ME, T(14));
  assert.throws(() => discardDraft(w, "res-2", "late", ME, T(15)), /already/);
  assert.equal(w.resolutions[1].status, "sent");
  // A discarded substitute offer does not block a second offer of the same product.
  let v = start(morning(), pick(morning(), zucchini), 10);
  v = discardDraft(v, "res-1", "Redo", ME, T(11));
  v = start(v, pick(v, zucchini), 12);
  assert.equal(v.resolutions.length, 2);
});

test("Review Focus 2: a substitute agreed at 30 lb stays capped at 30 lb when the shortfall grows to 50", () => {
  let w = morning();
  w = receive(w, MORE, T(5));
  w = interpret(w, "item-4", more(w), "test reading", ME, T(5));
  w = approve(w, "item-4", ME, preview(w, "item-4").reviewHash!, T(5));
  assert.equal(short(w), 30);
  w = start(w, pick(w, zucchini), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = recordBuyerReply(w, "res-1", { channel: "call", text: "Zucchini is fine for up to 30 lb.", accept: true }, ME, T(12));
  assert.equal(short(w), 0);
  assert.equal(w.ledger.snapshot.orders.find(o => o.id === "order-b")!.approvedSubstitutions[0].maxAmount, 30);
  const cut: Source = { id: "msg-tomato-cut", revision: 1, growerId: "grower-b", text: "Only 90 lb of standard tomatoes for Friday after all." };
  w = take(w, cut, w => propose(w.ledger, "p-cut", cut, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 90, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 90 lb of standard tomatoes", "Friday"] }), 20);
  const plan = proposeAllocations(w.ledger.snapshot);
  verifyPlan(w.ledger.snapshot, plan);
  const given = plan.allocations.filter(a => a.orderId === "order-b" && a.kind === "approved-substitution").reduce((n, a) => n + a.amount, 0);
  assert.equal(given, 30);
  assert.equal(short(w), 20);
  assert.ok(plan.unallocated.some(u => u.amount === 10), "the rest of the zucchini stays unallocated");
  assert.equal(orderStatus(w, "order-b"), "short");
  // A tampered plan that goes over the cap is refused.
  const bad = structuredClone(plan), a = bad.allocations.find(x => x.kind === "approved-substitution")!;
  a.amount += 10; bad.unfilled = bad.unfilled.filter(u => u.orderId !== "order-b"); bad.unallocated = bad.unallocated.filter(u => u.lotId !== a.lotId);
  assert.throws(() => verifyPlan(w.ledger.snapshot, bad), /agreed substitute/);
});

test("Fix I1: a draft is read again on the day it is sent", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  const text = "Hi Birch Hollow Gardens, could you bring another 60 lb of tomato for Friday, tmrw? Thanks!";
  w = editDraft(w, "res-1", text, ME, "2026-10-29T14:00:00Z");
  assert.equal(w.resolutions[0].check.ok, true);
  const before = structuredClone(w);
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, "2026-10-30T14:00:00Z"), /checked on 2026-10-29\. On 2026-10-30 it reads differently: .*tmrw.*Edit it or suggest other wording/);
  assert.deepEqual(w, before);
  assert.equal(sendMessage(w, "res-1", CONTACTS, ME, "2026-10-29T18:00:00Z").resolutions[0].status, "sent");
  // A template never reads differently, and a problem the coordinator already saw still only warns.
  let v = start(morning(), pick(morning(), askB), 10);
  v = editDraft(v, "res-1", FRID.replace("Frid", "Thursday"), ME, "2026-10-29T14:00:00Z");
  assert.equal(v.resolutions[0].check.ok, false);
  assert.equal(sendMessage(v, "res-1", CONTACTS, ME, "2026-10-30T14:00:00Z").resolutions[0].status, "sent");
});

test("Fix I2: days are the hub's days, not UTC days", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  const text = "Hi Birch Hollow Gardens, could you bring another 60 lb of tomato for Friday, tmrw? Thanks!";
  // 01:30Z Thursday is 8:30 pm Wednesday in Chicago, so tmrw is Thursday, not Friday.
  assert.ok(editDraft(w, "res-1", text, ME, "2026-10-29T01:30:00Z").resolutions[0].check.problems.some(p => /tmrw/.test(p)));
  assert.equal(editDraft(w, "res-1", text, ME, "2026-10-29T06:00:00Z").resolutions[0].check.ok, true);
  assert.equal(hubDay("2026-10-29T01:30:00Z"), "2026-10-28");
  assert.equal(hubDay("2026-11-02T05:30:00Z"), "2026-11-01");
});

test("Fix I3: a capped substitute is offered again for the extra, and accepting it raises the cap", () => {
  let w = morning();
  w = receive(w, MORE, T(5));
  w = interpret(w, "item-4", more(w), "test reading", ME, T(5));
  w = approve(w, "item-4", ME, preview(w, "item-4").reviewHash!, T(5));
  w = start(w, pick(w, zucchini), 10);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(11));
  w = recordBuyerReply(w, "res-1", { channel: "call", text: "Zucchini is fine for up to 30 lb.", accept: true }, ME, T(12));
  assert.equal(options(w.ledger, "order-b", CONTACTS).some(zucchini), false, "nothing short, nothing to offer");
  const cut: Source = { id: "msg-tomato-cut", revision: 1, growerId: "grower-b", text: "Only 90 lb of standard tomatoes for Friday after all." };
  w = take(w, cut, w => propose(w.ledger, "p-cut", cut, { operation: "replace-total", lotId: "lot-b", quantity: { amount: 90, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: ["Only 90 lb of standard tomatoes", "Friday"] }), 20);
  assert.equal(short(w), 20);
  const again = pick(w, zucchini);
  assert.equal(again.kind === "offer-substitute" && again.covers, 10, "only the zucchini the cap leaves out");
  w = start(w, again, 30);
  w = sendMessage(w, "res-2", CONTACTS, ME, T(31));
  w = recordBuyerReply(w, "res-2", { channel: "call", text: "Fine, take the other 10 lb too.", accept: true }, ME, T(32));
  assert.equal(w.ledger.snapshot.orders.find(o => o.id === "order-b")!.approvedSubstitutions[0].maxAmount, 40);
  assert.equal(short(w), 10);
  const rec = w.ledger.records.at(-1)!;
  assert.deepEqual(rec.kind === "substitute-accepted" && [rec.change, rec.previousMax], ["raised", 30]);
});

test("Fix round 2: words that need confirming only on the send day can be confirmed then", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = editDraft(w, "res-1", "Hi Birch Hollow Gardens, could you bring another 60 lb of tomato for Friday? Maybe this week.", ME, "2026-10-25T14:00:00Z");
  assert.deepEqual(w.resolutions[0].check.confirm, []);
  const monday = "2026-10-26T14:00:00Z", before = structuredClone(w);
  assert.throws(() => sendMessage(w, "res-1", CONTACTS, ME, monday), /Confirm the words/);
  assert.deepEqual(w, before);
  w = confirmDraft(w, "res-1", toConfirm(w, w.resolutions[0], hubDay(monday)).map(c => c.token), ME, monday);
  assert.ok(w.resolutions[0].confirmation!.items.length > 0);
  assert.equal(sendMessage(w, "res-1", CONTACTS, ME, monday).resolutions[0].status, "sent");
  assert.throws(() => confirmDraft(start(morning(), pick(morning(), askB), 10), "res-1", [], ME, monday), /nothing to confirm/);
});

test("Fix round 3: confirming is bound to the words shown; a different set across midnight is refused", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  w = editDraft(w, "res-1", "Hi Birch Hollow Gardens, could you bring another 60 lb of tomato for Frid? Maybe this week.", ME, "2026-10-25T14:00:00Z");
  const sunday = "2026-10-25T23:59:00Z", monday = "2026-10-26T05:01:00Z";
  const shown = toConfirm(w, w.resolutions[0], hubDay(sunday)).map(c => c.token);
  assert.deepEqual(shown, ["Frid"]);
  const before = structuredClone(w);
  assert.throws(() => confirmDraft(w, "res-1", shown, ME, monday), /^Error: The words to confirm have changed\. Check them again\.$/);
  assert.throws(() => confirmDraft(w, "res-1", ["Frid", "this week", "extra"], ME, monday), /have changed/);
  assert.deepEqual(w, before);
  w = confirmDraft(w, "res-1", ["this week", "Frid"], ME, monday);
  assert.deepEqual(w.resolutions[0].confirmation!.items.sort(), ["Frid", "this week"]);
});

test("Fix round 3: canSend is false while words wait to be confirmed, true once confirmed, false once sent", () => {
  let w = morning();
  w = start(w, pick(w, askB), 10);
  const day = hubDay(T(11));
  assert.equal(canSend(w, w.resolutions[0], day), true, "a template draft has nothing to confirm");
  w = editDraft(w, "res-1", FRID, ME, T(11));
  assert.equal(canSend(w, w.resolutions[0], day), false);
  w = confirmDraft(w, "res-1", ["Frid"], ME, T(12));
  assert.equal(canSend(w, w.resolutions[0], day), true);
  w = sendMessage(w, "res-1", CONTACTS, ME, T(13));
  assert.equal(canSend(w, w.resolutions[0], day), false);
});

test("Task 21: quoteFor takes the sentence that says yes or no, and leaves unclear texts to the coordinator", () => {
  assert.equal(quoteFor("Hi! Yes, zucchini works for us. Thanks.", true), "Yes, zucchini works for us.");
  assert.equal(quoteFor("Sorry, no. We are full.", false), "Sorry, no.");
  assert.equal(quoteFor("Zucchini works for us", true), undefined);
  assert.equal(quoteFor("Yes to the squash, no to the zucchini", true), undefined);
  assert.equal(quoteFor("Know anyone? Nobody here.", false), undefined);
  // Both words: the word pressed wins only when it starts a sentence of its own ("Yes, no problem.")
  assert.equal(quoteFor("Yes, no problem.", true), "Yes, no problem.");
  assert.equal(quoteFor("Yes, no problem.", false), undefined, "the other button does not take it");
  assert.equal(quoteFor("No problem, we'll take it.", false), undefined, "\"no problem\" is never a no");
  assert.equal(quoteFor("No worries, we'll take it.", false), undefined);
  assert.equal(quoteFor("Thanks. Yes, but no to the zucchini.", true), undefined, "a no that is not just \"no problem\" still leaves it to the coordinator");
  assert.equal(quoteFor("Yes, thanks. No, not Friday.", true), undefined, "a second sentence that says no leaves it to the coordinator");
  assert.equal(quoteFor("Zucchini, yes, and no problem.", true), undefined, "the word does not start the sentence");
});
