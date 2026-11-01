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
