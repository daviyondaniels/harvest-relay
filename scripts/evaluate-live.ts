import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scenario } from "../evaluation/scenario.ts";
import { scoreCase, summarize, validateCase, type Case } from "../evaluation/score.ts";
import { snapshotHash } from "../src/planner.ts";
import { PROMPTS, createBudget, interpretSource, metaTransport, type PromptVersion, type Transport, type Usage } from "../src/interpret.ts";
import { commitUpdate, createLedger, reviewUpdate, type Ledger, type UpdateProposal } from "../src/updates.ts";

// Paid prompt comparison on a labelled case file, e.g.:
//   node --env-file="$HOME/.config/harvest-relay/meta.env" scripts/evaluate-live.ts \
//     --cases evaluation/heldout.local.json --model muse-spark-1.3 --max-calls 40
// Everything is validated before the first call, and it refuses a budget too small to run
// every case under every prompt, so a partial run cannot skew the comparison.
const { values } = parseArgs({ options: {
  cases: { type: "string" }, prompts: { type: "string", default: "v2,v3" }, model: { type: "string" },
  "max-calls": { type: "string" }, effort: { type: "string", default: "minimal" }, "max-tokens": { type: "string", default: "2000" } } });
if (!values.cases || !values.model) throw new Error("Pass --cases and --model");
const raw = readFileSync(values.cases, "utf8");
const cases = (JSON.parse(raw) as { cases: Case[] }).cases;
if (!Array.isArray(cases) || !cases.length || cases.length > 60) throw new Error("Case file needs 1-60 cases");
cases.forEach(validateCase);
if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error("Duplicate case IDs");
if (cases.some(c => c.id.startsWith("example-"))) throw new Error("Template examples are not evaluation cases");
const prompts = values.prompts.split(",") as PromptVersion[];
if (prompts.some(p => !Object.hasOwn(PROMPTS, p))) throw new Error(`Prompts must be from: ${Object.keys(PROMPTS).join(", ")}`);
const maxCalls = Number(values["max-calls"]), needed = cases.length * prompts.length;
if (!Number.isSafeInteger(maxCalls) || maxCalls < needed || maxCalls > 120) throw new Error(`This comparison needs exactly ${needed} calls; pass --max-calls between ${needed} and 120`);

function prepare(c: Case): Ledger {
  let l = createLedger(scenario());
  for (const [n, u] of (c.setup ?? []).entries()) {
    const lot = l.snapshot.lots.find(x => x.id === u.lotId);
    if (!lot) throw new Error(`${c.id}: setup ${n + 1} names unknown lot ${u.lotId}`);
    if (!["replace-total", "add-quantity", "correction"].includes(u.operation)) throw new Error(`${c.id}: setup ${n + 1} operation must be replace-total, add-quantity or correction`);
    if ((u.operation === "correction") !== (typeof u.correctsEventId === "string")) throw new Error(`${c.id}: setup ${n + 1} needs correctsEventId exactly when it is a correction`);
    const id = `${c.id}-setup-${n + 1}`;
    const p: UpdateProposal = { id, baseVersion: l.version, baseHash: snapshotHash(l.snapshot), source: { id, revision: 1, growerId: u.growerId, text: u.text }, clarifications: [],
      interpretation: { operation: u.operation, lotId: u.lotId, quantity: u.quantity, grade: lot.grade, deliveryOn: lot.deliveryOn, unresolved: [], spans: [{ start: 0, end: u.text.length }], ...(u.correctsEventId ? { correctsEventId: u.correctsEventId } : {}) } };
    try { l = commitUpdate(l, p, { reviewer: "evaluation-setup", reviewHash: reviewUpdate(l, p).hash }); }
    catch (e) { throw new Error(`${c.id}: setup ${n + 1} could not be committed: ${e instanceof Error ? e.message : e}`); }
  }
  return l;
}
const ledgers = new Map(cases.map(c => [c.id, prepare(c)]));
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("MODEL_API_KEY not loaded; use node --env-file");

const budget = createBudget(maxCalls), http = metaTransport(key);
const usage = Object.fromEntries(prompts.map(p => [p, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } as Usage]));
const results: { caseId: string; prompt: PromptVersion; ms: number; score: ReturnType<typeof scoreCase>; output: unknown; raw: unknown }[] = [];
let complete = true;
run: for (const c of cases) {
  for (const prompt of prompts) {
    let content: unknown, ms = 0;
    const transport: Transport = async (request, signal) => {
      const start = performance.now();
      try { const body = await http(request, signal) as { choices?: { message?: { content?: unknown } }[] }; content = body.choices?.[0]?.message?.content; return body; }
      finally { ms = Math.round(performance.now() - start); }
    };
    const r = await interpretSource(ledgers.get(c.id)!, { id: c.id, revision: 1, growerId: c.growerId, text: c.text },
      { enabled: true, transport, model: values.model, budget, promptVersion: prompt, reasoningEffort: values.effort as "minimal" | "low", maxCompletionTokens: Number(values["max-tokens"]) });
    if ("usage" in r && r.usage) for (const k of ["prompt_tokens", "completion_tokens", "total_tokens"] as const) usage[prompt][k] += r.usage[k];
    results.push({ caseId: c.id, prompt, ms, score: scoreCase(c, r),
      output: r.status === "proposed" ? { interpretation: r.proposal.interpretation, clarifications: r.proposal.clarifications, questions: r.questions, discarded: r.discarded } : r, raw: content });
    // Account or request errors (do not retry 400/401/402/403/404/413) would fail every call alike.
    if (r.status === "failed" && /HTTP (400|401|402|403|404|413)\b/.test(r.reason)) { complete = false; break run; }
  }
}
const cost = (u: Usage) => Number(((u.prompt_tokens * 1.25 + u.completion_tokens * 4.25) / 1e6).toFixed(6));
const perPrompt = Object.fromEntries(prompts.map(p => [p, { ...summarize(results.filter(x => x.prompt === p).map(x => x.score)), usage: usage[p], estimatedCostUsd: cost(usage[p]) }]));
const at = new Date().toISOString();
const report = { label: "Prompt comparison on labelled cases. Small samples; read per-case grades, not only totals.", complete, model: values.model, effort: values.effort,
  maxTokens: Number(values["max-tokens"]), at, casesFile: values.cases, casesSha256: createHash("sha256").update(raw).digest("hex"), callsUsed: maxCalls - budget.remaining, perPrompt, results };
mkdirSync("output", { recursive: true });
const file = `output/eval-${at.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ complete, callsUsed: report.callsUsed, perPrompt }, null, 2));
for (const x of results) console.log(`${x.caseId.padEnd(24)} ${x.prompt.padEnd(9)} ${x.score.status === "proposed" ? Object.entries(x.score.grades).filter(([, g]) => g !== "n/a" && g !== "correct").map(([f, g]) => `${f}:${g}`).join(" ") || "all correct" : `${x.score.status}: ${x.score.reason}`}${x.score.unsafe ? "  UNSAFE" : ""}`);
console.error(`Saved ${file}`);
