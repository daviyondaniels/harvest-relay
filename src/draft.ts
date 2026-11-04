import { chat, type ChatRequest, type InterpretOptions, type Usage } from "./interpret.ts";
import { checkDraft, display, template, type Check, type MessageFacts } from "./messages.ts";

// Templates are the default; a model redraft is optional and must pass the
// deterministic checker or it is replaced by the template (docs/EVIDENCE.md E10, E11).
// A draft with only confirmation items is kept; the items travel on Draft.check.
export const DRAFT_PROMPT_VERSION = "draft-v3";
const DRAFT_PROMPT = [
  "You write one short, plain, friendly text message from a small food hub coordinator.",
  "Use only the facts given: the recipient name, product, substitute if any, quantity and day. The purpose says what the message must do.",
  "Name the delivery day by the full name of the day, as given in day (for example Friday). Never write tomorrow, today, tonight, this week or any other relative or shortened day.",
  "Write the quantity exactly as given in quantity, with digits and units (for example 30 lb). Do not round, convert or spell it out.",
  "Mention no other product than the ones given: no other produce, grade or variety.",
  "Do not use time phrases such as next, after, from, last or week. Do not promise prices, delivery times or anything not in the facts.",
  'Return JSON {"text": "..."}.'
].join(" ");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_TEXT = 2000;

// author is who wrote the text, as data: the label `by` is for display only. recorded marks
// a model draft replayed from a recording rather than a live call.
export type Draft = { text: string; by: string; author: "template" | "model"; recorded?: boolean; check: Check; fallback?: string; usage?: Usage };

// One line saying what a message of this kind must do, in the template's own wording,
// so the model states the same facts the checker looks for.
export function purpose(f: MessageFacts, quantity = display(f.amount, f.unit), day = DAYS[new Date(`${f.deliveryOn}T00:00:00Z`).getUTCDay()]): string {
  switch (f.kind) {
    case "request": return `Ask the grower whether they can bring another ${quantity} of ${f.product} for ${day}, and ask how much they can do.`;
    case "offer":
      if (!f.substitute) throw new Error("An offer needs a substitute");
      return `Ask whether ${f.substitute} would work instead of ${quantity} of ${f.product} for ${day}, with a yes or no reply. The quantity is the offered substitute amount; do not state the full shortage. Never suggest that ${f.product} is available.`;
    case "notice": return `Say the ${f.product} order for ${day} will be ${quantity} short.`;
  }
}

export function buildDraftRequest(f: MessageFacts, model: string, maxCompletionTokens: number, effort: "minimal" | "low"): ChatRequest {
  const day = DAYS[new Date(`${f.deliveryOn}T00:00:00Z`).getUTCDay()], quantity = display(f.amount, f.unit);
  return {
    model, max_completion_tokens: maxCompletionTokens, temperature: 0, reasoning_effort: effort, stream: false, n: 1,
    messages: [{ role: "system", content: DRAFT_PROMPT }, { role: "user", content: JSON.stringify({ ...f, day, quantity, purpose: purpose(f, quantity, day) }) }],
    response_format: { type: "json_schema", json_schema: { name: "draft", strict: true, schema: {
      type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } },
  };
}

// on is the date the message is written, for relative days (see checkDraft).
export function templateDraft(f: MessageFacts, knownProducts: string[], on?: string): Draft {
  return { text: template(f), by: "Template", author: "template", check: checkDraft(template(f), f, knownProducts, on) };
}

// Why a draft fell back to the template: the check rejected the model's wording, or the model gave none.
const CHECK_FAILED = "Model draft failed the check";
export const failedTheCheck = (reason: string): boolean => reason.startsWith(CHECK_FAILED);

export async function draftMessage(f: MessageFacts, knownProducts: string[], o: InterpretOptions, label: string, on?: string): Promise<Draft> {
  const fallback = (reason: string, usage?: Usage): Draft => ({ ...templateDraft(f, knownProducts, on), fallback: reason, ...(usage ? { usage } : {}) });
  let r;
  try { r = await chat(buildDraftRequest(f, o.model, o.maxCompletionTokens ?? 800, o.reasoningEffort ?? "low"), o); }
  catch (e) { return fallback(`Model call failed: ${e instanceof Error ? e.message : "unknown"}`); }
  if (!("raw" in r)) return fallback(r.status === "disabled" ? r.reason : `Model call failed: ${r.reason}`, "usage" in r ? r.usage : undefined);
  let text: unknown;
  try { text = (JSON.parse(r.raw) as { text?: unknown } | null)?.text; } catch { text = undefined; }
  if (typeof text !== "string" || !text || text.length > MAX_TEXT) return fallback("Model reply was not valid draft JSON", r.usage);
  const check = checkDraft(text, f, knownProducts, on);
  if (!check.ok) return fallback(`${CHECK_FAILED}: ${check.problems.join("; ")}`, r.usage);
  return { text, by: label, author: "model", check, usage: r.usage };
}
