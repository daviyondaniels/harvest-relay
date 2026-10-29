import test from "node:test";
import assert from "node:assert/strict";
import { DRAFT_PROMPT_VERSION, buildDraftRequest, failedTheCheck, draftMessage, purpose, templateDraft } from "../src/draft.ts";
import { createBudget, type InterpretOptions } from "../src/interpret.ts";
import { DEMO_MODEL, DEMO_SETTINGS, replay } from "../src/seed.ts";
import { checkDraft, template, type MessageFacts } from "../src/messages.ts";

const F: MessageFacts = { kind: "offer", to: { kind: "buyer", id: "buyer-b", name: "Riverbend School Kitchen" }, product: "tomato", substitute: "zucchini", amount: 30, unit: "lb", deliveryOn: "2026-10-30" };
const P = ["tomato", "cucumber", "zucchini"];
const GOOD = '{"text":"Hi Riverbend School Kitchen, could you take 30 lb of zucchini for Friday instead of tomatoes?"}';
const opts = (o: Partial<InterpretOptions> = {}): InterpretOptions => ({ model: DEMO_MODEL, enabled: true, budget: createBudget(5), reasoningEffort: DEMO_SETTINGS.reasoningEffort, ...o });

test("a checked model draft is kept and labelled", async () => {
  const d = await draftMessage(F, P, opts({ transport: replay(GOOD) }), "Muse Spark");
  assert.equal(d.by, "Muse Spark");
  assert.equal(d.author, "model");
  assert.ok(d.check.ok);
  assert.equal(d.fallback, undefined);
});

test("a model draft with only confirmation items is kept, with its items", async () => {
  const d = await draftMessage(F, P, opts({ transport: replay(GOOD.replace("Friday", "Friday (tmrw)")) }), "Muse Spark");
  assert.equal(d.author, "model");
  assert.deepEqual(d.check, { ok: true, problems: [], confirm: [{ token: "tmrw", question: `"tmrw" — which day is that?` }] });
  const w = await draftMessage(F, P, opts({ transport: replay(GOOD.replace("Friday", "Friday (tmrw)")) }), "Muse Spark", "2026-10-28");
  assert.equal(w.author, "template");
  assert.match(w.fallback!, /"tmrw" means Thursday; the delivery is Friday/);
});

test("a draft that fails the check falls back to the template", async () => {
  const d = await draftMessage(F, P, opts({ transport: replay(GOOD.replace("30 lb", "40 lb")) }), "Muse Spark");
  assert.equal(d.by, "Template");
  assert.equal(d.author, "template");
  assert.equal(d.text, template(F));
  assert.match(d.fallback!, /^Model draft failed the check: .*40 lb/);
});

test("disabled returns the template", async () => {
  const d = await draftMessage(F, P, opts({ enabled: false, transport: replay(GOOD) }), "Muse Spark");
  assert.equal(d.by, "Template");
  assert.match(d.fallback!, /disabled|off/);
});

test("transport failure, bad JSON and long text fall back", async () => {
  const boom = async () => { throw new Error("network down"); };
  const a = await draftMessage(F, P, opts({ transport: boom }), "Muse Spark");
  assert.deepEqual([a.by, a.text], ["Template", template(F)]);
  assert.match(a.fallback!, /^Model call failed: /);
  for (const raw of ["nope", '{"text":5}', `{"text":"${"a".repeat(2001)}"}`]) {
    const d = await draftMessage(F, P, opts({ transport: replay(raw) }), "Muse Spark");
    assert.equal(d.by, "Template");
    assert.equal(d.fallback, "Model reply was not valid draft JSON");
  }
});

test("request carries only the facts, not ids or ranking", () => {
  const r = buildDraftRequest(F, DEMO_MODEL, 800, "minimal");
  const s = JSON.stringify(r);
  assert.ok(!s.includes("buyer-a") && !s.includes("priority"));
  assert.equal(r.response_format.json_schema.name, "draft");
  assert.deepEqual(JSON.parse(r.messages[1].content).day, "Friday");
  assert.equal(JSON.parse(r.messages[1].content).quantity, "30 lb");
  assert.equal(DRAFT_PROMPT_VERSION, "draft-v2");
});

test("templateDraft passes its own check", () => {
  const d = templateDraft(F, P);
  assert.deepEqual([d.by, d.text, d.check.ok], ["Template", template(F), true]);
});

test("omitting enabled fails closed: template, no transport call, no budget spent", async () => {
  let calls = 0;
  const transport = async (...a: Parameters<ReturnType<typeof replay>>) => { calls++; return replay(GOOD)(...a); };
  const o = opts({ transport, enabled: undefined });
  const d = await draftMessage(F, P, o, "Muse Spark");
  assert.equal(d.by, "Template");
  assert.match(d.fallback!, /off/);
  assert.deepEqual([calls, o.budget.remaining], [0, 5]);
});

test("an exhausted budget falls back without a call", async () => {
  let calls = 0;
  const d = await draftMessage(F, P, opts({ budget: createBudget(0), transport: async () => { calls++; return {}; } }), "Muse Spark");
  assert.equal(d.by, "Template");
  assert.match(d.fallback!, /^Model call failed: No model calls remain/);
  assert.equal(calls, 0);
});

const FACTS: Record<MessageFacts["kind"], MessageFacts> = {
  request: { kind: "request", to: { kind: "grower", id: "grower-b", name: "Hillside Farm" }, product: "tomato", amount: 30, unit: "lb", deliveryOn: "2026-10-30" },
  offer: F,
  notice: { kind: "notice", to: { kind: "buyer", id: "buyer-b", name: "Riverbend School Kitchen" }, product: "tomato", amount: 30, unit: "lb", deliveryOn: "2026-10-30" }
};
// What a good model reply says for each kind, written by hand.
const IDEAL: Record<MessageFacts["kind"], string> = {
  request: "Hi Hillside Farm, can you bring another 30 lb of tomato for Friday? Please tell me how much you can do.",
  offer: "Hi Riverbend School Kitchen, your tomato order for Friday is 30 lb short. Would zucchini work instead for that 30 lb? Please reply yes or no.",
  notice: "Hi Riverbend School Kitchen, your tomato order for Friday will be 30 lb short."
};

test("the request carries the message kind and its purpose sentence", () => {
  for (const kind of ["request", "offer", "notice"] as const) {
    const body = JSON.parse(buildDraftRequest(FACTS[kind], DEMO_MODEL, 800, "minimal").messages[1].content);
    assert.equal(body.kind, kind);
    assert.equal(body.purpose, purpose(FACTS[kind]));
  }
  assert.match(purpose(FACTS.offer), /never suggest that tomato is available/i);
});

test("each purpose states the same facts the template does", () => {
  for (const kind of ["request", "offer", "notice"] as const) {
    const f = FACTS[kind], p = purpose(f), t = template(f);
    for (const fact of ["30 lb", "Friday", f.product, ...(f.substitute ? [f.substitute] : [])]) {
      assert.ok(p.includes(fact), `${kind} purpose lacks ${fact}`);
      assert.ok(t.includes(fact), `${kind} template lacks ${fact}`);
    }
    // The key phrase of each purpose is the template's own wording.
    const phrase = { request: ["another", "how much"], offer: ["short", "yes or no"], notice: ["short"] }[kind];
    for (const w of phrase) { assert.ok(p.toLowerCase().includes(w), `${kind} purpose lacks "${w}"`); assert.ok(t.toLowerCase().includes(w), `${kind} template lacks "${w}"`); }
    // Time words the checker reads as shifts stay out of what the model is told.
    assert.doesNotMatch(p, /\b(next|after|from|last|week|tomorrow)\b/i);
  }
});

test("the system prompt steers the model to what the checker accepts", () => {
  const sys = buildDraftRequest(F, DEMO_MODEL, 800, "minimal").messages[0].content;
  assert.match(sys, /full name of the day/i);
  assert.match(sys, /tomorrow/i);
  assert.match(sys, /digits and units/i);
  assert.match(sys, /no other product/i);
});

test("an ideal reply for each kind passes the check the day before delivery", () => {
  for (const kind of ["request", "offer", "notice"] as const) {
    const c = checkDraft(IDEAL[kind], FACTS[kind], P, "2026-10-29");
    assert.deepEqual(c, { ok: true, problems: [], confirm: [] }, kind);
    assert.deepEqual(checkDraft(template(FACTS[kind]), FACTS[kind], P, "2026-10-29"), { ok: true, problems: [], confirm: [] }, `${kind} template`);
  }
});

test("Final review: only a fallback caused by the check is said to have failed it", async () => {
  const bad = await draftMessage(F, P, opts({ transport: replay('{"text":"Hi, can you take 99 lb of zucchini?"}') }), "Muse Spark");
  assert.ok(bad.fallback);
  assert.equal(failedTheCheck(bad.fallback), true);
  const junk = await draftMessage(F, P, opts({ transport: replay("not json") }), "Muse Spark");
  assert.ok(junk.fallback);
  assert.equal(failedTheCheck(junk.fallback), false, "bad JSON is not a failed check");
  assert.equal(failedTheCheck("Model call failed: timeout"), false);
});
