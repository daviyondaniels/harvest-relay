import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { propose, scenario, surplus } from "../evaluation/scenario.ts";
import { LATE, seedWorkbench } from "../src/seed.ts";
import { confirmPlan } from "../src/commitments.ts";
import { normalize } from "../src/quantity.ts";
import { createLedger } from "../src/updates.ts";
import { permissionSource } from "../src/orders.ts";
import { CONTACTS } from "../src/demo.ts";
import { recordBuyerReply, sendMessage } from "../src/resolve.ts";
import { ME as SME, T as ST, morning, pick, start, zucchini } from "./story.ts";
import { answerRecorded, answerRecordedAndApprove, createWorkbench, interpret, preview, previewAnswers, previewHand, previewRecordedAnswers, receive, reply, suggestAnswers, suggestReading } from "../src/workbench.ts";
import { promiseText, updateName } from "../app/lib/format.ts";
import { keepWho, KEPT_WHO } from "../app/lib/kept.ts";

// Task 17: Review, Orders and forms.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readings = () => JSON.parse(readFileSync(new URL("../data/seed-readings.json", import.meta.url), "utf8"));
const NOW = "2026-10-28T14:00:00.000Z", ME = "Hub coordinator", T = (m: number) => new Date(Date.UTC(2026, 9, 28, 9, m)).toISOString();

test("the hand preview of the late message says Riverbend School Kitchen becomes short 10 lb, on a copy", async () => {
  let w = await seedWorkbench(readings(), NOW);
  w = receive(confirmPlan(w, ME, NOW, { shipShort: true }), LATE.source, NOW);
  const id = w.items.at(-1)!.id, g = suggestReading(w, id), before = structuredClone(w);
  const p = previewHand(w, id, { operation: g.operation!, lotId: g.lotId!, quantity: g.quantity!, grade: g.grade!, deliveryOn: g.deliveryOn!, quote: "70 lb" }, NOW)!;
  assert.ok(p.change && p.reviewHash && !p.questions.length);
  const moved = p.orders.filter(o => o.after.short !== o.before.short);
  assert.deepEqual(moved.map(o => [o.orderId, o.after.short]), [["order-b", 10]], "one buyer, 10 lb short");
  assert.deepEqual(w, before, "the input is untouched");
  assert.equal(previewHand(w, id, { operation: "replace-total", lotId: g.lotId!, quantity: g.quantity!, grade: "standard", deliveryOn: g.deliveryOn! }, NOW), undefined, "a refused reading has no preview");
});

const SRC = { id: "note-b", revision: 1, growerId: "grower-b", text: "We have four cases of standard zucchini for Friday now." };
const REPLY = { id: "note-b-reply", revision: 1, growerId: "grower-b", text: "Confirmed net contents: 5 kg per case; this is the new lot total." };
const PACK = { field: "pack" as const, quote: "5 kg per case", value: { amount: 5, unit: "kg" } };
const KIND = { field: "operation" as const, quote: "this is the new lot total", value: "replace-total" };
function twoOpen() {
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, SRC, T(1));
  return interpret(w, "item-1", surplus(w.ledger), "test reading", ME, T(2));
}

test("a partial answer keeps the reply: the rest is applied against it, with no second replied line", () => {
  const w = twoOpen(), kept = reply(w, "item-1", REPLY, [KIND], [], ME, T(3));
  assert.deepEqual(preview(kept, "item-1").questions.map(q => q.field), ["pack"]);
  assert.deepEqual(kept.items[0].decisions.filter(d => d.kind === "replied").length, 1);
  // The recorded reply suggests the contents of a case.
  assert.deepEqual(suggestAnswers(kept, "item-1", ["pack"]), { pack: "5 kg" });
  const shown = previewRecordedAnswers(kept, "item-1", [PACK], T(4))!;
  assert.ok(shown.change && !shown.questions.length, "the preview shows the finished change");
  const before = structuredClone(kept);
  assert.equal(answerRecorded(kept, "item-1", [PACK], [], ME, T(4)).items[0].decisions.filter(d => d.kind === "replied").length, 1);
  const done = answerRecordedAndApprove(kept, "item-1", [PACK], [], ME, T(4));
  assert.equal(done.approved, true);
  const item = done.next.items[0];
  assert.deepEqual([item.state, item.replies.length], ["approved", 1], "the reply is not recorded twice");
  assert.deepEqual(item.decisions.slice(-3).map(d => d.kind), ["replied", "answered", "approved"]);
  assert.equal(item.decisions.at(-1)!.reviewHash, shown.reviewHash, "approved against the hash the preview showed");
  assert.equal(normalize(done.next.ledger.snapshot.lots.find(l => l.id === "lot-d")!.quantity).amount, 20000);
  assert.deepEqual(kept, before, "the input is untouched");
  assert.throws(() => answerRecorded(w, "item-1", [PACK], [], ME, T(4)), /No reply is recorded yet/);
});

test("Apply and approve previews the answers that fill the open details; a refusal has no preview", () => {
  const w = twoOpen();
  const p = previewAnswers(w, "item-1", REPLY, [KIND, PACK], T(3))!;
  assert.ok(p.change && !p.questions.length && p.reviewHash);
  assert.equal(previewAnswers(w, "item-1", REPLY, [KIND, { ...PACK, quote: "not in the reply" }], T(3)), undefined);
});

test("a logged call that answers an ask is an addition, so Save and approve is offered", () => {
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, { id: "call-1", revision: 1, growerId: "grower-b", text: "Yes I can bring another 10 lb of zucchini Friday" }, T(1));
  assert.equal(suggestReading(w, "item-1").operation, "add-quantity");
  w.items[0].requestId = "res-1";
  const none = receive(createWorkbench(createLedger(scenario())), { id: "call-1", revision: 1, growerId: "grower-b", text: "We can do 30 lb of zucchini" }, T(1));
  assert.equal(suggestReading(none, "item-1").operation, undefined, "a plain note guesses nothing");
  none.items[0].requestId = "res-1";
  assert.equal(suggestReading(none, "item-1").operation, "add-quantity", "but an answer to an ask for more adds");
});

test("They said yes with no channel records only who recorded the answer, claiming no call or text", () => {
  let w = morning();
  w = start(w, pick(w, zucchini), 30);
  w = sendMessage(w, "res-1", CONTACTS, SME, ST(31));
  w = recordBuyerReply(w, "res-1", { channel: "recorded", text: "", accept: true }, "Sam", ST(40));
  const r = w.resolutions.find(x => x.id === "res-1")!;
  assert.deepEqual([r.reply!.channel, r.reply!.text, r.reply!.quote], ["recorded", "Answer recorded by Sam", "Answer recorded by Sam"]);
  assert.equal(r.status, "accepted");
  const src = permissionSource(w.ledger, "order-b", "zucchini");
  assert.ok(src.kind === "agreed" && src.record.kind === "substitute-accepted", "recorded permission");
  if (src.kind === "agreed" && src.record.kind === "substitute-accepted") assert.deepEqual([src.record.evidence.channel, src.record.evidence.quote], ["recorded", "Answer recorded by Sam"]);
});

test("names and copy", () => {
  const f = new FormData();
  f.set("who", "  Sam "); assert.deepEqual(keepWho(f), { [KEPT_WHO]: "Sam" });
  assert.deepEqual(keepWho(new FormData()), {});
  const ns = source("app/named-submit.tsx");
  assert.match(ns, /defaultValue=\{kept\}/);
  assert.doesNotMatch(ns, /Your name<span/, "no sr-only span that reads as 'Your name , for'");
  const actions = source("app/actions.ts");
  assert.match(actions, /\.\.\.keepWho\(f\)/);
  // The Orders page: one intro line, quiet Other options, sentence-shaped accessible names, noValidate on Send and Log a call.
  const orders = source("app/orders/page.tsx"), review = source("app/review/page.tsx");
  assert.match(orders, /known=\{known\} on=\{`opt-\$\{index\}-draft`\} bad=\{bad\} quiet \/>/);
  assert.doesNotMatch(orders, /sr=" for this step"/);
  assert.match(orders, /This is the message for this step\./);
  assert.match(orders, /<form action=\{requestedCallAction\} className="form" noValidate>/);
  assert.match(review, /<form action=\{readByHandAction\} className="form" id="hand-form" noValidate>/);
  // Review: previews before the one-step buttons, one Approve.
  assert.match(review, /If saved as shown:/);
  assert.match(review, /If these answers are applied:/);
  assert.match(review, /Changes you make here will be checked before approving\./);
  assert.match(review, /Their reply is recorded above\./);
  assert.match(review, /Answer the questions to approve/);
  assert.match(review, /updateName\(l\.growerId, l\.product, e\.lotAfter\)/);
});

test("the earlier update reads as plain words, and 'not promised yet' is not said once the buyer is settled", () => {
  assert.equal(updateName("grower-b", "Zucchini", { amount: 4, unit: "case", pack: { amount: 10, unit: "lb" } }), "Birch Hollow Gardens' zucchini update (4 cases of 10 lb)");
  assert.deepEqual(promiseText({ promised: 0, ordered: 10, unit: "lb" }, 5), ["Not promised to the buyer yet"]);
  assert.deepEqual(promiseText({ promised: 0, ordered: 10, unit: "lb" }, 5, true), []);
});
