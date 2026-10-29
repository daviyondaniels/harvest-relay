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
export function forecastTag(c: Change): string | undefined {
  if (!c.expected) return undefined;
  const x = normalize(c.expected);
  return `+${weight(x.amount, x.unit)} expected`;
}
export const OPERATION: Record<Operation, string> = {
  "replace-total": "New total", "add-quantity": "Addition", correction: "Correction", forecast: "Forecast", unresolved: "Not clear yet"
};
export const FIELD: Record<Field, string> = {
  operation: "Kind of update", lot: "Lot", quantity: "Quantity", unit: "Unit", pack: "Case contents", grade: "Grade", date: "Delivery day", "correction-target": "Update being corrected"
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
  covered: { label: "Covered", tone: "ready" }, short: { label: "Short", tone: "block" }, resolving: { label: "Waiting on reply", tone: "wait" },
  "buyer-told": { label: "Buyer told", tone: "quiet" }, "substitute-agreed": { label: "Substitute agreed", tone: "done" }
};
export function status(i: InboxItem, p: Preview | undefined): Status {
  if (i.state === "approved") return { label: "Approved", tone: "done" };
  if (i.state === "dismissed") return { label: "Dismissed", tone: "quiet" };
  if (i.state === "returned") return { label: "Returned to grower", tone: "wait" };
  if (i.state === "pending") return { label: "Pending", tone: "wait" };
  if (!i.proposal) return { label: "Not read yet", tone: "wait" };
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
