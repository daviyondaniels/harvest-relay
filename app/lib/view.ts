import { changedSinceConfirm, planOf, stageOf } from "../../src/commitments.ts";
import { shortages } from "../../src/orders.ts";
import { buyer, changeLine, grower, weight } from "./format.ts";
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
// A message that may be dismissed in one tap from the Overview: read, and naming no lot or no
// amount. A real update with open questions (a lot and an amount, but unclear on case size) is
// never dismissed from here; it links to Review. An unread message is never dismissed unread.
export const dismissable = (i: InboxItem): boolean => !!i.proposal && (!i.proposal.interpretation.lotId || !i.proposal.interpretation.quantity);
// The order the Overview lists what needs the coordinator: a cut to settle, a short order, an
// update ready to approve, an update with questions, then a message that can be dismissed.
export type AttentionKind = "cut" | "short" | "ready" | "asks" | "dismiss";
const ATTENTION: AttentionKind[] = ["cut", "short", "ready", "asks", "dismiss"];
export const ATTENTION_ROWS = 8;
export const updateKind = (i: InboxItem, p: Preview | undefined): "ready" | "asks" | "dismiss" => readyToApprove(i, p) ? "ready" : dismissable(i) ? "dismiss" : "asks";
// Stable: rows of one kind keep the order they came in.
export const byAttention = <T extends { kind: AttentionKind }>(xs: T[]): T[] => ATTENTION.flatMap(k => xs.filter(x => x.kind === k));
// How far the confirmed plan has got: orders packed (handed-off ones count), orders handed off, of all orders.
export function stageCounts(w: Workbench): { packed: number; handed: number; total: number } {
  const orders = w.ledger.snapshot.orders, stages = orders.map(o => stageOf(w.ledger, o.id).stage);
  return { packed: stages.filter(x => x === "packed" || x === "handed-off").length, handed: stages.filter(x => x === "handed-off").length, total: orders.length };
}
// The plan has changed since it was confirmed, or planned supply nobody has been promised yet.
export function staleSinceConfirm(w: Workbench): boolean {
  const l = w.ledger, plan = planOf(l);
  if (!l.commitments) return false;
  return changedSinceConfirm(l, plan).length > 0 || l.snapshot.orders.some(o => plan.allocations.filter(a => a.orderId === o.id).reduce((n, a) => n + a.amount, 0) > stageOf(l, o.id).promised);
}
export const unsettledLine = (n: number) => `${n === 1 ? "1 grower update" : `${n} grower updates`} not settled. The plan uses approved updates only, so this does not block confirming.`;
// An update that can be approved from where it is shown: it has a change, nothing is asked,
// and the review is current (a stale one is refreshed on the Review page first).
export const readyToApprove = (i: InboxItem, p: Preview | undefined): p is Preview & { change: NonNullable<Preview["change"]>; reviewHash: string } =>
  !!i.proposal && !!p && !!p.change && !!p.reviewHash && p.questions.length === 0 && !p.error && !p.needsRefresh;
// The orders an approval would leave short, or shorter than they are now.
export const becomesShort = (p: Preview): OrderImpact[] => p.orders.filter(o => o.after.short > o.before.short);

// Orders short now, by order, for comparing before and after an approval.
export const shortMap = (w: Workbench): Map<string, number> => new Map(shortages(w.ledger).map(s => [s.orderId, s.short]));
// What an approval changed, said in plain words: the lot before and after, and each buyer who is now
// short or shorter. res: where to go next, as "order:<id>" for the first such buyer.
export function approvalResult(w: Workbench, item: string, before: Map<string, number>): { text: string; res?: string } {
  const e = w.ledger.events.find(x => x.id === w.items.find(i => i.id === item)?.eventId);
  if (!e) return { text: "Supply change approved." };
  const lot = w.ledger.snapshot.lots.find(l => l.id === e.lotId);
  const worse = shortages(w.ledger).filter(g => g.short > (before.get(g.orderId) ?? 0));
  const name = lot ? `${lot.product} from ${grower(lot.growerId)}` : "Supply", head = `${name[0].toUpperCase()}${name.slice(1)}: ${changeLine(e.lotBefore, e.lotAfter)}.`;
  const tail = worse.map(g => ` ${buyer(g.buyerId)} is now ${weight(g.short, g.unit)} short.`).join("");
  return { text: head + tail, ...(worse[0] ? { res: `order:${worse[0].orderId}` } : {}) };
}
