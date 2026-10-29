import { proposeAllocations, verifyPlan } from "../../src/planner.ts";
import { normalize } from "../../src/quantity.ts";
import { preview, type Preview, type Workbench } from "../../src/workbench.ts";

// Read models for the pages, computed from the stored workbench on every request.
export type ProductRow = { product: string; supply: number; ordered: number; direct: number; substitutedIn: number; short: number; unallocated: number; forecast: number };
export function overview(w: Workbench) {
  const s = w.ledger.snapshot, plan = proposeAllocations(s);
  verifyPlan(s, plan);
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
