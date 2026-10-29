import { proposeAllocations, snapshotHash, verifyPlan, type Allocation, type Plan, type Snapshot } from "./planner.ts";
import { NAME_MAX } from "./hub.ts";
import { normalize, type BaseUnit } from "./quantity.ts";
import { orderStatus, unresolved } from "./resolve.ts";
import { stamp, text, type Workbench } from "./workbench.ts";

// The packing lock: the plan the coordinator locked, valid only while snapshotHash still
// matches the live snapshot. Orders shipped short without telling the buyer are kept
// (docs/EVIDENCE.md E18).
export type Lock = {
  snapshotHash: string; snapshot: Snapshot; plan: Plan; lockedBy: string; at: string;
  shippedShort: { orderId: string; amount: number; unit: BaseUnit; buyerTold: false }[];
};

// Blocking: orders still short with no way out recorded. Warnings: inbox items nobody has
// settled yet; they never block, because the plan is built from approved updates only.
export function lockGate(w: Workbench): { blocking: string[]; warnings: string[] } {
  return { blocking: unresolved(w), warnings: w.items.filter(i => i.state === "open" || i.state === "pending" || i.state === "returned").map(i => i.id) };
}

export function lockState(w: Workbench): "none" | "valid" | "lapsed" {
  if (!w.lock) return "none";
  return w.lock.snapshotHash === snapshotHash(w.ledger.snapshot) ? "valid" : "lapsed";
}

// Locks the plan for the live ledger, approved substitutions included. With Ship short the
// coordinator accepts the blocking shortfalls, and they are recorded as not told to the buyer.
export function lockPlan(w: Workbench, by: string, at: string, opts: { shipShort: boolean }): Workbench {
  const lockedBy = text(by, NAME_MAX, "Actor name"), when = stamp(at), { blocking } = lockGate(w);
  if (blocking.length && !opts.shipShort) throw new Error(`Orders still to resolve: ${blocking.join(", ")}. Resolve them or choose Ship short`);
  const snapshot = structuredClone(w.ledger.snapshot), plan = proposeAllocations(snapshot);
  verifyPlan(snapshot, plan);
  const shippedShort = plan.unfilled.filter(u => orderStatus(w, u.orderId) !== "buyer-told" && (!opts.shipShort || blocking.includes(u.orderId)))
    .map(u => ({ orderId: u.orderId, amount: u.amount, unit: u.unit, buyerTold: false as const }));
  const next = structuredClone(w);
  next.lock = { snapshotHash: plan.snapshotHash, snapshot, plan, lockedBy, at: when, shippedShort };
  return next;
}

// leftOver: what the grower has confirmed on this lot beyond what the plan picks.
export type PickLine = { lotId: string; product: string; grade: string; deliveryOn: string; total: number; leftOver: number; unit: BaseUnit; to: { orderId: string; buyerId: string; amount: number; kind: Allocation["kind"] }[] };
export type PickList = { growerId: string; lines: PickLine[] };
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function pickLists(lock: Lock): PickList[] {
  const lists = new Map<string, Map<string, PickLine>>();
  for (const a of lock.plan.allocations) {
    const lot = lock.snapshot.lots.find(l => l.id === a.lotId)!, order = lock.snapshot.orders.find(o => o.id === a.orderId)!;
    const lines = lists.get(lot.growerId) ?? new Map<string, PickLine>();
    const line = lines.get(lot.id) ?? { lotId: lot.id, product: lot.product, grade: lot.grade, deliveryOn: lot.deliveryOn, total: 0, leftOver: normalize(lot.quantity).amount, unit: a.unit, to: [] };
    line.total += a.amount; line.leftOver -= a.amount; line.to.push({ orderId: a.orderId, buyerId: order.buyerId, amount: a.amount, kind: a.kind });
    lines.set(lot.id, line); lists.set(lot.growerId, lines);
  }
  return [...lists].sort(([a], [b]) => cmp(a, b)).map(([growerId, lines]) => ({ growerId, lines: [...lines.values()].sort((a, b) => cmp(a.lotId, b.lotId)) }));
}

export type SheetLine = { product: string; grade: string; lotId: string; growerId: string; amount: number; substitute: boolean };
export type OrderSheet = { buyerId: string; orderId: string; product: string; deliveryOn: string; ordered: number; unit: BaseUnit; lines: SheetLine[]; short: number; shippedShortUntold: boolean };

export function orderSheets(lock: Lock): OrderSheet[] {
  return [...lock.snapshot.orders].sort((a, b) => cmp(a.id, b.id)).map(o => {
    const q = normalize(o.quantity);
    const lines = lock.plan.allocations.filter(a => a.orderId === o.id).map(a => {
      const lot = lock.snapshot.lots.find(l => l.id === a.lotId)!;
      return { product: lot.product, grade: lot.grade, lotId: lot.id, growerId: lot.growerId, amount: a.amount, substitute: lot.product !== o.product };
    });
    return {
      buyerId: o.buyerId, orderId: o.id, product: o.product, deliveryOn: o.deliveryOn, ordered: q.amount, unit: q.unit, lines,
      short: lock.plan.unfilled.find(u => u.orderId === o.id)?.amount ?? 0,
      shippedShortUntold: lock.shippedShort.some(s => s.orderId === o.id && !s.buyerTold)
    };
  });
}
