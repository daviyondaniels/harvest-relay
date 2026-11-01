import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTACTS, BUYERS } from "../src/demo.ts";
import { templateDraft } from "../src/draft.ts";
import { confirmPlan, conflicts } from "../src/commitments.ts";
import { options, shortages } from "../src/orders.ts";
import { draftWaiting, factsFor, sendMessage, startResolution, toldBuyer, type Resolution } from "../src/resolve.ts";
import { LATE, seedWorkbench } from "../src/seed.ts";
import { approve, preview, readByHand, readByHandAndApprove, receive, suggestReading, type HandReading, type Workbench } from "../src/workbench.ts";
import { FORM_FIELDS, FieldError, fieldOf } from "../app/lib/errors.ts";
import { status, ORDER_STATUS, promiseText } from "../app/lib/format.ts";
import { NAME_NEEDED, runAs } from "../app/lib/names.ts";
import { numberSpan } from "../app/lib/quote.ts";
import { approvalResult, shortMap } from "../app/lib/view.ts";

// Task 14: Orders and Review, errors and the remaining clicks.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readings = () => JSON.parse(source("data/seed-readings.json"));
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z", ME = "Hub coordinator";
const NAMES: Record<string, string> = { ...Object.fromEntries(CONTACTS.map(c => [c.id, c.name])), ...BUYERS };
const products = (w: Workbench) => [...new Set([...w.ledger.snapshot.lots, ...w.ledger.snapshot.orders].map(x => x.product))];

// ---- No silent refusals ----
test("every form a step names has its fields listed, and fieldOf only ever names a field of that form", () => {
  const actions = source("app/actions.ts");
  const used = new Set([...actions.matchAll(/\bon: "([\w-]+)"/g)].map(m => m[1]).concat([...actions.matchAll(/failed\(e, "([\w-]+)"/g)].map(m => m[1])));
  for (const on of used) assert.ok(on in FORM_FIELDS, `${on} is used by an action but has no entry in FORM_FIELDS`);
  const messages = ["Case contents must be more than zero.", "Case contents must be g, kg, lb or each", "That amount is more than this hub handles (over 100,000 lb, or 2,000 per case). Check it.",
    "Answer quantities must be nonnegative whole numbers", "This ask was already answered", "Invalid operation answer", "A positive amount is required for a yes", "The amount must be a whole number of lb",
    "The order does not accept grade Z", "Record whether they can supply", "A quote from the reply text is required", "Reply channel must be text or call", "Literal source evidence required", "Something nobody mapped"];
  for (const on of Object.keys(FORM_FIELDS)) for (const where of [{}, { supply: true }, { supply: false }, { filled: ["pack"] }, { filled: ["quantity", "unit"] }])
    for (const m of messages) {
      const f = fieldOf(new Error(m), on, where);
      assert.ok(f === undefined || FORM_FIELDS[on].includes(f), `${on} ${JSON.stringify(where)} "${m}" -> ${f}`);
    }
  // A message nobody maps falls back to the form's own result, which every form shows.
  assert.equal(fieldOf(new Error("Something nobody mapped"), "reply", { supply: true }), undefined);
  assert.equal(fieldOf(new FieldError("Enter the value.", "value-lot"), "reply"), "value-lot");
});

test("Orders: the Record their reply form's errors land on its amount, grade or yes, not on a value field the form lacks", () => {
  const at = (m: string) => fieldOf(new Error(m), "reply", { supply: true });
  assert.equal(at("A positive amount is required for a yes"), "amount");
  assert.equal(at("The amount must be a whole number of lb"), "amount");
  assert.equal(at("The order does not accept grade Z"), "grade");
  assert.equal(at("Record whether they can supply"), "yes");
  assert.equal(at("This ask was already answered"), undefined, "no field: shown as the form's result, never lost");
  assert.notEqual(at("Answer quantities must be nonnegative whole numbers"), "value");
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /<form action=\{supplyReplyAction\} className="form" noValidate>/);
  assert.match(orders, /keep: "supply"/.test(source("app/actions.ts")) ? /kept=\{name => typed\("supply", name\)\}/ : /never/);
  for (const field of FORM_FIELDS.reply.filter(f => ["amount", "grade", "yes", "channel", "text", "quote"].includes(f))) assert.match(orders, new RegExp(`name="${field}"`), field);
});

test("Review: a case-contents error focuses the pack input itself, not the wrapper", () => {
  assert.equal(fieldOf(new Error("Case contents must be more than zero."), "reply", { filled: ["operation", "pack"] }), "value-pack");
  assert.equal(fieldOf(new Error("Case contents must be g, kg, lb or each"), "reply", { filled: ["pack"] }), "value-pack");
  assert.equal(fieldOf(new Error("Case contents must be more than zero."), "reply", { filled: [] }), "value", "one chosen detail keeps its one Value box");
  assert.match(source("app/actions.ts"), /filled: filledDetails\(f\)/);
});

// ---- The name is saved only on success ----
test("a typed name is remembered only after the action worked; a refusal leaves the remembered name alone", async () => {
  const saved: string[] = [];
  const remember = async (n: string) => { saved.push(n); };
  await assert.rejects(runAs("Ana", undefined, remember, async () => { throw new Error("refused"); }), /refused/);
  assert.deepEqual(saved, [], "a refused action does not change the name");
  await assert.rejects(runAs("Ana", "Bo", remember, async () => { throw new Error("refused"); }), /refused/);
  assert.deepEqual(saved, []);
  await assert.rejects(runAs("​", "Bo", remember, async () => "no"), (e: unknown) => e instanceof FieldError && e.field === "who");
  await assert.rejects(runAs("", undefined, remember, async () => "no"), (e: unknown) => e instanceof FieldError && e.message === NAME_NEEDED);
  assert.deepEqual(saved, []);
  assert.equal(await runAs("Ana", undefined, remember, async who => `done by ${who}`), "done by Ana");
  assert.deepEqual(saved, ["Ana"]);
  assert.equal(await runAs("", "Bo", remember, async who => who), "Bo", "no typed name: the remembered one acts and nothing is rewritten");
  assert.equal(await runAs("Bo", "Bo", remember, async who => who), "Bo");
  assert.deepEqual(saved, ["Ana"]);
});

// ---- Orders: after a notice or offer ----
async function shortOrder() {
  let w = await seedWorkbench(readings(), NOW);
  const tomato = w.items.find(i => i.source.id === "msg-tomato")!;
  w = approve(w, tomato.id, ME, preview(w, tomato.id).reviewHash!, NOW);
  return { w, order: shortages(w.ledger)[0].orderId };
}
const startNotice = (w: Workbench, order: string) => {
  const o = options(w.ledger, order, CONTACTS).find(x => x.kind === "notify-short")!, facts = factsFor(w, order, o, NAMES);
  return startResolution(w, order, o, CONTACTS, facts, templateDraft(facts, products(w)), ME, NOW);
};

test("Tell: once the buyer is told about the whole shortfall the Next step has nothing more to send", async () => {
  const { w, order } = await shortOrder();
  assert.equal(toldBuyer(w, order), undefined);
  const drafted = startNotice(w, order);
  assert.equal(toldBuyer(drafted, order), undefined, "a draft has told no one");
  assert.equal(draftWaiting(drafted, order)?.kind, "notify-short");
  const rid = drafted.resolutions.at(-1)!.id, sent = sendMessage(drafted, rid, CONTACTS, ME, NOW);
  const told = toldBuyer(sent, order) as Resolution;
  assert.equal(told.option.kind, "notify-short");
  assert.equal(told.facts.amount, shortages(sent.ledger)[0].short);
  assert.equal(draftWaiting(sent, order), undefined, "sent: the draft's Send is gone");
  const page = source("app/orders/page.tsx");
  assert.match(page, /Told \{buyer\(o\.buyerId\)\} they'll be short \{weight\(told\.facts\.amount, told\.option\.unit\)\}/);
  assert.match(page, /visible = offered\.filter\(x => !\(told && x\.opt\.kind === "notify-short"\)\)/, "no Tell button on the Next step, the alternatives or Other options");
  assert.match(source("app/actions.ts"), /if \(o\.kind === "notify-short" && toldBuyer\(w, order\)\) throw/, "a second notice is refused by the server too");
});

test("Only one Send shows at a time: a draft in Messages replaces the Next step's Send with a link to it", () => {
  const page = source("app/orders/page.tsx");
  assert.match(page, /<b>Draft ready below<\/b>/);
  assert.match(page, /href=\{`#\$\{draft\.id\}`\}>Go to the draft/);
  assert.match(page, /picked = !waiting\.length && !draft && pick/);
  // A draft of any option hides the Next step's own Send and its alternatives (they send in one tap too).
  assert.match(page, /const others = visible\.filter\(x => x !== picked\)/);
  assert.match(page, /const alts = picked \?/);
});

test("accessible names: no stray colon before the sr-only part of a button or label", () => {
  const orders = source("app/orders/page.tsx");
  assert.doesNotMatch(orders, /sr-only">:/);
  assert.doesNotMatch(orders, /const more = [^\n]*`: /, "the alternative buttons no longer say \": …\" after their label");
  assert.match(orders, /Send<span className="sr-only"> \(\{line\}\)<\/span>/);
});

// ---- Task 5 path ----
test("Task 5: after an ask is sent Log their call is open, the call lands on Review for that reply, and Orders keeps one link to it", () => {
  const orders = source("app/orders/page.tsx"), actions = source("app/actions.ts");
  assert.match(orders, /<details open>\s*<summary>Log their call/);
  assert.match(actions, /requestedCallAction[\s\S]*?w => w\.resolutions\.find\(r => r\.id === id\)\?\.linkedItemId/);
  assert.match(actions, /redirect\(`\/review\?\$\{new URLSearchParams\(\{ item: landed/);
  assert.doesNotMatch(orders, /Open their reply in Review updates|See their reply<\/a><\/p>|Review the reply<\/a><\/p>/);
  // The thread links to a reply only once it has been reviewed, when the Next step's button is gone.
  assert.match(orders, /reviewed=\{\["approved", "dismissed"\]/);
  assert.match(orders, /d\.note && reviewed &&/);
});

// ---- Save and approve ----
const hand = (w: Workbench, id: string): HandReading => {
  const g = suggestReading(w, id), text = w.items.find(i => i.id === id)!.source.text;
  return { operation: g.operation!, lotId: g.lotId!, quantity: g.quantity!, grade: g.grade!, deliveryOn: g.deliveryOn!, quote: numberSpan(text, String(g.quantity!.amount)) };
};
async function lateDay() {
  let { w } = await shortOrder();
  w = confirmPlan(w, ME, NOW, { shipShort: true });
  w = receive(w, LATE.source, LATER);
  return { w, id: w.items.at(-1)!.id };
}

test("Save and approve: the hand reading and the approval in one step, against the review hash of the state it produced", async () => {
  const { w, id } = await lateDay();
  const reading = hand(w, id), before = structuredClone(w);
  const done = readByHandAndApprove(w, id, reading, ME, LATER);
  assert.deepEqual(w, before, "the input is unchanged");
  assert.equal(done.approved, true);
  assert.equal(done.next.items.find(i => i.id === id)!.state, "approved");
  assert.deepEqual(done.next.items.find(i => i.id === id)!.decisions.slice(-2).map(d => d.kind), ["corrected", "approved"]);
  assert.ok(conflicts(done.next.ledger).length > 0, "the late drop leaves a cut to settle");
  // Equal to saving by hand and approving by hand.
  const manual = readByHand(w, id, reading, ME, LATER), approved = approve(manual, id, ME, preview(manual, id).reviewHash!, LATER);
  assert.deepEqual(done.next.ledger.events.map(e => e.lotAfter), approved.ledger.events.map(e => e.lotAfter));
  // The result names the change and who is short.
  const text = approvalResult(done.next, id, shortMap(w)).text;
  assert.match(text, /Tomato from Birch Hollow Gardens: 80 lb → 70 lb/);
});

test("Save and approve: with something left open only the reading is kept, and a hash from another state is never used", async () => {
  const { w, id } = await lateDay();
  const bad = { ...hand(w, id), quantity: { amount: 2, unit: "case" as const } };
  const r = readByHandAndApprove(w, id, bad, ME, LATER);
  assert.equal(r.approved, false);
  assert.notEqual(r.next.items.find(i => i.id === id)!.state, "approved");
  assert.ok(r.next.items.find(i => i.id === id)!.proposal, "the reading was saved");
  assert.throws(() => readByHandAndApprove(w, id, { ...hand(w, id), quote: "words that are not in the message" }, ME, LATER), /Literal source evidence/);
});

test("Save and approve is the primary button of the hand form when every value is filled, and Save these details otherwise", () => {
  const review = source("app/review/page.tsx"), actions = source("app/actions.ts");
  assert.match(review, /complete \? "Save and approve" : "Save these details"/);
  assert.match(review, /\{\.\.\.\(complete \? \{ name: "andApprove", value: "1" \} : \{\}\)\} className="primary"/);
  assert.match(review, /const complete = !!\(/);
  assert.match(actions, /readByHandAndApprove\(w, i, reading, who, now\(\)\)/);
  assert.doesNotMatch(actions.slice(actions.indexOf("export async function readByHandAction"), actions.indexOf("export async function confirmLotAction")), /rebase/, "no rebase");
});

test("Apply and approve and Save and approve results name the change and every buyer now covered or short", async () => {
  const w0 = await seedWorkbench(readings(), NOW), before = shortMap(w0);
  const tomato = w0.items.find(i => i.source.id === "msg-tomato")!;
  const w = approve(w0, tomato.id, ME, preview(w0, tomato.id).reviewHash!, NOW);
  assert.match(approvalResult(w, tomato.id, before).text, /: 120 lb → 60 lb \(down 60 lb\)\. .* is now 60 lb short\./);
  // Short before and covered after: named as covered.
  const stillShort = new Set(shortages(w.ledger).map(g => g.orderId)), ok = w.ledger.snapshot.orders.find(o => !stillShort.has(o.id))!;
  assert.match(approvalResult(w, tomato.id, new Map([[ok.id, 10]])).text, new RegExp(`${BUYERS[ok.buyerId]} is now covered\\.`));
  const actions = source("app/actions.ts");
  assert.match(actions, /approvedNow \? \{ \.\.\.approved\(w, item, before\), on: "approve" \}/);
});

// ---- Wording ----
test("Done today lists a noted forecast as Noted, not Approved", async () => {
  const w = await seedWorkbench(readings(), NOW);
  const i = { ...w.items[0], state: "approved" } as Parameters<typeof status>[0];
  assert.equal(status(i, undefined).label, "Approved");
  assert.equal(status(i, undefined, true).label, "Noted");
  assert.match(source("app/review/page.tsx"), /effect === "forecast"/);
  assert.match(source("app/review/page.tsx"), /noted=\{isNoted\(w, i\)\}/);
});

test("copy: Needs your answer only with an open question, the preview sentence, and the other wording changes", () => {
  const review = source("app/review/page.tsx");
  assert.doesNotMatch(review, /Waiting on your answer/);
  assert.match(review, /<p className="to">Enter the details below<\/p>/);
  assert.match(review, /"Needs your answer"/);
  assert.match(review, /The change will show here once these answers are applied\./);
  assert.match(review, /"Check what they said\."/);
  assert.equal(ORDER_STATUS.resolving.label, "Asked, waiting for the grower");
  assert.deepEqual(promiseText({ promised: 0, ordered: 10, unit: "lb" }, 5), ["Not promised to the buyer yet"]);
  assert.doesNotMatch(source("app/lib/format.ts"), /but it isn't promised/);
  assert.ok(LATE.source.text.includes("not 80") && !LATE.source.text.includes("110"), "the late message agrees with the lot shown (80 lb)");
  assert.equal((LATE.source.text.match(/\d+/g) ?? []).join(","), "70,80");
});

test("Orders puts its demo control in a closed Demo tools fold", () => {
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /<details className="demo-tools" open=\{demo\.some/);
  assert.equal((orders.match(/scriptedRequestReplyAction\}>/g) ?? []).length, 1);
});
