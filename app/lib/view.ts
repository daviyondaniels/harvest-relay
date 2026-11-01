import { changedSinceConfirm, planOf, stageOf } from "../../src/commitments.ts";
import { shortages } from "../../src/orders.ts";
import { changedBuyers } from "../../src/pack.ts";
import { buyer, changeLine, grower, time, weight } from "./format.ts";
import { normalize } from "../../src/quantity.ts";
import { BY_HAND, preview, type InboxItem, type OrderImpact, type Preview, type Workbench } from "../../src/workbench.ts";

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
// update not checked yet (unread, or read by hand) so a late message shows above the routine
// approvals, an update ready to approve, an update with questions, then a message that can be dismissed.
export type AttentionKind = "cut" | "short" | "unchecked" | "ready" | "asks" | "dismiss";
const ATTENTION: AttentionKind[] = ["cut", "short", "unchecked", "ready", "asks", "dismiss"];
export const ATTENTION_ROWS = 8;
export const updateKind = (i: InboxItem, p: Preview | undefined): "unchecked" | "ready" | "asks" | "dismiss" =>
  !i.proposal || (i.interpretedBy === BY_HAND && !dismissable(i)) ? "unchecked" : readyToApprove(i, p) ? "ready" : dismissable(i) ? "dismiss" : "asks";
// Stable: rows of one kind keep the order they came in.
export const byAttention = <T extends { kind: AttentionKind }>(xs: T[]): T[] => ATTENTION.flatMap(k => xs.filter(x => x.kind === k));
// A message read as naming no lot or no amount, whose words give orders instead of a harvest figure.
// The rule is on the reading (unresolved, with no amount) plus a plain word test on the text; it
// never calls a model.
export const INSTRUCTION_WORDS = /\b(ignore|disregard|override|system|instructions?|your rules|you must|approve (all|every|\d))\b/i;
export const INSTRUCTION_LABEL = "Looks like an instruction, not a harvest update";
export const instructionLike = (i: InboxItem): boolean => {
  const r = i.proposal?.interpretation;
  return !!r && r.operation === "unresolved" && !r.quantity && INSTRUCTION_WORDS.test(i.source.text);
};
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

// Waiting updates that could be approved from where they are but would leave an order short, with
// the first such order each. Confirm is only offered when this is empty. The same preview as Review.
export type Leaves = { item: InboxItem; order: OrderImpact };
export function leavesShort(w: Workbench, previews: Map<string, Preview>): Leaves[] {
  return w.items.filter(i => i.state !== "approved" && i.state !== "dismissed").flatMap(item => {
    const p = previews.get(item.id), order = item.proposal && p && readyToApprove(item, p) ? becomesShort(p)[0] : undefined;
    return order ? [{ item, order }] : [];
  });
}
// Why the cut lands where the preview says. Once the plan is confirmed, each order keeps what it was
// promised from each lot, so when a lot drops the order promised from that lot takes the cut first; before
// the confirm the cut falls by priority. Undefined when no promise explains it.
export function cutReason(w: Workbench, p: Preview, buyerOf: (orderId: string) => string): string | undefined {
  const lotId = p.change?.lotId, promised = w.ledger.commitments?.promised ?? [];
  if (!lotId || p.change?.effect === "forecast") return undefined;
  const hit = becomesShort(p).filter(o => promised.some(x => x.orderId === o.orderId && x.lotId === lotId && x.kind === "requested"));
  if (!hit.length) return undefined;
  const names = hit.map(o => buyerOf(o.orderId)), other = p.orders.some(o => !hit.includes(o) && promised.some(x => x.orderId === o.orderId && x.lotId !== lotId));
  return `${names.join(" and ")}'s ${hit.length === 1 ? "order was" : "orders were"} confirmed against this lot, so ${hit.length === 1 ? "it takes" : "they take"} the cut first${other ? ", not the buyers promised from other lots" : ""}. After you approve you can move the cut to another buyer.`;
}

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

// The stale plan, said once for the Overview and Pack: what changed and who a printed sheet is wrong for.
export const STALE_HEADING = "Printed sheets are out of date";
export function staleSentence(w: Workbench): string {
  const at = w.ledger.commitments?.confirmed.at, behind = changedBuyers(w.ledger).map(buyer);
  const who = at && behind.length ? ` Sheets printed from the plan confirmed at ${time(at)} are wrong for: ${behind.join(", ")}.` : "";
  return `The plan has changed since you confirmed it.${who} Confirm again to promise the new amounts.`;
}
