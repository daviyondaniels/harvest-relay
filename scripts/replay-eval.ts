import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { prepareLedger, scoreCase, summarize, type Case, type Hub } from "../evaluation/score.ts";
import { createBudget, interpretSource, type PromptVersion } from "../src/interpret.ts";

// Replays the model outputs saved by evaluate-live.ts through the current code, with no
// model calls, so a code-side change (validation, grade aliases, review rules) can be
// measured on outputs already paid for. It cannot measure a prompt change. e.g.:
//   node scripts/replay-eval.ts --report output/eval-....json --cases evaluation/heldout-2.local.json
const { values } = parseArgs({ options: { report: { type: "string" }, cases: { type: "string" } } });
if (!values.report || !values.cases) throw new Error("Pass --report and --cases");
type Saved = { caseId: string; prompt: PromptVersion; raw: unknown; score: ReturnType<typeof scoreCase> };
const report = JSON.parse(readFileSync(values.report, "utf8")) as { results: Saved[] };
const caseFile = JSON.parse(readFileSync(values.cases, "utf8")) as { cases: Case[]; hub?: Hub }, hub = caseFile.hub ?? "standard";
const cases = new Map(caseFile.cases.map(c => [c.id, c]));
const scores: Record<string, ReturnType<typeof scoreCase>[]> = {};
for (const x of report.results) {
  const c = cases.get(x.caseId);
  if (!c) throw new Error(`Case ${x.caseId} is not in the case file`);
  if (typeof x.raw !== "string") throw new Error(`${x.caseId} ${x.prompt}: no saved output to replay`);
  const r = await interpretSource(prepareLedger(c, hub), { id: c.id, revision: 1, growerId: c.growerId, text: c.text },
    { enabled: true, model: "replay", budget: createBudget(1), promptVersion: x.prompt, transport: async () => ({ choices: [{ finish_reason: "stop", message: { content: x.raw } }] }) });
  if (r.status !== "proposed") throw new Error(`${x.caseId} ${x.prompt}: replay failed: ${(r as { reason?: string }).reason}`);
  const now = scoreCase(c, r);
  (scores[x.prompt] ??= []).push(now);
  const changed = JSON.stringify([now.grades, now.unsafe]) !== JSON.stringify([x.score.grades, x.score.unsafe]);
  if (changed) console.log(`${x.caseId.padEnd(10)} ${x.prompt}  was ${JSON.stringify(x.score.grades)}\n${"".padEnd(14)}now ${JSON.stringify(now.grades)}`);
}
for (const [p, s] of Object.entries(scores)) console.log(p, JSON.stringify(summarize(s)));
