import { planOf } from "../../src/commitments.ts";
import { normalize } from "../../src/quantity.ts";
import { preview, type InboxItem, type OrderImpact, type Preview, type Workbench } from "../../src/workbench.ts";

// Read models for the pages, computed from the stored workbench on every request.
export type ProductRow = { product: string; supply: number; ordered: number; direct: number; substitutedIn: number; short: number; unallocated: number; forecast: number };
export function overview(w: Workbench) {
  const s = w.ledger.snapshot, plan = planOf(w.ledger);
  const products = [...new Set([...s.lots.map(l => l.product), ...s.orders.map(o => o.product)])].sort();
  const lotProduct = new Map(s.lots.map(l => [l.id, l.product]));
  const rows: ProductRow[] = products.map(product => {
    const lots = s.lots.filter(l => l.product === product && l.confirmed), orders = s.orders.filter(o => o.product === product);
    const ids = new Set(orders.map(o => o.id));
    return {
      product,
      supply: lots.reduce((n, l) => n + normalize(l.quantity).amount, 0),
      ordered: orders.reduce((n, o) => n + normalize(o.quantity).amount, 0),
      direct: plan.allocations.filter(a => ids.has(a.orderId) && a.kind === "requested").reduce((n, a) => n + a.amount, 0),
      substitutedIn: plan.allocations.filter(a => ids.has(a.orderId) && a.kind === "approved-substitution").reduce((n, a) => n + a.amount, 0),
      short: plan.unfilled.filter(u => ids.has(u.orderId)).reduce((n, u) => n + u.amount, 0),
      unallocated: plan.unallocated.filter(u => lotProduct.get(u.lotId) === product).reduce((n, u) => n + u.amount, 0),
      forecast: w.ledger.forecasts.filter(f => lotProduct.get(f.lotId) === product).reduce((n, f) => n + f.amount, 0)
    };
  });
  const previews = new Map<string, Preview>(w.items.map(i => [i.id, preview(w, i.id)]));
  return { plan, rows, previews };
}
export const questionCounts = (previews: Map<string, Preview>) =>
  new Map([...previews].map(([id, p]) => [id, new Set(p.questions.map(q => q.field)).size + (p.error && !p.needsRefresh ? 1 : 0)]));

// Unread messages that arrived after the latest confirm of the plan, newest first-seen order kept.
// With no confirm yet, nothing is "new since" it.
export function newSinceConfirm(w: Workbench): InboxItem[] {
  const at = w.ledger.commitments?.confirmed.at;
  if (!at) return [];
  const t = Date.parse(at);
  return w.items.filter(i => i.state === "open" && Date.parse(i.receivedAt) > t);
}
// A message that may be dismissed in one tap from the Overview: read, and read as no supply change.
// An unread message (a late harvest drop, say) is never dismissed unread; it links to Review.
export const dismissable = (i: InboxItem): boolean => !!i.proposal && i.proposal.interpretation.operation === "unresolved";
// An update that can be approved from where it is shown: it has a change, nothing is asked,
// and the review is current (a stale one is refreshed on the Review page first).
export const readyToApprove = (i: InboxItem, p: Preview | undefined): p is Preview & { change: NonNullable<Preview["change"]>; reviewHash: string } =>
  !!i.proposal && !!p && !!p.change && !!p.reviewHash && p.questions.length === 0 && !p.error && !p.needsRefresh;
// The orders an approval would leave short, or shorter than they are now.
export const becomesShort = (p: Preview): OrderImpact[] => p.orders.filter(o => o.after.short > o.before.short);
