import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scenario } from "../evaluation/scenario.ts";
import { PROMPT_VERSION, createBudget, interpretSource, metaTransport } from "../src/interpret.ts";
import { proposeAllocations, verifyPlan } from "../src/planner.ts";
import { commitUpdate, createLedger, locate, reviewUpdate, type Field, type Interpretation, type Source, type UpdateProposal } from "../src/updates.ts";

// Paid end-to-end demo: one live call, e.g.
//   node --env-file="$HOME/.config/harvest-relay/meta.env" scripts/demo-live.ts --model muse-spark-1.3 --max-calls 1
// The model reads only the grower's first message and must leave open what it does not
// settle. The grower's reply and the coordinator's resolution are scripted: each answer
// cites a quote from the reply, and the model never sees the reply or resolves anything.
const { values } = parseArgs({ options: { model: { type: "string" }, "max-calls": { type: "string" } } });
if (!values.model || values["max-calls"] !== "1") throw new Error("Pass --model and --max-calls 1");
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("MODEL_API_KEY not loaded; use node --env-file");

const message: Source = { id: "demo-msg", revision: 1, growerId: "grower-b", text: "We've got 3 cases of standard zucchini ready for Friday." };
const reply: Source = { id: "demo-reply", revision: 1, growerId: "grower-b", text: "That's the new total, and each case is 5 kg net." };
// What the coordinator takes from the reply: the quoted words and the value they settle.
const resolutions: Partial<Record<Field, { quote: string; apply: (i: Interpretation) => Interpretation }>> = {
  operation: { quote: "That's the new total", apply: i => ({ ...i, operation: "replace-total" }) },
  pack: { quote: "each case is 5 kg net", apply: i => ({ ...i, quantity: i.quantity && { ...i.quantity, pack: { amount: 5000, unit: "g" } } }) }
};

const steps: Record<string, unknown> = {};
function finish(outcome: string, code = 0): never {
  const at = new Date().toISOString();
  const report = { label: "Live end-to-end demo on authored synthetic messages. One run; not an evaluation.", model: values.model, promptVersion: PROMPT_VERSION, at, outcome, steps };
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

const budget = createBudget(1);
const r = await interpretSource(ledger, message, { enabled: true, transport: metaTransport(key), model: values.model, budget, reasoningEffort: "minimal", maxCompletionTokens: 2000 });
if (r.status !== "proposed") { steps.interpretation = r; finish(`Model produced no proposal: ${r.reason}`, 1); }
steps.interpretation = { message: message.text, interpretation: r.proposal.interpretation, modelQuestions: r.proposal.clarifications, discarded: r.discarded, usage: r.usage };

// 1. Review blocks the update while anything is open.
const first = reviewUpdate(ledger, r.proposal);
let blocked = "";
try { commitUpdate(ledger, r.proposal, { reviewer: "demo-coordinator", reviewHash: first.hash }); } catch (e) { blocked = e instanceof Error ? e.message : String(e); }
steps.firstReview = { questions: first.questions, commitAttempt: blocked ? `refused: ${blocked}` : "COMMITTED WITHOUT ANSWERS" };
if (!blocked) finish("Unexpected: an update with open questions committed", 1);

// 2. The grower replies; the coordinator answers each open field from a quote in the reply.
const open = [...new Set<Field>([...first.questions.map(q => q.field), ...r.proposal.clarifications.map(c => c.field)])];
const unsettled = open.filter(f => !resolutions[f]);
if (unsettled.length) finish(`The scripted reply does not settle: ${unsettled.join(", ")}. Stopping rather than guessing.`, 1);
let interpretation: Interpretation = { ...r.proposal.interpretation, unresolved: [] };
for (const f of open) interpretation = resolutions[f]!.apply(interpretation);
const asked = (f: Field) => r.proposal.clarifications.find(c => c.field === f)?.question ?? first.questions.find(q => q.field === f)!.question;
const answered: UpdateProposal = { ...r.proposal, interpretation,
  clarifications: open.map(f => ({ field: f, question: asked(f), answer: { source: reply, span: locate(reply.text, resolutions[f]!.quote) } })) };

// 3. Re-review, approve the reviewed hash, and replan.
const second = reviewUpdate(ledger, answered);
steps.secondReview = { reply: reply.text, answers: answered.clarifications.map(c => ({ field: c.field, question: c.question, quote: resolutions[c.field]!.quote })), questions: second.questions, change: second.change };
if (second.questions.length) finish("Questions remain after the reply", 1);
ledger = commitUpdate(ledger, answered, { reviewer: "demo-coordinator", reviewHash: second.hash });
const after = proposeAllocations(ledger.snapshot); verifyPlan(ledger.snapshot, after);
steps.committed = { version: ledger.version, lot: ledger.snapshot.lots.find(l => l.id === interpretation.lotId), event: ledger.events.at(-1)?.id };
steps.planAfter = after;
finish("Committed after clarification; plan verified");
