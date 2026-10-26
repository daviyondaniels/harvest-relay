import { snapshotHash, type Snapshot } from "../src/planner.ts";
import { locate, type Clarification, type Interpretation, type Ledger, type Source, type UpdateProposal } from "../src/updates.ts";

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

// Builds a proposal against the ledger's current version; quotes become literal spans.
export function propose(l: Ledger, id: string, source: Source, interpretation: Omit<Interpretation, "spans" | "unresolved"> & { quotes: string[]; unresolved?: Interpretation["unresolved"] }, clarifications: Clarification[] = []): UpdateProposal {
  const { quotes, unresolved = [], ...rest } = interpretation;
  return { id, baseVersion: l.version, baseHash: snapshotHash(l.snapshot), source,
    interpretation: { ...rest, unresolved, spans: quotes.map(q => locate(source.text, q)) }, clarifications };
}
export function answer(field: Clarification["field"], question: string, source: Source, quote: string): Clarification {
  return { field, question, answer: { source, span: locate(source.text, quote) } };
}

export function shortage(l: Ledger): UpdateProposal {
  const source = { id: "note-a", revision: 1, growerId: "grower-a", text: "Only 30 kg of standard tomatoes for Friday, replacing the earlier 60 kg total." };
  return propose(l, "update-short", source, { operation: "replace-total", lotId: "lot-a", quantity: { amount: 30, unit: "kg" }, grade: "standard", deliveryOn: "2026-10-30",
    quotes: ["Only 30 kg of standard tomatoes", "Friday", "replacing the earlier 60 kg total"] });
}
// Unclarified, "four cases ... now" leaves both pack contents and total-vs-added open.
export function surplus(l: Ledger, clarified = false): UpdateProposal {
  const source = { id: "note-b", revision: 1, growerId: "grower-b", text: "We have four cases of standard zucchini for Friday now." };
  const quotes = ["four cases of standard zucchini", "Friday"];
  if (!clarified) return propose(l, "update-surplus", source, { operation: "unresolved", lotId: "lot-d", quantity: { amount: 4, unit: "case" }, grade: "standard", deliveryOn: "2026-10-30", quotes });
  const reply = { id: "note-b-reply", revision: 1, growerId: "grower-b", text: "Confirmed net contents: 5 kg per case; this is the new lot total." };
  return propose(l, "update-surplus", source,
    { operation: "replace-total", lotId: "lot-d", quantity: { amount: 4, unit: "case", pack: { amount: 5000, unit: "g" } }, grade: "standard", deliveryOn: "2026-10-30", quotes },
    [answer("pack", "Clarify the confirmed contents of one case", reply, "Confirmed net contents: 5 kg per case"),
     answer("operation", "Is this a new total or in addition to the current lot?", reply, "this is the new lot total")]);
}
