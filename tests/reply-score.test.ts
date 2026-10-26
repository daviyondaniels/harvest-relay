import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readingProposal, replySource, scoreReply, summarizeReplies, validateReplyCase, type ReplyCase } from "../evaluation/reply-score.ts";
import { scenario } from "../evaluation/scenario.ts";
import { applyAnswers } from "../src/answers.ts";
import type { ReplyResult } from "../src/interpret.ts";
import { createLedger } from "../src/updates.ts";

// Offline checks of the reply scorer; no model calls.
const l = createLedger(scenario());
const base: ReplyCase = { id: "c1", category: "clear answer", growerId: "grower-b", message: "Got 5 cases of standard zucchini for Friday.",
  reading: { operation: "unresolved", lotId: "lot-d", quantity: { amount: 5, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30" },
  reply: "That's all we have now, 4 kg a case.", label: { answers: { operation: "replace-total", pack: { amount: 4, unit: "kg" } }, corrections: {}, open: [] } };
const result = (c: ReplyCase, answers: Parameters<typeof applyAnswers>[3]): ReplyResult => ({ status: "proposed", questions: [], ...applyAnswers(l, readingProposal(l, c), replySource(c), answers) });

test("grades answers, corrections and fields that must stay open", () => {
  const good = scoreReply(base, result(base, [{ field: "operation", quote: "That's all we have now", value: "replace-total" }, { field: "pack", quote: "4 kg a case", value: { amount: 4, unit: "kg" } }]));
  assert.deepEqual([good.grades.operation, good.grades.pack, good.grades.quantity, good.unsafe], ["correct", "correct", "n/a", false]);
  const wrong = scoreReply(base, result(base, [{ field: "operation", quote: "That's all we have now", value: "add-quantity" }]));
  assert.deepEqual([wrong.grades.operation, wrong.grades.pack, wrong.unsafe], ["wrong", "missed", true]);
  const vague: ReplyCase = { ...base, id: "c2", reply: "yeah should be fine", label: { answers: {}, corrections: {}, open: ["operation", "pack"] } };
  const guessed = scoreReply(vague, result(vague, [{ field: "operation", quote: "should be fine", value: "replace-total" }]));
  assert.deepEqual([guessed.grades.operation, guessed.grades.pack, guessed.unsafe], ["over-answered", "kept-open", true]);
  const fix: ReplyCase = { ...base, id: "c3", reply: "Sorry, 4 cases not 5. That's all we have now, 4 kg a case.", label: { answers: base.label.answers, corrections: { quantity: { amount: 4, unit: "case" } }, open: [] } };
  const answersOnly = [{ field: "operation" as const, quote: "That's all we have now", value: "replace-total" }, { field: "pack" as const, quote: "4 kg a case", value: { amount: 4, unit: "kg" } }];
  assert.equal(scoreReply(fix, result(fix, [...answersOnly, { field: "quantity", quote: "4 cases not 5", value: { amount: 4, unit: "case" } }])).grades.quantity, "correct");
  assert.equal(scoreReply(fix, result(fix, answersOnly)).grades.quantity, "missed");
  const spurious = scoreReply(base, result(base, [...answersOnly, { field: "grade", quote: "all we have", value: "processing" }]));
  assert.deepEqual([spurious.grades.grade, spurious.unsafe], ["spurious", true]);
  assert.deepEqual(summarizeReplies([good, wrong, guessed, scoreReply(base, { status: "invalid", reason: "Output is not JSON" })]),
    { cases: 4, proposed: 3, noProposal: 1, unsafe: 2, correct: 2, wrong: 1, missed: 1, overAnswered: 1, spurious: 0, keptOpen: 1 });
});

test("labels must cover every open field and name corrections only for settled ones, and the template validates", () => {
  assert.throws(() => validateReplyCase(l, { ...base, label: { answers: { operation: "replace-total" }, corrections: {}, open: [] } }), /open field pack/);
  assert.throws(() => validateReplyCase(l, { ...base, label: { ...base.label, open: ["quantity"] } }), /not open in the reading/);
  assert.throws(() => validateReplyCase(l, { ...base, label: { answers: { operation: "replace-total" }, corrections: { pack: { amount: 4, unit: "kg" } }, open: [] } }), /label it as an answer/);
  assert.throws(() => validateReplyCase(l, { ...base, label: { ...base.label, open: ["pack"] } }), /only once/);
  const template = JSON.parse(readFileSync(new URL("../evaluation/replies.template.json", import.meta.url), "utf8")) as { cases: ReplyCase[] };
  for (const c of template.cases) validateReplyCase(l, c);
});
