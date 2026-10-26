import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readingProposal, replySource, scoreReply, summarizeReplies, validateReplyCase, type ReplyCase } from "../evaluation/reply-score.ts";
import { scenario } from "../evaluation/scenario.ts";
import { createBudget, interpretReply, metaTransport, type Transport, type Usage } from "../src/interpret.ts";
import { createLedger } from "../src/updates.ts";

// Paid reply-reading evaluation on a labelled case file, one call per case, e.g.:
//   node --env-file="$HOME/.config/harvest-relay/meta.env" scripts/evaluate-replies.ts \
//     --cases evaluation/replies.local.json --model muse-spark-1.3 --max-calls 30
// Every case is validated before the first call; a budget smaller than the case count is refused.
const { values } = parseArgs({ options: {
  cases: { type: "string" }, model: { type: "string" }, "max-calls": { type: "string" },
  effort: { type: "string", default: "minimal" }, "max-tokens": { type: "string", default: "2000" } } });
if (!values.cases || !values.model) throw new Error("Pass --cases and --model");
const raw = readFileSync(values.cases, "utf8");
const cases = (JSON.parse(raw) as { cases: ReplyCase[] }).cases;
if (!Array.isArray(cases) || !cases.length || cases.length > 60) throw new Error("Case file needs 1-60 cases");
const ledger = createLedger(scenario());
for (const c of cases) validateReplyCase(ledger, c);
if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error("Duplicate case IDs");
if (cases.some(c => c.id.startsWith("example-"))) throw new Error("Template examples are not evaluation cases");
const maxCalls = Number(values["max-calls"]);
if (!Number.isSafeInteger(maxCalls) || maxCalls < cases.length || maxCalls > 60) throw new Error(`This run needs exactly ${cases.length} calls; pass --max-calls between ${cases.length} and 60`);
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("MODEL_API_KEY not loaded; use node --env-file");

const budget = createBudget(maxCalls), http = metaTransport(key);
const results: { caseId: string; ms: number; score: ReturnType<typeof scoreReply>; output: unknown; raw: unknown }[] = [];
let complete = true;
for (const c of cases) {
  let content: unknown, ms = 0;
  const transport: Transport = async (request, signal) => {
    const start = performance.now();
    try { const body = await http(request, signal) as { choices?: { message?: { content?: unknown } }[] }; content = body.choices?.[0]?.message?.content; return body; }
    finally { ms = Math.round(performance.now() - start); }
  };
  const r = await interpretReply(ledger, readingProposal(ledger, c), replySource(c),
    { enabled: true, transport, model: values.model, budget, reasoningEffort: values.effort as "minimal" | "low", maxCompletionTokens: Number(values["max-tokens"]) });
  results.push({ caseId: c.id, ms, score: scoreReply(c, r),
    output: r.status === "proposed" ? { applied: r.applied, corrections: r.corrections, unanswered: r.unanswered, interpretation: r.proposal.interpretation } : r, raw: content });
  // Account or request errors (do not retry 400/401/402/403/404/413) would fail every call alike.
  if (r.status === "failed" && /HTTP (400|401|402|403|404|413)\b/.test(r.reason)) { complete = false; break; }
}
const usage: Usage = budget.usage;
const at = new Date().toISOString();
const report = { label: "Reply-reading evaluation on labelled cases. Small samples; read per-case grades, not only totals.", complete, model: values.model, effort: values.effort,
  maxTokens: Number(values["max-tokens"]), at, casesFile: values.cases, casesSha256: createHash("sha256").update(raw).digest("hex"), callsUsed: maxCalls - budget.remaining,
  summary: summarizeReplies(results.map(x => x.score)), usage, estimatedCostUsd: Number(((usage.prompt_tokens * 1.25 + usage.completion_tokens * 4.25) / 1e6).toFixed(6)), results };
mkdirSync("output", { recursive: true });
const file = `output/replies-${at.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ complete, callsUsed: report.callsUsed, summary: report.summary, estimatedCostUsd: report.estimatedCostUsd }, null, 2));
for (const x of results) console.log(`${x.caseId.padEnd(24)} ${x.score.status === "proposed" ? Object.entries(x.score.grades).filter(([, g]) => g !== "n/a" && g !== "correct" && g !== "kept-open").map(([f, g]) => `${f}:${g}`).join(" ") || "all correct" : `${x.score.status}: ${x.score.reason}`}${x.score.unsafe ? "  UNSAFE" : ""}`);
console.error(`Saved ${file}`);
