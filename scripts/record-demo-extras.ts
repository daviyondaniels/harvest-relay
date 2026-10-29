import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DRAFT_PROMPT_VERSION, draftMessage } from "../src/draft.ts";
import { PROMPT_VERSION, createBudget, interpretSource, metaTransport, type Transport } from "../src/interpret.ts";
import { factsDigest } from "../src/messages.ts";
import { DEMO_EXTRAS_PATH, DEMO_MODEL, DEMO_SETTINGS, REQUEST_REPLIES, type Extras } from "../src/seed.ts";
import { CONTACTS } from "../src/demo.ts";
import { receiveRequestedReply, sendMessage } from "../src/resolve.ts";
import { approve, interpret, preview } from "../src/workbench.ts";
import { ME, T, askB, known, morning, pick, start, zucchini } from "../tests/story.ts";

// Paid: records the order-resolution demo's model output, three calls, e.g.:
//   node --env-file="$HOME/.config/harvest-relay/meta.env" scripts/record-demo-extras.ts --max-calls 3
//   1. the reading of Birch Hollow's reply to the 60 lb ask,
//   2. a draft of that ask,
//   3. a draft of the zucchini offer for the 30 lb still short.
// The demo path is driven with the hub's morning updates entered by hand (tests/story.ts),
// so only these three calls go to the model. The file is written only if the reading was
// usable; a draft that fails the message check is left out and reported.
const { values } = parseArgs({ options: { "max-calls": { type: "string" } } });
const maxCalls = Number(values["max-calls"]);
if (!Number.isInteger(maxCalls) || maxCalls < 3 || maxCalls > 4) throw new Error("Recording needs 3 calls; pass --max-calls 3 (at most 4)");
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error("MODEL_API_KEY not loaded; use node --env-file");

const budget = createBudget(maxCalls), http = metaTransport(key);
let last = "";
const keep: Transport = async (request, signal) => {
  const body = await http(request, signal) as { choices?: { message?: { content?: unknown } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === "string") last = content;
  return body;
};
const opts = { enabled: true, model: DEMO_MODEL, ...DEMO_SETTINGS, budget, transport: keep };
const drafts: Record<string, string> = {}, readings: Record<string, string> = {}, summary: string[] = [];

let w = morning();
w = start(w, pick(w, askB), 10);
const ask = w.resolutions[0], askDraft = await draftMessage(ask.facts, known(w), opts, "Muse Spark draft");
summary.push(`ask draft: ${askDraft.fallback ? `left out (${askDraft.fallback})` : "ok"}`);
if (!askDraft.fallback) drafts[factsDigest(ask.facts)] = askDraft.text;
w = sendMessage(w, ask.id, CONTACTS, ME, T(11));

const source = REQUEST_REPLIES["grower-b"];
w = receiveRequestedReply(w, ask.id, source, T(12));
const itemId = w.items.at(-1)!.id;
const r = await interpretSource(w.ledger, source, opts);
summary.push(`${source.id}: ${r.status}${r.status === "proposed" ? ` ${r.proposal.interpretation.operation}, questions: ${r.questions.map(q => q.field).join(", ") || "none"}` : ` (${r.reason})`}`);
if (r.status === "proposed") {
  readings[source.id] = last;
  w = interpret(w, itemId, r.proposal, "Muse Spark reading", ME, T(12));
  w = approve(w, itemId, ME, preview(w, itemId).reviewHash!, T(13));
  w = start(w, pick(w, zucchini), 14);
  const offer = w.resolutions.at(-1)!, offerDraft = await draftMessage(offer.facts, known(w), opts, "Muse Spark draft");
  summary.push(`offer draft: ${offerDraft.fallback ? `left out (${offerDraft.fallback})` : "ok"}`);
  if (!offerDraft.fallback) drafts[factsDigest(offer.facts)] = offerDraft.text;
}
const u = budget.usage, cost = Number(((u.prompt_tokens * 1.25 + u.completion_tokens * 4.25) / 1e6).toFixed(6));
console.log(summary.join("\n"));
console.log(JSON.stringify({ callsUsed: maxCalls - budget.remaining, usage: u, estimatedCostUsd: cost }));
if (r.status !== "proposed") { console.error("Not saved: the reading was not usable"); process.exit(1); }
const extras: Extras = { model: DEMO_MODEL, promptVersion: PROMPT_VERSION, draftPromptVersion: DRAFT_PROMPT_VERSION, recordedAt: new Date().toISOString(), drafts, readings };
mkdirSync("data", { recursive: true });
writeFileSync(DEMO_EXTRAS_PATH, JSON.stringify(extras, null, 2) + "\n");
console.log(`Saved ${DEMO_EXTRAS_PATH}`);
