import test from "node:test";
import assert from "node:assert/strict";
import { scenario } from "../evaluation/scenario.ts";
import { applyAnswers } from "../src/answers.ts";
import { canonicalGrade } from "../src/grades.ts";
import { createBudget, interpretSource } from "../src/interpret.ts";
import { createLedger } from "../src/updates.ts";

test("canonicalGrade maps listed spellings and returns anything else unchanged", () => {
  const aliases = { std: "standard", "2nds": "seconds" };
  assert.equal(canonicalGrade("std", aliases), "standard");
  assert.equal(canonicalGrade(" STD. ", aliases), "standard");
  assert.equal(canonicalGrade("2nds", aliases), "seconds");
  assert.equal(canonicalGrade("processing", aliases), "processing", "an unlisted grade still reaches review as stated");
  assert.equal(canonicalGrade("standardish", aliases), "standardish", "no partial or fuzzy matching");
  assert.equal(canonicalGrade("constructor", aliases), "constructor", "only the table's own keys count");
});

test("a listed grade spelling from the model or a reply is not a grade conflict; an unlisted one still is", async () => {
  const l = createLedger(scenario()), text = "Only 30 kg of std tomatoes for Friday, replacing the earlier 60 kg total.";
  const output = (grade: string) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    operation: "replace-total", lotId: "lot-a", quantity: { amount: 30, unit: "kg", pack: null }, grade, deliveryOn: "2026-10-30", correctsEventId: null,
    evidence: [{ field: "operation", quote: "replacing the earlier 60 kg total" }, { field: "lot", quote: "tomatoes" }, { field: "quantity", quote: "Only 30 kg" }, { field: "grade", quote: "std" }, { field: "date", quote: "Friday" }],
    unresolved: [], questions: [] }) } }] });
  const read = (grade: string) => interpretSource(l, { id: "msg-g", revision: 1, growerId: "grower-a", text }, { enabled: true, model: "muse-spark-1.3", budget: createBudget(1), transport: async () => output(grade) });
  const listed = await read("std"), unlisted = await read("stdd");
  assert.ok(listed.status === "proposed" && unlisted.status === "proposed");
  assert.equal(listed.proposal.interpretation.grade, "standard");
  assert.deepEqual(listed.questions, [], "std reads as the lot's grade");
  assert.ok(unlisted.questions.some(q => q.field === "grade"), "an unlisted spelling still raises the grade question");

  const p = { ...listed.proposal, interpretation: { ...listed.proposal.interpretation, grade: undefined } };
  const r = applyAnswers(l, p, { id: "reply-g", revision: 1, growerId: "grower-a", text: "Std." }, [{ field: "grade", quote: "Std.", value: "Std." }]);
  assert.equal(r.proposal.interpretation.grade, "standard");
  assert.deepEqual(r.unanswered, []);
});
