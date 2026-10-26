import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreCase, summarize, validateCase, type Case } from "../evaluation/score.ts";
import type { InterpretResult } from "../src/interpret.ts";
import type { Interpretation } from "../src/updates.ts";

// Offline checks of the evaluation scorer; no model calls.
const bare: Case = { id: "bare", category: "bare we-have", growerId: "grower-b", text: "We have four cases of standard zucchini for Friday now.",
  label: { operation: "unresolved", lotId: "lot-d", quantity: { amount: 4, unit: "case" }, pack: null, grade: "standard", deliveryOn: "2026-10-30", correctsEventId: null, ask: ["operation", "pack"] } };
const proposed = (i: Partial<Interpretation>, extra: { questions?: number; discarded?: string[]; asked?: string[] } = {}): InterpretResult => ({
  status: "proposed", discarded: (extra.discarded ?? []) as never, questions: Array.from({ length: extra.questions ?? 0 }, () => ({ field: "pack", question: "q" })),
  proposal: { id: "p", baseVersion: 0, baseHash: "h", source: { id: "s", revision: 1, growerId: "grower-b", text: bare.text }, clarifications: (extra.asked ?? []).map(f => ({ field: f as never, question: "?" })),
    interpretation: { operation: "unresolved", unresolved: [], spans: [{ start: 0, end: 2 }], ...i } } });

test("scores the live v1 miss: a confident total and silent pack are graded wrong and missed", () => {
  // Shape of the first live output for this message: new total, no questions; review then asked for case contents.
  const s = scoreCase(bare, proposed({ operation: "replace-total", lotId: "lot-d", quantity: { amount: 4, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30" }, { questions: 1 }));
  assert.deepEqual(s.grades, { operation: "wrong", lot: "correct", quantity: "correct", pack: "missed", grade: "correct", date: "correct", "correction-target": "n/a" });
  assert.equal(s.unsafe, false, "review still raised a question, so it is not commit-ready");
});

test("credits model-raised questions and dropped unsupported values, and flags unsafe wrong values", () => {
  const asked = scoreCase(bare, proposed({ lotId: "lot-d", quantity: { amount: 4, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30", unresolved: ["operation", "pack"] }, { asked: ["operation", "pack"], questions: 2 }));
  assert.deepEqual([asked.grades.operation, asked.grades.pack], ["asked", "asked"]);
  const caught = scoreCase(bare, proposed({ lotId: "lot-d", quantity: { amount: 4, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30" }, { discarded: ["operation", "pack"], questions: 2 }));
  assert.deepEqual([caught.grades.operation, caught.grades.pack], ["caught", "caught"]);
  const clear: Case = { ...bare, id: "clear", label: { ...bare.label, operation: "replace-total", quantity: { amount: 20, unit: "kg" }, ask: [] } };
  const wrong = scoreCase(clear, proposed({ operation: "replace-total", lotId: "lot-d", quantity: { amount: 25, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30" }));
  assert.deepEqual([wrong.grades.quantity, wrong.unsafe], ["wrong", true]);
  const grams = scoreCase(clear, proposed({ operation: "replace-total", lotId: "lot-d", quantity: { amount: 20000, unit: "g" }, grade: "standard", deliveryOn: "2026-10-30" }));
  assert.equal(grams.grades.quantity, "correct", "equal after normalization");
  const timid = scoreCase(clear, proposed({ lotId: "lot-d", quantity: { amount: 20, unit: "kg" }, grade: "standard", unresolved: ["operation"] }, { questions: 2 }));
  assert.deepEqual([timid.grades.operation, timid.grades.date], ["over-asked", "omitted"]);
  const none = scoreCase(clear, { status: "invalid", reason: "Output is not JSON" });
  assert.deepEqual(summarize([asked, caught, wrong, grams, timid, none]),
    { cases: 6, proposed: 5, noProposal: 1, unsafe: 1, wrong: 1, correct: 20, asked: 2, caught: 2, missed: 0, overAsked: 1, omitted: 1 });
});

test("labels must be internally consistent, and the template validates", () => {
  assert.throws(() => validateCase({ ...bare, label: { ...bare.label, ask: ["pack"] } }), /unresolved operation/);
  assert.throws(() => validateCase({ ...bare, label: { ...bare.label, ask: ["operation", "lot"] } }), /both labelled and asked/);
  assert.throws(() => validateCase({ ...bare, label: { ...bare.label, ask: ["operation", "colour" as never] } }), /Invalid label/);
  const template = JSON.parse(readFileSync(new URL("../evaluation/heldout.template.json", import.meta.url), "utf8")) as { cases: Case[] };
  template.cases.forEach(validateCase);
});
