import test from "node:test";
import assert from "node:assert/strict";
import { CONTACTS, demoSnapshot } from "../src/demo.ts";
import { PROMPT_VERSION } from "../src/interpret.ts";
import { readFileSync } from "node:fs";
import { BUYER_REPLIES, DEMO_MODEL, REQUEST_REPLIES, needsReset, recordedDraft, scriptedReply, scriptedRequestReply, seedWorkbench, type Extras, type Recording } from "../src/seed.ts";
import { DRAFT_PROMPT_VERSION } from "../src/draft.ts";
import { factsDigest } from "../src/messages.ts";
import { createLedger } from "../src/updates.ts";
import { approve, createWorkbench, preview } from "../src/workbench.ts";
import { logCall, sendMessage } from "../src/resolve.ts";
import { ME, T, askB, MORE, morning, pick, start, zucchini } from "./story.ts";

const reading = JSON.stringify({ operation: "add-quantity", lotId: "lot-b", quantity: { amount: 30, unit: "lb", pack: null }, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: null,
  evidence: [{ field: "quantity", quote: "another 30 lb of standard tomatoes" }, { field: "operation", quote: "another" }, { field: "grade", quote: "standard" }, { field: "date", quote: "Friday" }, { field: "lot", quote: "tomatoes" }], unresolved: [], questions: [] });
const extras = (over: Partial<Extras> = {}): Extras => ({ model: DEMO_MODEL, promptVersion: PROMPT_VERSION, draftPromptVersion: DRAFT_PROMPT_VERSION, recordedAt: "2026-10-28T15:00:00Z", drafts: {}, readings: { "msg-tomato-more": reading }, ...over });
const asked = () => { const w = morning(); return sendMessage(start(w, pick(w, askB), 10), "res-1", CONTACTS, ME, T(11)); };

test("the scripted texts are the demo's words", () => {
  assert.equal(REQUEST_REPLIES["grower-b"].text, "We can bring another 30 lb of standard tomatoes Friday.");
  assert.equal(REQUEST_REPLIES["grower-b"].id, "msg-tomato-more");
  assert.deepEqual(BUYER_REPLIES["buyer-b"], { channel: "call", text: "Called kitchen manager, zucchini is fine for the rest." });
});

test("with recorded extras the reply arrives interpreted and linked to the ask", async () => {
  const w = await scriptedRequestReply(asked(), "res-1", extras(), T(12));
  const item = w.items.at(-1)!;
  assert.equal(item.source.id, "msg-tomato-more");
  assert.equal(w.resolutions[0].linkedItemId, item.id);
  assert.ok(item.proposal, "interpreted");
  assert.equal(item.proposal!.interpretation.operation, "add-quantity");
  assert.match(item.interpretedBy!, /Muse Spark/);
});

test("without extras, or with a stale prompt or model, the item waits uninterpreted", async () => {
  for (const x of [undefined, extras({ readings: {} }), extras({ promptVersion: "v3" }), extras({ model: "other-model" })]) {
    const w = await scriptedRequestReply(asked(), "res-1", x, T(12));
    assert.equal(w.items.at(-1)!.source.id, "msg-tomato-more");
    assert.equal(w.resolutions[0].linkedItemId, w.items.at(-1)!.id);
    assert.equal(w.items.at(-1)!.proposal, undefined);
  }
});

test("a contact with no scripted reply is refused, and an unsent ask takes none", async () => {
  const w = morning();
  const ask = sendMessage(start(w, pick(w, o => o.kind === "ask-grower" && o.contactId === "grower-a" && o.hasLot), 10), "res-1", CONTACTS, ME, T(11));
  await assert.rejects(scriptedRequestReply(ask, "res-1", extras(), T(12)), /no scripted reply/i);
  await assert.rejects(scriptedRequestReply(start(w, pick(w, askB), 10), "res-1", extras(), T(12)));
});

test("a recorded draft is used only when the message facts match", () => {
  const w = morning(), s = start(w, pick(w, zucchini), 10), facts = s.resolutions[0].facts;
  const x = extras({ drafts: { [factsDigest(facts)]: "Hi, would zucchini work?" } });
  assert.equal(recordedDraft(x, facts), "Hi, would zucchini work?");
  assert.equal(recordedDraft(x, { ...facts, amount: facts.amount + 1 }), undefined);
  assert.equal(recordedDraft(undefined, facts), undefined);
  assert.equal(recordedDraft({ ...x, model: "other-model" }, facts), undefined);
  assert.equal(recordedDraft({ ...x, draftPromptVersion: "draft-v1" }, facts), undefined);
  assert.equal(recordedDraft({ ...x, draftPromptVersion: undefined }, facts), undefined);
});

test("a call note can carry the buyer's recorded answer", () => {
  const w = logCall(morning(), "grower-b", BUYER_REPLIES["buyer-b"].text, ME, T(20));
  assert.equal(w.calls, 1);
});

test("the reset guard flags stored state from before resolutions or pounds", async () => {
  const fresh = await seedWorkbench(undefined);
  assert.equal(needsReset(fresh), false);
  const { resolutions: _, ...old } = fresh;
  assert.equal(needsReset(old as never), true);
  assert.equal(needsReset(createWorkbench(createLedger({ ...demoSnapshot(), lots: demoSnapshot().lots.map(l => ({ ...l, quantity: { amount: l.quantity.amount, unit: "kg" as const } })) }))), true);
  assert.equal(needsReset(undefined as never), true);
});

test("the pounds evaluation set is valid against the demo hub", async () => {
  const { readFileSync } = await import("node:fs");
  const { prepareLedger, validateCase } = await import("../evaluation/score.ts");
  const file = JSON.parse(readFileSync("evaluation/pounds.json", "utf8")), lots = new Map(demoSnapshot().lots.map(l => [l.id, l]));
  assert.equal(file.hub, "demo");
  assert.equal(file.cases.length, 8);
  assert.equal(new Set(file.cases.map((c: { id: string }) => c.id)).size, 8);
  for (const c of file.cases) {
    validateCase(c);
    prepareLedger(c, "demo");
    if (c.label.lotId) assert.equal(lots.get(c.label.lotId)?.growerId, c.growerId, `${c.id}: the sender's own lot`);
  }
  assert.ok(file.cases.some((c: { label: { ask: string[] } }) => c.label.ask.includes("unit")), "one ambiguous unit");
});

test("the scripted grower reply on a stale item refreshes it first, then reads the reply", async () => {
  const rec = JSON.parse(readFileSync(new URL("../data/seed-readings.json", import.meta.url), "utf8")) as Recording;
  let w = await seedWorkbench(rec, T(0));
  const tomato = w.items.find(i => i.source.id === "msg-tomato")!, cucumber = w.items.find(i => i.source.id === "msg-cucumber")!;
  w = approve(w, tomato.id, ME, preview(w, tomato.id).reviewHash!, T(1));
  assert.equal(preview(w, cucumber.id).stale, true);
  w = await scriptedReply(w, cucumber.id, rec, ME, T(2));
  const after = w.items.find(i => i.id === cucumber.id)!;
  assert.deepEqual(after.decisions.slice(-2).map(d => [d.kind, d.actor]), [["refreshed", ME], ["replied", ME]]);
  assert.equal(preview(w, cucumber.id).stale, false);
});
