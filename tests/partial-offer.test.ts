import test from "node:test";
import assert from "node:assert/strict";
import { template, checkDraft } from "../src/messages.ts";
import { purpose, DRAFT_PROMPT_VERSION } from "../src/draft.ts";
import { factsFor } from "../src/resolve.ts";
import { morning, pick, zucchini, names, short } from "./story.ts";

test("a partial substitute offer never labels its offered amount as the whole shortage", () => {
  const w = morning(), option = pick(w, zucchini), facts = factsFor(w, "order-b", option, names);
  assert.equal(short(w), 60); assert.equal(facts.amount, 40);
  const text = template(facts);
  assert.match(text, /instead of 40 lb of tomato/); assert.doesNotMatch(text, /short/i);
  assert.equal(checkDraft(text, facts, ["tomato", "cucumber", "zucchini"]).ok, true);
  const falseGap = "Hi Riverbend School Kitchen, we're 40 lb short on tomato for Friday. Would zucchini work for that 40 lb? Reply yes or no.";
  const check = checkDraft(falseGap, facts, ["tomato", "cucumber", "zucchini"]);
  assert.equal(check.ok, false); assert.ok(check.problems.some(x => x.includes("does not establish the full shortage")));
  assert.match(purpose(facts), /do not state the full shortage/);
  assert.equal(DRAFT_PROMPT_VERSION, "draft-v3", "old draft-v2 recordings must not bypass the revised purpose");
});
