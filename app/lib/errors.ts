// Which field of a form a refusal is about, so the page can put the message beside it and move
// focus there. Pure, so a test can check every form. A refusal this does not place falls back to
// the form's own result (the message with no field), which every form shows; it is never lost.

// A problem with one field of the form, shown beside that field (by its form name).
export class FieldError extends Error {
  readonly field: string;
  constructor(message: string, field: string) { super(message); this.field = field; }
}

// An empty form with several required fields says every one at once, in the order they sit on the page,
// as a single message on the first of them (WCAG 3.3.1). Pure, so a test can check the wording.
export type Missing = { field: string; what: string };
export function stillNeeded(items: string[]): string {
  const list = items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  return `Still needed: ${list}.`;
}
// One FieldError for two or more missing fields, focused on the first; undefined when fewer than two are missing
// (a single missing field keeps its own, more specific message).
export function manyMissing(missing: Missing[]): FieldError | undefined {
  return missing.length > 1 ? new FieldError(stillNeeded(missing.map(m => m.what)), missing[0].field) : undefined;
}

// The forms a refusal can name (the `on` of a step), and the fields each one renders. A refusal that
// maps to a field outside this list would show nothing and lose focus, so fieldOf stays inside it.
// "value-<detail>" fields exist when the form answers several open details at once.
export const FORM_FIELDS: Record<string, readonly string[]> = {
  // Review updates
  ask: ["field", "question"],
  // reply is Review's reply form and, on Orders, a card's reply forms (supply: channel, text, quote, yes, amount, grade; buyer: channel, text, quote, accept)
  reply: ["reply", "field", "value", "quote", "channel", "text", "yes", "amount", "grade", "accept", "value-operation", "value-lot", "value-quantity", "value-unit", "value-pack", "value-grade", "value-date", "value-correction-target"],
  correct: ["field", "value", "quote"], hold: ["note"], dismiss: [], approve: [], refresh: [], refreshAll: [], read: [], script: [], lot: [],
  hand: ["operation", "lot", "amount", "unit", "grade", "day", "quote"],
  // Orders: a card's forms are named by the card (`<card>-<on>` on the page)
  draft: ["body"], edit: ["body"], send: [], confirm: [], discard: ["reason"], redraft: [], call: ["note", "grower"],
  // Pack and the cut
  lock: [], late: [], stage: [], stageall: [], cut: [], reset: []
};
// A message about a reply's or correction's value, which one of the several details it is about.
const DETAIL: [RegExp, string[]][] = [
  [/Case contents/i, ["pack"]], [/operation|new total|forecast/i, ["operation"]], [/unit/i, ["unit", "quantity"]],
  [/more than this hub handles|more than zero|whole numbers/i, ["quantity", "pack", "unit"]]
];
export type Where = { filled?: string[]; supply?: boolean };

export function fieldOf(e: unknown, on?: string, where: Where = {}): string | undefined {
  if (e instanceof FieldError) return e.field;
  // A guess from the wording only counts when the form has that field; otherwise the message stays on the form's result.
  const f = guess(e, on, where);
  return f && on && FORM_FIELDS[on]?.includes(f) ? f : undefined;
}
function guess(e: unknown, on: string | undefined, where: Where): string | undefined {
  const m = e instanceof Error ? e.message : "";
  if (/^Literal source evidence required/.test(m)) return "quote";
  if (on === "reply" && where.supply) {
    if (/amount|whole number|positive/i.test(m)) return "amount";
    if (/grade/i.test(m)) return "grade";
    if (/whether they can supply/i.test(m)) return "yes";
    if (/quote/i.test(m)) return "quote";
    if (/channel/i.test(m)) return "channel";
    return undefined;
  }
  if (on === "reply" && where.supply === false) {
    if (/quote/i.test(m)) return "quote";
    if (/accepted|channel/i.test(m)) return /channel/i.test(m) ? "channel" : "accept";
    return undefined;
  }
  if ((on === "reply" || on === "correct") && /answer|operation|unit|Case contents|more than this hub handles|more than zero|whole numbers/i.test(m)) {
    // Several details answered at once: the input of the detail the message is about, never the wrapper.
    const filled = where.filled ?? [];
    if (filled.length) {
      for (const [re, cands] of DETAIL) if (re.test(m)) { const hit = cands.find(c => filled.includes(c)); if (hit) return `value-${hit}`; }
      return `value-${filled[0]}`;
    }
    return "value";
  }
  if (on === "hand") {
    if (/whole numbers|more than this hub handles|above zero/i.test(m)) return "amount";
    if (/date/i.test(m)) return "day";
    if (/unit/i.test(m)) return "unit";
  }
  return undefined;
}
