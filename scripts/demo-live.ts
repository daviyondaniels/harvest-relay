import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scenario } from "../evaluation/scenario.ts";
import { applyAnswers, type Answer } from "../src/answers.ts";
import { PROMPT_VERSION, createBudget, interpretReply, interpretSource, metaTransport } from "../src/interpret.ts";
import { proposeAllocations, verifyPlan } from "../src/planner.ts";
import { commitUpdate, createLedger, reviewUpdate, type Source } from "../src/updates.ts";

// Paid end-to-end demo, e.g.
//   node --env-file="$HOME/.config/harvest-relay/meta.env" scripts/demo-live.ts --model muse-spark-1.3 --max-calls 1
// The model reads the grower's first message and must leave open what it does not settle.
// The grower's reply is scripted. With --reply-by coordinator (default, 1 call) the
// coordinator's quoted answers are scripted too; with --reply-by model (2 calls) the model
// proposes them. Either way they pass through applyAnswers, then review and approval.
const { values } = parseArgs({ options: { model: { type: "string" }, "max-calls": { type: "string" }, "reply-by": { type: "string", default: "coordinator" } } });
const calls = { coordinator: "1", model: "2" }[values["reply-by"]];
if (!calls) throw new Error("--reply-by must be coordinator or model");
if (!values.model || values["max-calls"] !== calls) throw new Error(`Pass --model and --max-calls ${calls}`);
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("MODEL_API_KEY not loaded; use node --env-file");

const message: Source = { id: "demo-msg", revision: 1, growerId: "grower-b", text: "We've got 3 cases of standard zucchini ready for Friday." };
const reply: Source = { id: "demo-reply", revision: 1, growerId: "grower-b", text: "That's the new total, and each case is 5 kg net." };
// What the coordinator takes from the reply: the quoted words and the value they settle.
const coordinatorAnswers: Answer[] = [
  { field: "operation", quote: "That's the new total", value: "replace-total" },
  { field: "pack", quote: "each case is 5 kg net", value: { amount: 5, unit: "kg" } }
];

const steps: Record<string, unknown> = {};
function finish(outcome: string, code = 0): never {
  const at = new Date().toISOString();
  const report = { label: "Live end-to-end demo on authored synthetic messages. One run; not an evaluation.", model: values.model, promptVersion: PROMPT_VERSION, replyBy: values["reply-by"], at, outcome, steps };
  mkdirSync("output", { recursive: true });
  const file = `output/demo-live-${at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`Saved ${file}`);
  process.exit(code);
}

let ledger = createLedger(scenario());
const before = proposeAllocations(ledger.snapshot); verifyPlan(ledger.snapshot, before);
steps.planBefore = before;

const budget = createBudget(Number(calls)), live = { enabled: true, transport: metaTransport(key), model: values.model, budget, reasoningEffort: "minimal" as const, maxCompletionTokens: 2000 };
const r = await interpretSource(ledger, message, live);
if (r.status !== "proposed") { steps.interpretation = r; finish(`Model produced no proposal: ${r.reason}`, 1); }
steps.interpretation = { message: message.text, interpretation: r.proposal.interpretation, modelQuestions: r.proposal.clarifications, discarded: r.discarded, usage: r.usage };

// 1. Review blocks the update while anything is open.
const first = reviewUpdate(ledger, r.proposal);
let blocked = "";
try { commitUpdate(ledger, r.proposal, { reviewer: "demo-coordinator", reviewHash: first.hash }); } catch (e) { blocked = e instanceof Error ? e.message : String(e); }
steps.firstReview = { questions: first.questions, commitAttempt: blocked ? `refused: ${blocked}` : "COMMITTED WITHOUT ANSWERS" };
if (!blocked) finish("Unexpected: an update with open questions committed", 1);

// 2. The grower replies; answers must quote the reply and may only settle open fields.
let answered;
if (values["reply-by"] === "model") {
  const m = await interpretReply(ledger, r.proposal, reply, live);
  steps.replyReading = m.status === "proposed" ? { applied: m.applied, corrections: m.corrections, unanswered: m.unanswered, usage: m.usage } : m;
  if (m.status !== "proposed") finish(`Model produced no reply reading: ${m.reason}`, 1);
  answered = m;
} else answered = applyAnswers(ledger, r.proposal, reply, coordinatorAnswers);
// This scripted reply only answers; a correction here would mean the model misread it.
if (answered.corrections.length || answered.unanswered.length) {
  steps.secondReview = { reply: reply.text, corrections: answered.corrections, unanswered: answered.unanswered };
  finish(`Unexpected reading of the reply: corrected ${answered.corrections.map(c => c.field).join(", ") || "nothing"}; unanswered ${answered.unanswered.join(", ") || "nothing"}. Stopping before approval.`, 1);
}

// 3. Re-review, approve the reviewed hash, and replan.
const second = reviewUpdate(ledger, answered.proposal);
steps.secondReview = { reply: reply.text, answers: answered.proposal.clarifications.map(c => ({ field: c.field, question: c.question, quote: c.answer && reply.text.slice(c.answer.span.start, c.answer.span.end) })), questions: second.questions, change: second.change };
if (second.questions.length) finish("Questions remain after the reply", 1);
ledger = commitUpdate(ledger, answered.proposal, { reviewer: "demo-coordinator", reviewHash: second.hash });
const after = proposeAllocations(ledger.snapshot); verifyPlan(ledger.snapshot, after);
steps.committed = { version: ledger.version, lot: ledger.snapshot.lots.find(l => l.id === answered.proposal.interpretation.lotId), event: ledger.events.at(-1)?.id };
steps.planAfter = after;
finish("Committed after clarification; plan verified");
