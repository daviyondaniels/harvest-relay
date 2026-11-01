import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scenario, surplus } from "../evaluation/scenario.ts";
import { seedWorkbench } from "../src/seed.ts";
import { PromisesMoved, approveRebased, commitKey, confirmPlan, conflicts, markAllStage, markStage, stageable } from "../src/commitments.ts";
import { shortages } from "../src/orders.ts";
import { createLedger } from "../src/updates.ts";
import { approve, ask, createWorkbench, interpret, preview, readByHand, receive, reply, replyIsRecorded, type Workbench } from "../src/workbench.ts";
import { noChangeDismissable } from "../app/lib/view.ts";

// The final whole-branch review: rebased actions act only on what the page showed, and the server works
// out for itself what a form used to claim.
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z", ME = "Hub coordinator";
const seed = () => seedWorkbench(JSON.parse(readFileSync(new URL("../data/seed-readings.json", import.meta.url), "utf8")), NOW);
const bySource = (w: Workbench, id: string) => w.items.find(i => i.source.id === id)!;
const HAND = (lotId: string, amount: number, operation: "replace-total" | "add-quantity", quote: string) =>
  ({ operation, lotId, quantity: { amount, unit: "lb" as const }, grade: "standard", deliveryOn: "2026-10-30", quote });

// +40 lb on lot-b approved; the tomato message hand-read as "lot-a total 100 lb": its preview opens no cut and leaves nobody newly short.
async function reproduction() {
  let w = await seed();
  w = receive(w, { id: "msg-more", revision: 1, growerId: "grower-b", text: "We can bring another 40 lb of standard tomatoes Friday." }, NOW);
  const more = w.items.at(-1)!;
  w = readByHand(w, more.id, HAND("lot-b", 40, "add-quantity", "another 40 lb"), ME, NOW);
  w = approve(w, more.id, ME, preview(w, more.id).reviewHash!, NOW);
  const tomato = bySource(w, "msg-tomato");
  w = readByHand(w, tomato.id, HAND("lot-a", 100, "replace-total", "Only 60 lb"), ME, NOW);
  return { w, id: tomato.id, hash: preview(w, tomato.id).reviewHash! };
}

test("a rebased Approve is refused when another tab confirmed the plan and approving would open a cut", async () => {
  const { w, id, hash } = await reproduction(), seen = commitKey(w.ledger);
  assert.equal(conflicts(approve(w, id, ME, hash, LATER).ledger).length, 0, "on the state the page showed it opens no cut");
  const other = confirmPlan(w, "Other tab", NOW, { shipShort: true });
  assert.notEqual(commitKey(other.ledger), seen, "the confirm moves the promises");
  assert.equal(other.ledger.version, w.ledger.version, "but not the ledger version");
  // The review hash alone still matches, and approving would open a 20 lb cut: the old behaviour.
  assert.deepEqual(conflicts(approve(other, id, ME, hash, LATER).ledger).map(c => [c.lotId, c.excess]), [["lot-a", 20]]);
  const before = structuredClone(other);
  assert.throws(() => approveRebased(other, id, ME, hash, seen, LATER), PromisesMoved);
  assert.deepEqual(other, before, "nothing changed");
  assert.throws(() => approveRebased(other, id, ME, hash, undefined, LATER), PromisesMoved, "a form with no promises key is treated as out of date");
});

test("an unrelated change in between still lets the approve through", async () => {
  const { w, id, hash } = await reproduction(), seen = commitKey(w.ledger);
  // Another order marked packed in another tab does not touch the promises.
  const confirmed = confirmPlan(w, "Other tab", NOW, { shipShort: true }), shownConfirmed = commitKey(confirmed.ledger);
  const marked = markStage(confirmed, "order-b", "packed", "Other tab", LATER);
  assert.equal(commitKey(marked.ledger), shownConfirmed, "a stage mark leaves the key alone");
  // Another item approved meanwhile (version moves, hash no longer matches the new snapshot): refused by the hash, as before.
  const forecast = bySource(w, "msg-forecast");
  const other = approveRebased(w, forecast.id, ME, preview(w, forecast.id).reviewHash!, seen, LATER);
  assert.equal(commitKey(other.ledger), seen, "approving a forecast moves no promises");
  assert.equal(approveRebased(other, id, ME, preview(other, id).reviewHash!, seen, LATER).items.find(i => i.id === id)!.state, "approved", "promises unchanged: approved on the newer version as before");
  // Plan confirmed in between, but the approval opens no cut and leaves nobody newly short: it still goes through.
  const f2 = approveRebased(confirmed, forecast.id, ME, preview(confirmed, forecast.id).reviewHash!, seen, LATER);
  assert.equal(f2.items.find(i => i.id === forecast.id)!.state, "approved");
  assert.equal(conflicts(f2.ledger).length, 0);
});

test("Stage all marks only the orders the page counted", async () => {
  const w = confirmPlan(await seed(), ME, NOW, { shipShort: true }), all = stageable(w, "packed");
  assert.ok(all.length >= 2, "several orders could be packed");
  const shown = all.slice(0, 1), r = markAllStage(w, "packed", ME, LATER, shown);
  assert.deepEqual(r.marked, shown, "the others, never shown, are left alone");
  assert.deepEqual(markAllStage(w, "packed", ME, LATER).marked, all, "without a list it marks everything that can");
  assert.throws(() => markAllStage(w, "packed", ME, LATER, []), /No order can be marked packed/);
  assert.throws(() => markAllStage(w, "packed", ME, LATER, ["order-not-there"]), /No order can be marked packed/);
});

test("No change, dismiss is offered by the server only for what the Overview or Review offers it for", async () => {
  const w = await seed(), tomato = bySource(w, "msg-tomato"), junk = bySource(w, "msg-injection");
  assert.equal(noChangeDismissable(tomato), false, "a real update naming a lot and an amount");
  assert.equal(noChangeDismissable(bySource(w, "msg-cucumber")), false, "a real update with a question open on case size");
  assert.equal(noChangeDismissable(junk), true, "names no amount");
  assert.equal(noChangeDismissable({ ...tomato, proposal: undefined }), true, "Review offers it for a message not read yet");
  const unresolved = structuredClone(tomato);
  unresolved.proposal!.interpretation.operation = "unresolved";
  assert.equal(noChangeDismissable(unresolved), true, "Review offers it where the reading is unresolved");
});

test("the server works out whether the reply is already recorded", () => {
  const SRC = { id: "note-b", revision: 1, growerId: "grower-b", text: "We have four cases of standard zucchini for Friday now." };
  const REPLY = { id: "note-b-reply", revision: 1, growerId: "grower-b", text: "Confirmed net contents: 5 kg per case; this is the new lot total." };
  const KIND = { field: "operation" as const, quote: "this is the new lot total", value: "replace-total" };
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, SRC, NOW);
  w = interpret(w, "item-1", surplus(w.ledger), "test reading", ME, NOW);
  assert.equal(replyIsRecorded(w, "item-1"), false, "no reply yet");
  w = reply(w, "item-1", REPLY, [KIND], [], ME, LATER);
  assert.equal(replyIsRecorded(w, "item-1"), true, "replied, a detail still open");
  assert.equal(replyIsRecorded(ask(w, "item-1", "pack", "How much is in each case?", ME, LATER), "item-1"), false, "a newer question: the next reply is a new one");
  assert.ok(shortages(w.ledger));
});
