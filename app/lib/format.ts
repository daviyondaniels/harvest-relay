import { BUYERS, CONTACTS } from "../../src/demo.ts";
import { normalize, type Quantity } from "../../src/quantity.ts";
import type { OrderStatus } from "../../src/resolve.ts";
import type { Change, Field, Operation, Span, UpdateProposal } from "../../src/updates.ts";
import type { InboxItem, Preview } from "../../src/workbench.ts";
import { HUB_ZONE } from "../../src/hub.ts";

export const HUB_NAME = "Riverside Food Hub";

// Display helpers shared by the dashboard and the review workspace.
export function weight(amount: number, unit: "g" | "lb" | "each"): string {
  if (unit === "each" || unit === "lb") return `${amount} ${unit}`;
  return amount % 1000 === 0 ? `${amount / 1000} kg` : `${(amount / 1000).toFixed(1)} kg`;
}
export function quantity(q: Quantity | undefined): string {
  if (!q) return "not stated";
  if (q.unit === "g" || q.unit === "lb" || q.unit === "each") return weight(q.amount, q.unit);
  if (q.unit === "kg") return `${q.amount} kg`;
  const cases = `${q.amount} ${q.amount === 1 ? "case" : "cases"}`;
  return q.pack ? `${cases} of ${weight(q.pack.amount, q.pack.unit)}` : cases;
}
// A forecast's tag: the amount the grower said might come, never the lot it would join.
// With no expected amount there is no tag, never "+0".
export function forecastTag(c: { expected?: Quantity }): string | undefined {
  if (!c.expected) return undefined;
  const x = normalize(c.expected);
  return `+${weight(x.amount, x.unit)} expected`;
}
export const OPERATION: Record<Operation, string> = {
  "replace-total": "New total", "add-quantity": "Addition", correction: "Correction", forecast: "Forecast", unresolved: "Not clear yet"
};
// The four kinds of change, said the way a coordinator would say them (the select's values are the tokens).
export const OPERATION_CHOICE = { "replace-total": "A new total", "add-quantity": "Added to what they have", correction: "A correction", forecast: "A forecast, not confirmed" } as const;
// "120 lb → 60 lb (down 60 lb)": the lot before and after, and by how much.
export function changeLine(before: Quantity, after: Quantity): string {
  const b = normalize(before), a = normalize(after), d = a.amount - b.amount;
  return `${weight(b.amount, b.unit)} → ${weight(a.amount, a.unit)} (${d === 0 ? "no change" : `${d > 0 ? "up" : "down"} ${weight(Math.abs(d), a.unit)}`})`;
}
export const FIELD: Record<Field, string> = {
  operation: "What changed", lot: "Lot", quantity: "Quantity", unit: "Unit", pack: "Case contents", grade: "Grade", date: "Delivery day", "correction-target": "Update being corrected"
};
export function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
export function time(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: HUB_ZONE });
}
export const grower = (id: string) => CONTACTS.find(c => c.id === id)?.name ?? id;
export const buyer = (id: string) => BUYERS[id] ?? id;

export type Status = { label: string; tone: "block" | "ready" | "wait" | "done" | "quiet" };
export const ORDER_STATUS: Record<OrderStatus, Status> = {
  covered: { label: "Covered", tone: "ready" }, short: { label: "Short", tone: "block" }, resolving: { label: "Asked, waiting for the grower", tone: "wait" },
  "buyer-told": { label: "Buyer told", tone: "quiet" }, "substitute-agreed": { label: "Substitute agreed", tone: "done" }
};
// The one chip an order shows: how short it is (and what is being done), or, once covered, how far it has got.
export function orderChip(st: OrderStatus, stage: keyof typeof STAGE, short: number, unit: "g" | "lb" | "each"): Status {
  if (st === "covered" || st === "substitute-agreed") return { label: st === "covered" ? STAGE[stage].label : `${STAGE[stage].label}, substitute agreed`, tone: STAGE[stage].tone };
  const gap = `Short ${weight(short, unit)}`;
  return { label: st === "resolving" ? `${gap}, waiting on reply` : st === "buyer-told" ? `${gap}, buyer told` : gap, tone: ORDER_STATUS[st].tone };
}
// One line per grower under a shortfall: their unreviewed updates that could raise supply.
export const coverLine = (name: string, n: number) => `${name} has ${n} ${n === 1 ? "update" : "updates"} to review that may cover this.`;
// noted: the approved update was a forecast, which is noted and leaves confirmed supply unchanged.
export function status(i: InboxItem, p: Preview | undefined, noted = false): Status {
  if (i.state === "approved") return { label: noted ? "Noted" : "Approved", tone: "done" };
  if (i.state === "dismissed") return { label: "Dismissed", tone: "quiet" };
  if (i.state === "returned") return { label: "Returned to grower", tone: "wait" };
  if (i.state === "pending") return { label: "Pending", tone: "wait" };
  if (!i.proposal) return { label: "Not checked yet", tone: "wait" };
  // Supply moved and the rebased review differs from what was shown. A stale item whose
  // rebased review is unchanged is checked again read-only and shows as normal.
  if (p?.needsRefresh) return { label: "Supply changed", tone: "wait" };
  if (p?.error) return { label: "Can't be checked", tone: "block" };
  const questions = new Set(p?.questions.map(q => q.field)).size;
  return questions ? { label: questions === 1 ? "1 open question" : `${questions} open questions`, tone: "block" } : { label: "Ready to approve", tone: "ready" };
}

// Character ranges of the message that support the reading, merged for highlighting.
export function evidence(p: UpdateProposal | undefined, sourceId: string): Span[] {
  if (!p) return [];
  const spans = sourceId === p.source.id ? [...p.interpretation.spans] : [];
  for (const c of p.clarifications) if (c.answer && c.answer.source.id === sourceId) spans.push(c.answer.span);
  const sorted = spans.sort((a, b) => a.start - b.start), merged: Span[] = [];
  for (const s of sorted) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end); else merged.push({ ...s });
  }
  return merged;
}

// Stages are said in words; the chip tone only repeats them.
export const STAGE: Record<"planned" | "promised" | "packed" | "handed-off", Status> = {
  planned: { label: "Planned", tone: "quiet" }, promised: { label: "Promised", tone: "ready" }, packed: { label: "Packed", tone: "done" }, "handed-off": { label: "Handed off", tone: "done" }
};
// "Promised 40 of 50 lb", and what the live plan gives the order beyond that, when it does.
export function promiseText(s: { promised: number; ordered: number; unit: "g" | "lb" | "each"; confirmedBefore?: boolean }, planned: number): string[] {
  const of = s.unit === "g" ? `${weight(s.promised, s.unit)} of ${weight(s.ordered, s.unit)}` : `${s.promised} of ${weight(s.ordered, s.unit)}`;
  const extra = planned - s.promised;
  return [...(s.promised > 0 || s.confirmedBefore ? [`Promised ${of}`] : []), ...(extra > 0 ? ["Not promised to the buyer yet"] : [])];
}
