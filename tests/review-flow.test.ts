import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { propose, scenario, surplus } from "../evaluation/scenario.ts";
import { normalize } from "../src/quantity.ts";
import { createLedger } from "../src/updates.ts";
import { approve, createWorkbench, interpret, preview, previewAnswers, receive, reply, replyAndApprove } from "../src/workbench.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ME = "Hub coordinator", T = (m: number) => new Date(Date.UTC(2026, 9, 28, 9, m)).toISOString();
const SRC = { id: "note-b", revision: 1, growerId: "grower-b", text: "We have four cases of standard zucchini for Friday now." };
const REPLY = { id: "note-b-reply", revision: 1, growerId: "grower-b", text: "Confirmed net contents: 5 kg per case; this is the new lot total." };
const PACK = { field: "pack" as const, quote: "5 kg per case", value: { amount: 5, unit: "kg" } };
const KIND = { field: "operation" as const, quote: "this is the new lot total", value: "replace-total" };
function twoOpen() {
  let w = createWorkbench(createLedger(scenario()));
  w = receive(w, SRC, T(1));
  const p = surplus(w.ledger);
  return interpret(w, "item-1", p, "test reading", ME, T(2));
}

test("Ease task 11: one reply answers every open question, and Apply and approve approves the result in the same step", () => {
  const w = twoOpen();
  assert.deepEqual(preview(w, "item-1").questions.map(q => q.field).sort(), ["operation", "pack"], "two details are open");
  const before = structuredClone(w);
  const done = replyAndApprove(w, "item-1", REPLY, [KIND, PACK], [], ME, T(3), previewAnswers(w, "item-1", REPLY, [KIND, PACK], T(3))!.reviewHash);
  assert.equal(done.approved, true);
  const item = done.next.items[0];
  assert.deepEqual([item.state, item.replies.length], ["approved", 1]);
  assert.deepEqual(item.decisions.slice(-2).map(d => d.kind), ["replied", "approved"]);
  assert.equal(item.decisions.at(-1)!.reviewHash, preview(replyOnly(w), "item-1").reviewHash, "approved against the hash the answered state previews");
  assert.equal(normalize(done.next.ledger.snapshot.lots.find(l => l.id === "lot-d")!.quantity).amount, 20000);
  assert.deepEqual(w, before, "the input is untouched");
});
const replyOnly = (w: ReturnType<typeof twoOpen>) => reply(w, "item-1", REPLY, [KIND, PACK], [], ME, T(3));

test("Ease task 11: answers that leave a question open are kept without approving", () => {
  const w = twoOpen(), r = replyAndApprove(w, "item-1", REPLY, [PACK], [], ME, T(3), "any-hash");
  assert.equal(r.approved, false);
  assert.deepEqual([r.next.items[0].state, r.next.items[0].replies.length], ["open", 1]);
  assert.deepEqual(preview(r.next, "item-1").questions.map(q => q.field), ["operation"]);
  assert.equal(r.next.ledger.version, w.ledger.version, "no supply change");
  // A refused answer changes nothing at all.
  const before = structuredClone(w);
  assert.throws(() => replyAndApprove(w, "item-1", REPLY, [KIND, { ...PACK, quote: "not in the reply" }], [], ME, T(3), "x"), /Literal source evidence/);
  assert.deepEqual(w, before);
});

test("Ease task 11: the reply form has one value per open detail and the button says Apply and approve once all are given", () => {
  const review = source("app/review/page.tsx"), fields = source("app/value-fields.tsx"), actions = source("app/actions.ts");
  assert.match(review, /<AnswerFields on="reply"/);
  assert.match(fields, /"Apply and approve" : "Apply answers"/);
  assert.match(fields, /name: "andApprove", value: "1"/);
  assert.match(actions, /replyAndApprove\(w, i, source, answers\(f, "reply", text\)/);
  assert.match(actions, /Answers applied\. One more detail needs an answer\./);
  assert.match(actions, /FIELDS\.filter\(x => str\(f, `value-\$\{x\}`\)\)/);
});

test("Ease task 11: the hand form refuses 0 and shows the limit beside Amount", () => {
  const actions = source("app/actions.ts");
  assert.match(actions, /Number\(amount\) <= 0\) throw new FieldError\("Enter an amount above zero\.", "amount"\)/);
  assert.match(source("app/lib/errors.ts"), /whole numbers\|more than this hub handles\|above zero/);
});

test("Ease task 11: wording", async () => {
  const review = source("app/review/page.tsx"), orders = source("app/orders/page.tsx"), { status, promiseText } = await import("../app/lib/format.ts");
  assert.ok(review.includes("Save these details") && !review.includes("Save the reading <"));
  assert.ok(review.includes("Not checked yet") && !review.includes("Not read yet") && !review.includes("Waiting on answers"));
  assert.equal(status({ state: "open" } as never, undefined).label, "Not checked yet");
  assert.ok(orders.includes('"Shortage notice"') && !orders.includes("Notice to buyer"));
  assert.deepEqual(promiseText({ promised: 0, ordered: 10, unit: "lb" }, 5), ["Not promised to the buyer yet"]);
});

test("Ease task 11: Orders shows a sent message's state instead of the same suggestion, and the next suggestion only when nothing waits", () => {
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /Asked \$\{r\.facts\.to\.name\} for \$\{amt\}\. Waiting on their reply\./);
  assert.match(orders, /picked = !waiting\.length && !draft && pick/);
  assert.match(orders, /<AltButton /);
  assert.match(orders, /`Offer \$\{opt\.product\}` : `Tell \$\{buyerName\}`/);
  assert.doesNotMatch(orders, /Open their reply in Review updates/, "one link to the reply on Orders, not three");
  assert.match(orders, /, on file/);
});

// The edited-value check: Save/Apply and approve approves only the values the preview was worked out from.
test("Edited-value check: unedited values approve in one step, edited values are saved without approving, and the second press approves", () => {
  const w = twoOpen(), shown = previewAnswers(w, "item-1", REPLY, [KIND, PACK], T(3))!.reviewHash!;
  const same = replyAndApprove(w, "item-1", REPLY, [KIND, PACK], [], ME, T(3), shown);
  assert.deepEqual([same.approved, same.changed], [true, false], "the previewed values approve");
  // A different operation reaches a different (still complete) state: saved, not approved.
  const other = { ...KIND, value: "add-quantity" };
  const edited = replyAndApprove(w, "item-1", REPLY, [other, PACK], [], ME, T(3), shown);
  assert.deepEqual([edited.approved, edited.changed], [false, true]);
  assert.equal(edited.next.items[0].state, "open", "saved, not approved");
  assert.equal(edited.next.items[0].replies.length, 1);
  assert.equal(edited.next.ledger.version, w.ledger.version, "no supply change");
  // The second press (the ordinary Approve form) carries the hash of the new preview and approves against it.
  const second = preview(edited.next, "item-1").reviewHash!;
  assert.notEqual(second, shown);
  assert.equal(approve(edited.next, "item-1", ME, second, T(4)).items[0].state, "approved");
  // No preview was shown, so there is no hash: saved, not approved.
  const none = replyAndApprove(w, "item-1", REPLY, [KIND, PACK], [], ME, T(3));
  assert.deepEqual([none.approved, none.changed], [false, true]);
});

test("Task 20 fix: a fresh reply's preview hash can never match what the action produces, so one-step approval is offered only for a recorded reply", () => {
  const w = twoOpen(), at = T(3);
  // What the page can render before the coordinator has typed the reply: a stand-in source.
  const stand = { ...REPLY, id: "item-1-preview" };
  const rendered = previewAnswers(w, "item-1", stand, [KIND, PACK], at)!.reviewHash!;
  // What the action produces: the typed reply as its own source.
  const real = replyAndApprove(w, "item-1", REPLY, [KIND, PACK], [], ME, at, rendered);
  assert.equal(real.approved, false, "the stand-in's hash is not the real state's hash");
  assert.equal(real.changed, true, "the reply is saved and the result is shown for one more press");
  // The page therefore passes shown only for a recorded reply.
  assert.match(readFileSync(new URL("../app/review/page.tsx", import.meta.url), "utf8"), /shown=\{recordedReply \? answerPreview\?\.reviewHash : undefined\}/);
});
