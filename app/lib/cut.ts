import { changedSinceConfirm, stageOf } from "../../src/commitments.ts";
import type { Ledger } from "../../src/updates.ts";
import { buyer, weight } from "./format.ts";
export { possessive } from "./format.ts";

// Pure rules and words for settling a cut, shared by the action, the card and the printed sheets.

// A split amount is typed as text. A blank box counts as 0.
export const SPLIT_WITH_OTHER = "You typed split amounts. Choose Split it, or clear the amounts.";
export const NEGATIVE_POUNDS = "Enter 0 or more pounds.";
export const WHOLE_POUNDS = "Enter whole pounds.";
export const TOO_LARGE = "That number is too large. Enter the pounds each buyer gets less.";

// The problem with the split amounts as posted, or undefined when they can be used. `choice` is what the radio group
// said: amounts typed beside any other choice are refused rather than dropped, and a negative number or a decimal each
// get their own reason. The sum is checked later by the domain, which knows the excess.
export function splitProblem(choice: string, amounts: string[]): string | undefined {
  const typed = amounts.map(a => a.trim());
  if (choice !== "split") return typed.some(a => a !== "") ? SPLIT_WITH_OTHER : undefined;
  for (const a of typed) {
    if (a === "" || /^\d{1,9}$/.test(a)) continue;
    if (/^-\d+(\.\d+)?$/.test(a)) return NEGATIVE_POUNDS;
    if (/^\d{10,}$/.test(a)) return TOO_LARGE;
    return WHOLE_POUNDS;
  }
  return undefined;
}

// Who now gets what after a cut is settled, said by name for each buyer whose promise was cut:
// "Northside Grocery Co-op now gets 116 of 120 lb (4 short)." Read from the ledger after the decision.
export function cutOutcome(l: Ledger, orderIds: string[]): string[] {
  return orderIds.flatMap(id => {
    const o = l.snapshot.orders.find(x => x.id === id);
    if (!o) return [];
    const s = stageOf(l, id), short = Math.max(0, s.ordered - s.promised), name = buyer(o.buyerId);
    // "116 of 120 lb": the unit is said once, after the total.
    const bare = (n: number) => s.unit === "g" ? weight(n, s.unit) : String(n);
    const got = bare(s.promised);
    return [short > 0 ? `${name} now gets ${got} of ${weight(s.ordered, s.unit)} (${bare(short)} short).` : `${name} now gets all ${weight(s.ordered, s.unit)}.`];
  });
}
export const RECONFIRM = "Confirm today's plan again so the sheets match.";

// The live line under the split boxes: what is left of the total to place, blank boxes counting as 0.
export function leftToPlace(excess: number, amounts: string[], unit: "g" | "lb" | "each"): string {
  const placed = amounts.reduce((n, a) => n + (/^\d{1,9}$/.test(a.trim()) ? Number(a.trim()) : 0), 0), left = excess - placed;
  if (left === 0) return `All ${weight(excess, unit)} placed.`;
  return left > 0 ? `${weight(left, unit)} left to place` : `${weight(-left, unit)} too many`;
}

// A printed sheet whose lines changed since the plan was confirmed says so on paper, where the screen's warning box is hidden.
// What a screen reader hears from the live line: only when the amounts are all placed or overshoot, not on every digit.
export const leftToPlaceSaid = (line: string): string => /^All |too many$/.test(line) ? line : "";

// A split that misses the total says what it came to, in the order's own unit.
export const splitTotalMessage = (sum: number, excess: number, unit: "g" | "lb" | "each"): string =>
  `You entered ${weight(sum, unit)}; the cuts must total ${weight(excess, unit)}.`;

export const staleSheetLine = (at: string): string => `Changed since the plan was confirmed at ${at}. Confirm again before packing.`;
// The orders and the lots whose lines differ from the confirm: an order sheet or a pick list is stale when it holds one.
export function changedSheets(l: Ledger): { orders: Set<string>; lots: Set<string> } {
  const c = changedSinceConfirm(l);
  return { orders: new Set(c.map(x => x.orderId)), lots: new Set(c.map(x => x.lotId)) };
}
