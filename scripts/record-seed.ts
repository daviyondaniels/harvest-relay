import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEMO_MODEL, DEMO_SETTINGS, RECORDED, type Recording } from "../src/seed.ts";
import { PROMPT_VERSION, createBudget, interpretReply, interpretSource, metaTransport, type Transport } from "../src/interpret.ts";
import { demoSnapshot } from "../src/demo.ts";
import { createLedger } from "../src/updates.ts";

// Paid: records the demo inbox's Meta readings, one call per seed message and one per
// scripted reply, e.g.:
//   node --env-file="$HOME/.config/harvest-relay/meta.env" scripts/record-seed.ts --max-calls 7
// Each reading is taken against the starting hub, as the demo replays it. Nothing is
// written unless every call produced a usable reading.
const { values } = parseArgs({ options: { "max-calls": { type: "string" } } });
const needed = RECORDED.length + RECORDED.filter(m => m.reply).length, maxCalls = Number(values["max-calls"]);
if (maxCalls !== needed) throw new Error(`Recording needs exactly ${needed} calls; pass --max-calls ${needed}`);
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("MODEL_API_KEY not loaded; use node --env-file");

const budget = createBudget(maxCalls), http = metaTransport(key), ledger = createLedger(demoSnapshot());
const raw: Record<string, string> = {}, summary: string[] = [];
const keep = (id: string): Transport => async (request, signal) => {
  const body = await http(request, signal) as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === "string") raw[id] = content;
  return body;
};
const opts = (id: string) => ({ enabled: true, model: DEMO_MODEL, ...DEMO_SETTINGS, budget, transport: keep(id) });
for (const m of RECORDED) {
  const r = await interpretSource(ledger, m.source, opts(m.source.id));
  summary.push(`${m.source.id}: ${r.status}${r.status === "proposed" ? ` ${r.proposal.interpretation.operation}, questions: ${r.questions.map(q => q.field).join(", ") || "none"}` : ` (${r.reason})`}`);
  if (!m.reply) continue;
  if (r.status !== "proposed") { summary.push(`${m.reply.id}: skipped, no reading of the message`); continue; }
  const rr = await interpretReply(ledger, r.proposal, m.reply, opts(m.reply.id));
  summary.push(`${m.reply.id}: ${rr.status}${rr.status === "proposed" ? ` applied ${rr.applied.join(", ") || "none"}, open: ${rr.unanswered.join(", ") || "none"}` : ` (${rr.reason})`}`);
}
const u = budget.usage, cost = Number(((u.prompt_tokens * 1.25 + u.completion_tokens * 4.25) / 1e6).toFixed(6));
console.log(summary.join("\n"));
console.log(JSON.stringify({ callsUsed: maxCalls - budget.remaining, usage: u, estimatedCostUsd: cost }));
if (summary.some(x => !/: proposed/.test(x))) { console.error("Not saved: some readings were unusable"); process.exit(1); }
const recording: Recording = { model: DEMO_MODEL, promptVersion: PROMPT_VERSION, recordedAt: new Date().toISOString(), raw };
mkdirSync("data", { recursive: true });
writeFileSync("data/seed-readings.json", JSON.stringify(recording, null, 2) + "\n");
console.log("Saved data/seed-readings.json");
