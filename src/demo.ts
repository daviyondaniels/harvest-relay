import type { Snapshot } from "./planner.ts";

// The demo hub's own snapshot, in pounds. evaluation/scenario.ts stays in kg.
export function demoSnapshot(): Snapshot {
  const lb = (amount: number) => ({ amount, unit: "lb" as const });
  const lot = (id: string, growerId: string, product: string, amount: number) =>
    ({ id, growerId, product, grade: "standard", quantity: lb(amount), deliveryOn: "2026-10-30", confirmed: true });
  return { version: 0,
    lots: [lot("lot-a", "grower-a", "tomato", 120), lot("lot-b", "grower-b", "tomato", 80), lot("lot-c", "grower-a", "cucumber", 40), lot("lot-d", "grower-b", "zucchini", 0)],
    orders: [
      { id: "order-a", buyerId: "buyer-a", product: "tomato", acceptedGrades: ["standard"], quantity: lb(120), deliveryOn: "2026-10-30", priority: 2, approvedSubstitutions: [] },
      { id: "order-b", buyerId: "buyer-b", product: "tomato", acceptedGrades: ["standard"], quantity: lb(80), deliveryOn: "2026-10-30", priority: 1, approvedSubstitutions: [] },
      { id: "order-c", buyerId: "buyer-c", product: "cucumber", acceptedGrades: ["standard"], quantity: lb(60), deliveryOn: "2026-10-30", priority: 1, approvedSubstitutions: [{ product: "zucchini", acceptedGrades: ["standard"] }] }
    ] };
}

export type Contact = { id: string; name: string; kind: "member" | "outside" };
export const CONTACTS: Contact[] = [
  { id: "grower-a", name: "Alder Creek Farm", kind: "member" },
  { id: "grower-b", name: "Birch Hollow Gardens", kind: "member" },
  { id: "grower-c", name: "Cedar Row Farm", kind: "member" },
  { id: "outside-1", name: "Valley Produce Wholesale", kind: "outside" }
];
export const BUYERS: Record<string, string> = { "buyer-a": "Northside Grocery Co-op", "buyer-b": "Riverbend School Kitchen", "buyer-c": "Eastside Community Pantry" };
