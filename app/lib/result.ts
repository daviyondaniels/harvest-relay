import type { Resolution } from "../../src/resolve.ts";
import { buyer, weight } from "./format.ts";

type Short = { orderId: string; buyerId: string; short: number; unit: "g" | "lb" | "each" };
// What an approval did to buyers who are still short, said by name. approvalResult (view.ts) names
// a buyer who is now short or shorter, or now covered; this adds the buyer who is still short but
// by less ("Riverbend School Kitchen is now 30 lb short (was 60)."). changed is true when any buyer's
// shortfall moved either way, so "No buyer's order changes." is said only when none did.
export function buyerChanges(before: Map<string, number>, after: Short[]): { lines: string[]; changed: boolean } {
  const now = new Map(after.map(s => [s.orderId, s.short]));
  const lines = after.filter(g => (before.get(g.orderId) ?? 0) > g.short).map(g => `${buyer(g.buyerId)} is now ${weight(g.short, g.unit)} short (was ${weight(before.get(g.orderId)!, g.unit)}).`);
  const changed = after.some(g => (before.get(g.orderId) ?? 0) !== g.short) || [...before].some(([id, n]) => n > 0 && !now.has(id));
  return { lines, changed };
}

// What a Send, a Tell or a recorded answer did, said by name and amount, so the status line is never just
// "Recorded as sent." Pure, from the changed resolution.
export function sentLine(r: Resolution): string {
  const to = r.facts.to.name, amount = weight(r.facts.amount, r.facts.unit);
  if (r.option.kind === "notify-short") return `Sent to ${to}: short ${amount}.`;
  if (r.option.kind === "offer-substitute") return `Sent to ${to}: offering ${r.option.product} for ${amount}.`;
  return `Sent to ${to}: asking for ${amount} of ${r.facts.product}.`;
}
// A buyer's yes or no to an offer ("They said yes"), or a grower's or source's answer to an ask.
export function answerLine(r: Resolution): string {
  const to = r.facts.to.name, accepted = r.status === "accepted";
  if (r.option.kind === "offer-substitute") return `Recorded: ${to} said ${accepted ? "yes" : "no"} to ${r.option.product}, ${weight(r.facts.amount, r.facts.unit)}.`;
  if (!accepted) return `Recorded: ${to} can't supply.`;
  const said = r.decisions.findLast(d => d.kind === "supply-recorded")?.note?.match(/^yes, (\d+)$/);
  return said ? `Recorded: ${to} can bring ${weight(Number(said[1]), r.option.unit)}.` : `Recorded: ${to} can supply.`;
}
