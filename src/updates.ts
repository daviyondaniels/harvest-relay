import { digest, snapshotHash, validateSnapshot, type Snapshot } from "./planner.ts";
import { normalize, type Quantity } from "./quantity.ts";

export type Evidence = { id: string; text: string; quote: string };
export type UpdateProposal = {
  id: string; baseHash: string; lotId: string; quantity: Quantity;
  evidence: Evidence;
};
export type Approval = { proposalHash: string; reviewer: string };

export function reviewUpdate(s: Snapshot, p: UpdateProposal): { hash: string; questions: string[] } {
  validateSnapshot(s);
  if (!p.id?.trim() || !p.lotId?.trim()) throw new Error("Proposal identity required");
  if (p.baseHash !== snapshotHash(s)) throw new Error("Stale update; review against current inventory");
  if (!s.lots.some(l => l.id === p.lotId)) throw new Error("Unknown lot");
  if (!p.evidence || !p.evidence.id?.trim() || typeof p.evidence.text !== "string" || p.evidence.text.length > 8000 || !p.evidence.quote?.trim() || !p.evidence.text.includes(p.evidence.quote)) throw new Error("Literal source evidence required");
  const questions: string[] = [];
  try { normalize(p.quantity); } catch (e) { questions.push(e instanceof Error ? e.message : "Clarify quantity"); }
  if (!questions.length && normalize(p.quantity).unit !== normalize(s.lots.find(l => l.id === p.lotId)!.quantity).unit) questions.push("Confirm a compatible base unit; counts cannot be converted to weight without evidence");
  return { hash: digest(p), questions };
}

// Approval is local review provenance, not authentication. Literal quote checks
// do not prove semantic correctness; the coordinator must review meaning.
export function applyUpdate(s: Snapshot, p: UpdateProposal, approval: Approval): { snapshot: Snapshot; event: { proposal: UpdateProposal; approval: Approval; beforeHash: string; afterHash: string } } {
  const review = reviewUpdate(s, p);
  if (review.questions.length) throw new Error(`Clarification required: ${review.questions.join("; ")}`);
  if (!approval.reviewer?.trim() || approval.reviewer.length > 160 || approval.proposalHash !== review.hash) throw new Error("Named approval of exact proposal required");
  const next = structuredClone(s);
  next.lots.find(l => l.id === p.lotId)!.quantity = structuredClone(p.quantity);
  next.version += 1;
  validateSnapshot(next);
  return { snapshot: next, event: { proposal: structuredClone(p), approval: structuredClone(approval), beforeHash: snapshotHash(s), afterHash: snapshotHash(next) } };
}
