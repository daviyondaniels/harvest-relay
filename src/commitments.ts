import { digest, proposeAllocations, verifyPlan, type Plan, type Promised } from "./planner.ts";
import { NAME_MAX } from "./hub.ts";
import { normalize, type BaseUnit } from "./quantity.ts";
import { orderStatus, unresolved } from "./resolve.ts";
import type { Ledger } from "./updates.ts";
import { refreshAndApprove, stamp, text, type Workbench } from "./workbench.ts";
import { shortages } from "./orders.ts";

// What the coordinator promised when they confirmed the plan, and what happened to those
// promises since. Promises and the log live beside the snapshot, never inside it, so the
// ledger version and snapshot hash do not move when a promise does. Orders shipped short
// without telling the buyer are kept (docs/EVIDENCE.md E18).
export type Stage = "planned" | "promised" | "packed" | "handed-off";
export type CommitEvent =
  | { kind: "confirmed"; by: string; at: string; promised: Promised[]; shipShort: string[] }
  | { kind: "cut"; by: string; at: string; lotId: string; cuts: { orderId: string; amount: number }[]; suggested: boolean }
  | { kind: "stage"; by: string; at: string; orderId: string; stage: "packed" | "handed-off" };
export type Commitments = {
  promised: Promised[]; // current promises; on any lot they never total more than the lot, except while a conflict is open
  confirmed: { by: string; at: string; promised: Promised[] }; // the latest confirm, the baseline for changed lines
  shippedShort: { orderId: string; amount: number; unit: BaseUnit; buyerTold: false }[];
  log: CommitEvent[];
};
type Cut = { orderId: string; amount: number };
export type Conflict = {
  lotId: string; product: string; unit: BaseUnit;
  lot: number; promisedTotal: number; excess: number; // excess = promisedTotal - lot
  promises: { orderId: string; amount: number; stage: Stage }[];
  suggestion?: Cut[]; // absent when only packed or handed-off orders back the lot
};

// Refusal text for anything that needs the open conflicts settled first; the Pack page matches it.
export const CUT_FIRST = "Decide who takes the cut first";
export const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// Takes from the front of `ids` until `excess` is covered; the amounts are what each order has on the lot.
function take(ids: string[], amounts: Map<string, number>, excess: number): Cut[] {
  const cuts: Cut[] = [];
  for (const orderId of ids) {
    const amount = Math.min(amounts.get(orderId)!, excess);
    if (amount > 0) { cuts.push({ orderId, amount }); excess -= amount; }
  }
  return cuts;
}

// Every lot whose promises total more than the lot now holds, with the cut that would restore it.
// Lowest priority is cut first, then order ID, and only promised orders: packed and handed-off
// orders are never suggested. The provisional cut keeps the plan valid until the coordinator decides.
function open(l: Ledger): (Conflict & { provisional: Cut[] })[] {
  const c = l.commitments, out: (Conflict & { provisional: Cut[] })[] = [];
  if (!c) return out;
  const priority = new Map(l.snapshot.orders.map(o => [o.id, o.priority]));
  const lowest = (a: string, b: string) => (priority.get(a) ?? 0) - (priority.get(b) ?? 0) || cmp(a, b);
  for (const lot of [...l.snapshot.lots].sort((a, b) => cmp(a.id, b.id))) {
    const amounts = new Map<string, number>();
    for (const p of c.promised) if (p.lotId === lot.id) amounts.set(p.orderId, (amounts.get(p.orderId) ?? 0) + p.amount);
    const q = normalize(lot.quantity), total = [...amounts.values()].reduce((n, a) => n + a, 0), excess = total - q.amount;
    if (excess <= 0) continue;
    const ids = [...amounts.keys()].sort(lowest), stages = new Map(ids.map(id => [id, stageOf(l, id).stage]));
    const promisedIds = ids.filter(id => stages.get(id) === "promised");
    const taken = take(promisedIds, amounts, excess), covered = taken.reduce((n, x) => n + x.amount, 0) === excess;
    const suggestion = covered ? taken : undefined;
    out.push({
      lotId: lot.id, product: lot.product, unit: q.unit, lot: q.amount, promisedTotal: total, excess,
      promises: [...ids].sort(cmp).map(orderId => ({ orderId, amount: amounts.get(orderId)!, stage: stages.get(orderId)! })),
      ...(suggestion ? { suggestion } : {}), provisional: suggestion ?? take(ids, amounts, excess)
    });
  }
  return out;
}

export function conflicts(l: Ledger): Conflict[] {
  return open(l).map(({ provisional: _, ...c }) => c);
}

// The promises the plan must honour: the recorded ones with each open conflict's provisional cut applied.
export function held(l: Ledger): Promised[] {
  const cut = new Map<string, number>();
  for (const c of open(l)) for (const x of c.provisional) cut.set(`${c.lotId}\n${x.orderId}`, x.amount);
  return (l.commitments?.promised ?? []).flatMap(p => {
    const k = `${p.lotId}\n${p.orderId}`, cutNow = Math.min(p.amount, cut.get(k) ?? 0), amount = p.amount - cutNow;
    cut.set(k, (cut.get(k) ?? 0) - cutNow);
    return amount > 0 ? [{ ...p, amount }] : [];
  });
}

export function planOf(l: Ledger): Plan {
  const promised = held(l), plan = proposeAllocations(l.snapshot, promised);
  verifyPlan(l.snapshot, plan, promised);
  return plan;
}

// Blocking: orders still short with no way out recorded, and orders named in an open conflict.
// Warnings: inbox items nobody has settled yet; they never block, because the plan is built from
// approved updates only.
export function lockGate(w: Workbench): { blocking: string[]; warnings: string[] } {
  const cut = conflicts(w.ledger).flatMap(c => c.promises.map(p => p.orderId));
  return { blocking: [...new Set([...unresolved(w), ...cut.sort(cmp)])], warnings: w.items.filter(i => i.state === "open" || i.state === "pending" || i.state === "returned").map(i => i.id) };
}

// Confirms the live plan, approved substitutions included: every allocation becomes a promise. With
// Ship short the coordinator accepts the blocking shortfalls, and they are recorded as not told to the buyer.
export function confirmPlan(w: Workbench, by: string, at: string, opts: { shipShort: boolean }): Workbench {
  const who = text(by, NAME_MAX, "Actor name"), when = stamp(at);
  if (conflicts(w.ledger).length) throw new Error(CUT_FIRST);
  const { blocking } = lockGate(w);
  if (blocking.length && !opts.shipShort) throw new Error(`Orders still to resolve: ${blocking.join(", ")}. Resolve them, or tick “Ship these orders short” to confirm anyway.`);
  const plan = planOf(w.ledger), promised: Promised[] = [];
  for (const a of plan.allocations) {
    const same = promised.find(p => p.orderId === a.orderId && p.lotId === a.lotId && p.kind === a.kind);
    if (same) same.amount += a.amount; else promised.push({ orderId: a.orderId, lotId: a.lotId, amount: a.amount, unit: a.unit, kind: a.kind });
  }
  const shippedShort = plan.unfilled.filter(u => orderStatus(w, u.orderId) !== "buyer-told" && (!opts.shipShort || blocking.includes(u.orderId)))
    .map(u => ({ orderId: u.orderId, amount: u.amount, unit: u.unit, buyerTold: false as const }));
  const next = structuredClone(w), log = next.ledger.commitments?.log ?? [];
  // An earlier shipped-short record stays as it was written (measures count it once), even if supply has since filled the order.
  const kept = next.ledger.commitments?.shippedShort ?? [];
  const allShort = [...kept, ...shippedShort.filter(s => !kept.some(k => k.orderId === s.orderId))];
  next.ledger.commitments = {
    promised, confirmed: { by: who, at: when, promised: structuredClone(promised) }, shippedShort: allShort,
    log: [...log, { kind: "confirmed", by: who, at: when, promised: structuredClone(promised), shipShort: shippedShort.map(s => s.orderId) }]
  };
  return next;
}

// The coordinator's recorded cut for one conflict. `excess` is what the form showed: if supply moved
// since, it no longer matches and nothing changes. Any order on the lot may take the cut.
export function decideCut(w: Workbench, lotId: string, cuts: Cut[], excess: number, by: string, at: string): Workbench {
  const who = text(by, NAME_MAX, "Actor name"), when = stamp(at), c = open(w.ledger).find(x => x.lotId === lotId);
  if (!c || c.excess !== excess) throw new Error("Supply changed since this was shown");
  if (!Array.isArray(cuts) || cuts.some(x => !Number.isSafeInteger(x?.amount) || x.amount < 0)) throw new Error("Each cut must be a whole number of pounds");
  const kept = cuts.filter(x => x.amount > 0);
  if (new Set(kept.map(x => x.orderId)).size !== kept.length) throw new Error("Name each order once");
  if (kept.reduce((n, x) => n + x.amount, 0) !== c.excess) throw new Error(`The cuts must total exactly ${c.excess}`);
  for (const x of kept) if (x.amount > (c.promises.find(p => p.orderId === x.orderId)?.amount ?? 0)) throw new Error("A cut is more than that order's promise on this lot");
  const same = (a: Cut[], b: Cut[]) => JSON.stringify([...a].sort((x, y) => cmp(x.orderId, y.orderId))) === JSON.stringify([...b].sort((x, y) => cmp(x.orderId, y.orderId)));
  const suggested = !!c.suggestion && same(kept, c.suggestion);
  const next = structuredClone(w), m = next.ledger.commitments!;
  for (const x of kept) {
    let left = x.amount;
    for (const p of m.promised) if (p.lotId === lotId && p.orderId === x.orderId && left > 0) { const t = Math.min(p.amount, left); p.amount -= t; left -= t; }
  }
  m.promised = m.promised.filter(p => p.amount > 0);
  m.log.push({ kind: "cut", by: who, at: when, lotId, cuts: structuredClone(kept), suggested });
  return next;
}

// confirmedBefore: some confirm promised this order something, so one cut to 0 since is still "promised".
export function stageOf(l: Ledger, orderId: string): { stage: Stage; promised: number; ordered: number; unit: BaseUnit; confirmedBefore: boolean } {
  const order = l.snapshot.orders.find(o => o.id === orderId);
  if (!order) throw new Error("Unknown order");
  const q = normalize(order.quantity), c = l.commitments;
  const promised = (c?.promised ?? []).filter(p => p.orderId === orderId).reduce((n, p) => n + p.amount, 0);
  const marked = [...(c?.log ?? [])].reverse().find(e => e.kind === "stage" && e.orderId === orderId);
  const confirmedBefore = (c?.log ?? []).some(e => e.kind === "confirmed" && e.promised.some(p => p.orderId === orderId));
  return { stage: marked?.kind === "stage" ? marked.stage : promised > 0 || confirmedBefore ? "promised" : "planned", promised, ordered: q.amount, unit: q.unit, confirmedBefore };
}

// Packed needs a promise that no open conflict touches; handed off needs packed.
export function markStage(w: Workbench, orderId: string, stage: "packed" | "handed-off", by: string, at: string): Workbench {
  const who = text(by, NAME_MAX, "Actor name"), when = stamp(at), now = stageOf(w.ledger, orderId).stage;
  if (stage === "packed") {
    if (now !== "promised" || stageOf(w.ledger, orderId).promised === 0) throw new Error("Only a promised order can be packed");
    if (conflicts(w.ledger).some(c => c.promises.some(p => p.orderId === orderId))) throw new Error(CUT_FIRST);
  } else if (stage === "handed-off") {
    if (now !== "packed") throw new Error("Only a packed order can be handed off");
  } else throw new Error("Unknown stage");
  const next = structuredClone(w);
  next.ledger.commitments!.log.push({ kind: "stage", by: who, at: when, orderId, stage });
  return next;
}

// The orders that could take this stage now, by exactly the rules of markStage (stage order, open cuts).
// It probes markStage with a placeholder name and time, so it stays exact only while markStage
// checks neither against the confirm.
export function stageable(w: Workbench, stage: "packed" | "handed-off"): string[] {
  return w.ledger.snapshot.orders.filter(o => { try { markStage(w, o.id, stage, "x", "2000-01-01T00:00:00.000Z"); return true; } catch { return false; } }).map(o => o.id);
}
// Marks every order that can take the stage, and skips the rest. Nothing to mark is a refusal, not a silent success.
// only: the orders the page counted; with it, an order the page never showed is not marked even if it could be.
export function markAllStage(w: Workbench, stage: "packed" | "handed-off", by: string, at: string, only?: string[]): { next: Workbench; marked: string[] } {
  text(by, NAME_MAX, "Actor name"); stamp(at);
  const marked = stageable(w, stage).filter(id => !only || only.includes(id));
  if (marked.length === 0) throw new Error(`No order can be marked ${stage === "packed" ? "packed" : "handed off"} right now.`);
  return { next: marked.reduce((n, id) => markStage(n, id, stage, by, at), w), marked };
}

// Lines whose amount differs from the latest confirm; now 0 means the line is gone, was 0 that it is new.
export type ChangedLine = { orderId: string; lotId: string; was: number; now: number; unit: BaseUnit };
export function changedSinceConfirm(l: Ledger, plan = planOf(l)): ChangedLine[] {
  if (!l.commitments) return [];
  const sum = (xs: { orderId: string; lotId: string; amount: number; unit: BaseUnit }[]) => {
    const m = new Map<string, { orderId: string; lotId: string; amount: number; unit: BaseUnit }>();
    for (const x of xs) { const k = `${x.orderId}\n${x.lotId}`, g = m.get(k) ?? { orderId: x.orderId, lotId: x.lotId, amount: 0, unit: x.unit }; g.amount += x.amount; m.set(k, g); }
    return m;
  };
  const was = sum(l.commitments.confirmed.promised), now = sum(plan.allocations), out: ChangedLine[] = [];
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(k)?.amount ?? 0, b = now.get(k)?.amount ?? 0, x = (now.get(k) ?? was.get(k))!;
    if (a !== b) out.push({ orderId: x.orderId, lotId: x.lotId, was: a, now: b, unit: x.unit });
  }
  return out.sort((a, b) => cmp(a.orderId, b.orderId) || cmp(a.lotId, b.lotId));
}

// What a page's promises looked like: the current promises, the latest confirm and the shipped-short record.
// Stage marks are left out, so marking another order packed in another tab does not change it; a confirm or a
// cut decision does. Neither moves the ledger version or the snapshot hash, so a form carries this beside them.
export const commitKey = (l: Ledger): string => {
  const c = l.commitments;
  return digest(c ? { promised: c.promised, confirmed: c.confirmed, shippedShort: c.shippedShort } : null);
};
// Raised when a form's page showed other promises than the ones now stored, and acting would make things worse.
export class PromisesMoved extends Error {}
// Whether a change opened a cut that was not open, deepened one, or left an order short or shorter.
export function madeWorse(before: Workbench, after: Workbench): boolean {
  const was = new Map(conflicts(before.ledger).map(c => [c.lotId, c.excess]));
  if (conflicts(after.ledger).some(c => c.excess > (was.get(c.lotId) ?? 0))) return true;
  const short = new Map(shortages(before.ledger).map(s => [s.orderId, s.short]));
  return shortages(after.ledger).some(s => s.short > (short.get(s.orderId) ?? 0));
}
// Approve on a state that may be newer than the page's (a rebase). seen: commitKey of the state the page was
// rendered from. The review hash covers the proposal, version and snapshot but not the promises, so when the
// promises moved since the page (the plan was confirmed or a cut decided in another tab) the approval is made
// only if it opens no cut and leaves nobody newly short; else the coordinator looks again.
export function approveRebased(w: Workbench, id: string, reviewer: string, reviewHash: string, seen: string | undefined, at: string): Workbench {
  const next = refreshAndApprove(w, id, reviewer, reviewHash, at);
  if (seen !== commitKey(w.ledger) && madeWorse(w, next)) throw new PromisesMoved("The promises changed");
  return next;
}
