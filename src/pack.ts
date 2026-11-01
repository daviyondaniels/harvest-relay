import { cmp, conflicts, planOf, stageOf, changedSinceConfirm, type Stage } from "./commitments.ts";
export { lockGate } from "./commitments.ts";
import type { Allocation } from "./planner.ts";
import { normalize, type BaseUnit } from "./quantity.ts";
import type { Ledger } from "./updates.ts";

// leftOver: what the grower has confirmed on this lot beyond what the plan picks.
// was: what the latest confirm promised to that order from this lot, when that differs.
// undecided: the lot has an open conflict, so who takes the cut is not decided yet.
export type PickLine = { lotId: string; product: string; grade: string; deliveryOn: string; total: number; leftOver: number; unit: BaseUnit; undecided: boolean; to: { orderId: string; buyerId: string; amount: number; kind: Allocation["kind"]; was?: number }[] };
export type PickList = { growerId: string; lines: PickLine[] };

export function pickLists(l: Ledger): PickList[] {
  const plan = planOf(l), changed = changedSinceConfirm(l, plan), open = new Set(conflicts(l).map(c => c.lotId));
  const lists = new Map<string, Map<string, PickLine>>();
  for (const a of plan.allocations) {
    const lot = l.snapshot.lots.find(x => x.id === a.lotId)!, order = l.snapshot.orders.find(o => o.id === a.orderId)!;
    const lines = lists.get(lot.growerId) ?? new Map<string, PickLine>();
    const line = lines.get(lot.id) ?? { lotId: lot.id, product: lot.product, grade: lot.grade, deliveryOn: lot.deliveryOn, total: 0, leftOver: normalize(lot.quantity).amount, unit: a.unit, undecided: open.has(lot.id), to: [] };
    const was = changed.find(c => c.orderId === a.orderId && c.lotId === a.lotId)?.was;
    line.total += a.amount; line.leftOver -= a.amount; line.to.push({ orderId: a.orderId, buyerId: order.buyerId, amount: a.amount, kind: a.kind, ...(was !== undefined ? { was } : {}) });
    lines.set(lot.id, line); lists.set(lot.growerId, lines);
  }
  return [...lists].sort(([a], [b]) => cmp(a, b)).map(([growerId, lines]) => ({ growerId, lines: [...lines.values()].sort((a, b) => cmp(a.lotId, b.lotId)) }));
}

// was: what the latest confirm promised on this line, when that differs (0 means newly added).
export type SheetLine = { product: string; grade: string; lotId: string; growerId: string; amount: number; substitute: boolean; was?: number };
export type OrderSheet = { buyerId: string; orderId: string; product: string; deliveryOn: string; ordered: number; unit: BaseUnit; lines: SheetLine[]; short: number; shippedShortUntold: boolean; stage: Stage; undecided: boolean };

export function orderSheets(l: Ledger): OrderSheet[] {
  const plan = planOf(l), changed = changedSinceConfirm(l, plan), cut = new Set(conflicts(l).flatMap(c => c.promises.map(p => p.orderId)));
  return [...l.snapshot.orders].sort((a, b) => cmp(a.id, b.id)).map(o => {
    const q = normalize(o.quantity);
    const mk = (lotId: string, amount: number, was: number | undefined): SheetLine => {
      const lot = l.snapshot.lots.find(x => x.id === lotId)!;
      return { product: lot.product, grade: lot.grade, lotId, growerId: lot.growerId, amount, substitute: lot.product !== o.product, ...(was !== undefined ? { was } : {}) };
    };
    const lines = plan.allocations.filter(a => a.orderId === o.id).map(a => mk(a.lotId, a.amount, changed.find(c => c.orderId === o.id && c.lotId === a.lotId)?.was));
    // Nothing is hidden: a line the latest confirm promised that is now cut to 0 stays, marked with what it was.
    for (const c of changed) if (c.orderId === o.id && c.now === 0) lines.push(mk(c.lotId, 0, c.was));
    lines.sort((a, b) => cmp(a.lotId, b.lotId));
    return {
      buyerId: o.buyerId, orderId: o.id, product: o.product, deliveryOn: o.deliveryOn, ordered: q.amount, unit: q.unit, lines,
      short: plan.unfilled.find(u => u.orderId === o.id)?.amount ?? 0,
      shippedShortUntold: !!l.commitments?.shippedShort.some(s => s.orderId === o.id && !s.buyerTold),
      stage: stageOf(l, o.id).stage, undecided: cut.has(o.id)
    };
  });
}

// The buyers whose sheet lines differ from the latest confirm, so a sheet printed earlier is out of date for them.
export function changedBuyers(l: Ledger): string[] {
  const owner = new Map(l.snapshot.orders.map(o => [o.id, o.buyerId]));
  return [...new Set(changedSinceConfirm(l).map(c => owner.get(c.orderId)).filter((b): b is string => !!b))].sort(cmp);
}
