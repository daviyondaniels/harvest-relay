import { commitKey, conflicts, orderQuantities, planOf, stageOf } from "./commitments.ts";
import { NAME_MAX } from "./hub.ts";
import { digest, snapshotHash, validateSnapshot } from "./planner.ts";
import { normalize, type Normalized, type Quantity } from "./quantity.ts";
import { isOpen } from "./resolve.ts";
import { stamp, text, type Workbench } from "./workbench.ts";

export type OrderChangeRecord = { id: string; orderId: string; before: Quantity; after: Normalized; reason: string; by: string; at: string; beforeHash: string; afterHash: string };
export type OrderChange = { orderId: string; amount: number; reason: string };
export type OrderChangePreview = { reviewHash: string; before: Normalized; after: Normalized; reason: string; impact: { orderId: string; beforeCovered: number; afterCovered: number; beforeShort: number; afterShort: number }[] };

// Existing order, same buyer/product/date/unit/permissions. Nothing edits source messages or cuts promises.
function candidate(w: Workbench, change: OrderChange): { next: Workbench; before: Quantity; after: Normalized; reason: string } {
  const order = w.ledger.snapshot.orders.find(o => o.id === change.orderId);
  if (!order) throw new Error("Choose an existing order.");
  const stage = stageOf(w.ledger, order.id);
  if (stage.stage === "packed" || stage.stage === "handed-off") throw new Error("This order is already packed or handed off. Its quantity cannot be changed here.");
  if (conflicts(w.ledger).some(c => c.promises.some(p => p.orderId === order.id))) throw new Error("Decide who takes the cut before changing this order.");
  if (w.resolutions.some(r => r.orderId === order.id && isOpen(w, r))) throw new Error("Finish or discard this order's open request before changing its quantity.");
  const before = normalize(order.quantity), after = normalize({ amount: change.amount, unit: before.unit });
  if (after.amount === 0) throw new Error("Enter a quantity greater than zero.");
  if (after.amount === before.amount) throw new Error("Enter a different quantity to preview a change.");
  if (after.amount < stage.promised) throw new Error(`This order has ${stage.promised} ${stage.unit} promised. Keep at least that amount; promises cannot be cut here.`);
  const reason = text(change.reason, 500, "Reason for the order change");
  if ((w.orderChanges?.length ?? 0) >= 500) throw new Error("Order change history is full.");
  const next = structuredClone(w);
  // Preserve the pre-edit demand for workspaces confirmed before this field existed.
  if (next.ledger.commitments && !next.ledger.commitments.confirmed.orderQuantities) next.ledger.commitments.confirmed.orderQuantities = orderQuantities(w.ledger);
  next.ledger.snapshot.orders.find(o => o.id === order.id)!.quantity = after;
  next.ledger.snapshot.version++; next.ledger.version++;
  validateSnapshot(next.ledger.snapshot); planOf(next.ledger);
  return { next, before: structuredClone(order.quantity), after, reason };
}

// A preview is pure. Its hash binds demand, supply, promises, stages and in-flight conversations.
export function previewOrderChange(w: Workbench, change: OrderChange): OrderChangePreview {
  const { next, before, after, reason } = candidate(w, change), a = planOf(w.ledger), b = planOf(next.ledger);
  const covered = (plan: typeof a, id: string) => plan.allocations.filter(x => x.orderId === id).reduce((n, x) => n + x.amount, 0);
  const short = (plan: typeof a, id: string) => plan.unfilled.find(x => x.orderId === id)?.amount ?? 0;
  const impact = w.ledger.snapshot.orders.map(o => ({ orderId: o.id, beforeCovered: covered(a, o.id), afterCovered: covered(b, o.id), beforeShort: short(a, o.id), afterShort: short(b, o.id) }))
    .filter(x => x.orderId === change.orderId || x.beforeCovered !== x.afterCovered || x.beforeShort !== x.afterShort);
  const reviewHash = digest({ snapshot: snapshotHash(w.ledger.snapshot), version: w.ledger.version, commitments: commitKey(w.ledger), stages: w.ledger.commitments?.log ?? [], resolutions: w.resolutions, change: { orderId: change.orderId, amount: after.amount, reason } });
  return { reviewHash, before: normalize(before), after, reason, impact };
}

export function commitOrderChange(w: Workbench, change: OrderChange, shown: string, by: string, at: string): Workbench {
  const who = text(by, NAME_MAX, "Actor name"), when = stamp(at), preview = previewOrderChange(w, change);
  if (!shown || shown !== preview.reviewHash) throw new Error("This order change no longer matches the preview. Review the current impact before confirming.");
  const { next, before, after, reason } = candidate(w, change);
  next.orderChanges = [...(w.orderChanges ?? []), { id: `order-change-${(w.orderChanges?.length ?? 0) + 1}`, orderId: change.orderId, before, after, reason, by: who, at: when, beforeHash: snapshotHash(w.ledger.snapshot), afterHash: snapshotHash(next.ledger.snapshot) }];
  return next;
}
