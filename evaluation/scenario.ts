import { snapshotHash, type Snapshot } from "../src/planner.ts";
import type { UpdateProposal } from "../src/updates.ts";

// Entirely authored synthetic development scenario; not customer data or holdout.
export function scenario(): Snapshot {
  return { version: 0,
    lots: [
      { id: "lot-a", growerId: "grower-a", product: "tomato", grade: "standard", quantity: { amount: 60, unit: "kg" }, deliveryOn: "2026-10-30", confirmed: true },
      { id: "lot-b", growerId: "grower-b", product: "tomato", grade: "standard", quantity: { amount: 40, unit: "kg" }, deliveryOn: "2026-10-30", confirmed: true },
      { id: "lot-c", growerId: "grower-a", product: "cucumber", grade: "standard", quantity: { amount: 20, unit: "kg" }, deliveryOn: "2026-10-30", confirmed: true },
      { id: "lot-d", growerId: "grower-b", product: "zucchini", grade: "standard", quantity: { amount: 0, unit: "kg" }, deliveryOn: "2026-10-30", confirmed: true }
    ], orders: [
      { id: "order-a", buyerId: "buyer-a", product: "tomato", acceptedGrades: ["standard"], quantity: { amount: 60, unit: "kg" }, deliveryOn: "2026-10-30", priority: 2, approvedSubstitutions: [] },
      { id: "order-b", buyerId: "buyer-b", product: "tomato", acceptedGrades: ["standard"], quantity: { amount: 40, unit: "kg" }, deliveryOn: "2026-10-30", priority: 1, approvedSubstitutions: [] },
      { id: "order-c", buyerId: "buyer-c", product: "cucumber", acceptedGrades: ["standard"], quantity: { amount: 30, unit: "kg" }, deliveryOn: "2026-10-30", priority: 1, approvedSubstitutions: [{ product: "zucchini", acceptedGrades: ["standard"] }] }
    ] };
}
export function shortage(s: Snapshot): UpdateProposal {
  return { id: "update-short", baseHash: snapshotHash(s), lotId: "lot-a", quantity: { amount: 30, unit: "kg" }, evidence: { id: "note-a", text: "Only 30 kg of standard tomatoes for Friday, replacing the earlier 60 kg total.", quote: "Only 30 kg of standard tomatoes" } };
}
export function surplus(s: Snapshot, clarified = false): UpdateProposal {
  return { id: "update-surplus", baseHash: snapshotHash(s), lotId: "lot-d", quantity: { amount: 4, unit: "case", ...(clarified ? { pack: { amount: 5000, unit: "g" as const } } : {}) }, evidence: { id: clarified ? "note-b-clarified" : "note-b", text: clarified ? "Four cases of standard zucchini Friday. Confirmed net contents: 5 kg per case; this is the new lot total." : "We have four cases of standard zucchini for Friday now.", quote: clarified ? "Confirmed net contents: 5 kg per case" : "four cases of standard zucchini" } };
}
