import type { Contact } from "./demo.ts";
import { planOf } from "./commitments.ts";
import { snapshotHash, validateSnapshot, type Lot } from "./planner.ts";
import { NAME_MAX } from "./hub.ts";
import { normalize, type BaseUnit } from "./quantity.ts";
import type { Evidence, Ledger, LedgerRecord } from "./updates.ts";
import type { InboxItem, Workbench } from "./workbench.ts";

// maxAmount caps what the buyer agreed to, in the order's base unit; standing permission has none.
type Substitute = { product: string; acceptedGrades: string[]; maxAmount?: number };

function check(evidence: Evidence, recordedBy: string): Evidence {
  const quote = typeof evidence?.quote === "string" ? evidence.quote.trim().slice(0, 500) : "";
  if (!quote) throw new Error("Evidence quote required");
  if (typeof evidence.messageId !== "string" || !evidence.messageId.trim() || evidence.messageId.length > 160) throw new Error("Evidence message ID required");
  if (evidence.channel !== "text" && evidence.channel !== "call") throw new Error("Evidence channel must be text or call");
  if (typeof recordedBy !== "string" || !recordedBy.trim() || recordedBy.length > NAME_MAX) throw new Error("Named recorder required");
  return { messageId: evidence.messageId, channel: evidence.channel, quote };
}
// Pure: clones the snapshot, applies the change, bumps both versions and validates.
function commit(l: Ledger, change: (s: Ledger["snapshot"]) => void, record: (id: string, before: string, after: string) => LedgerRecord): Ledger {
  const snapshot = structuredClone(l.snapshot), beforeHash = snapshotHash(l.snapshot);
  change(snapshot); snapshot.version += 1; validateSnapshot(snapshot);
  const r = record(`record-${l.records.length + 1}`, beforeHash, snapshotHash(snapshot));
  return structuredClone({ ...l, version: l.version + 1, snapshot, records: [...l.records, r] });
}

// Consent recorded from the buyer's reply (docs/EVIDENCE.md E8, E9).
export function acceptSubstitute(l: Ledger, orderId: string, substitute: Substitute, evidence: Evidence, recordedBy: string): Ledger {
  const e = check(evidence, recordedBy), order = l.snapshot.orders.find(o => o.id === orderId);
  if (!order) throw new Error("Unknown order");
  if (substitute?.product === order.product) throw new Error("Substitute is the order's own product");
  if (substitute.maxAmount !== undefined && (!Number.isSafeInteger(substitute.maxAmount) || substitute.maxAmount <= 0)) throw new Error("The substitute cap must be a positive whole number");
  const sub: { product: string; acceptedGrades: string[]; maxAmount?: number } = { product: substitute.product, acceptedGrades: [...substitute.acceptedGrades], ...(substitute.maxAmount !== undefined ? { maxAmount: substitute.maxAmount } : {}) };
  // The cap is on the product across all grades: 30 lb of grade A plus 20 lb of grade B is a 50 lb total that
  // may all come from A. The buyer agreed to a quantity of the substitute; grades are the hub's quality labels.
  // An agreement already on the order changes only by raising its cap or lifting it; each change is its own record.
  const held = order.approvedSubstitutions.find(s => s.product === substitute.product);
  let change: "raised" | "uncapped" | "grade-added" | undefined;
  if (held) {
    if (held.maxAmount === undefined) throw new Error("Substitute already allowed for this order without a cap");
    if (sub.maxAmount === undefined) change = "uncapped";
    else if (sub.maxAmount > held.maxAmount) change = "raised";
    else if (sub.maxAmount === held.maxAmount && sub.acceptedGrades.some(g => !held.acceptedGrades.includes(g))) change = "grade-added";
    else throw new Error(`Substitute already allowed for this order up to ${held.maxAmount}; a cap can only be raised, or a new grade added at the same cap`);
    sub.acceptedGrades = [...new Set([...held.acceptedGrades, ...sub.acceptedGrades])];
  }
  const previousMax = held?.maxAmount;
  return commit(l, s => {
    const o = s.orders.find(x => x.id === orderId)!, i = o.approvedSubstitutions.findIndex(x => x.product === sub.product);
    if (i >= 0) o.approvedSubstitutions[i] = structuredClone(sub); else o.approvedSubstitutions.push(structuredClone(sub));
  }, (id, beforeHash, afterHash) => ({ id, kind: "substitute-accepted", orderId, substitute: sub, ...(change ? { change, previousMax } : {}), evidence: e, recordedBy, beforeHash, afterHash }));
}

// A new lot from a grower or outside source with no lot; duplicates fail validation.
export function addLot(l: Ledger, lot: Lot, evidence: Evidence, recordedBy: string): Ledger {
  const e = check(evidence, recordedBy);
  return commit(l, s => { s.lots.push(structuredClone(lot)); },
    (id, beforeHash, afterHash) => ({ id, kind: "lot-added", lot: structuredClone(lot), evidence: e, recordedBy, beforeHash, afterHash }));
}

export function permissionSource(l: Ledger, orderId: string, product: string): { kind: "on-file" } | { kind: "agreed"; record: LedgerRecord } {
  const order = l.snapshot.orders.find(o => o.id === orderId);
  if (!order) throw new Error("Unknown order");
  if (!order.approvedSubstitutions.some(s => s.product === product)) throw new Error("No permission for this product on the order");
  const record = l.records.findLast(r => r.kind === "substitute-accepted" && r.orderId === orderId && r.substitute.product === product);
  return record ? { kind: "agreed", record: structuredClone(record) } : { kind: "on-file" };
}

export type Shortage = { orderId: string; buyerId: string; product: string; deliveryOn: string; unit: BaseUnit; short: number };
export type Option =
  | { kind: "ask-grower"; contactId: string; hasLot: true; lotId: string; amount: number; unit: BaseUnit; reducedRecently: boolean }
  | { kind: "ask-grower"; contactId: string; hasLot: false; contactKind: "member" | "outside"; amount: number; unit: BaseUnit }
  | { kind: "offer-substitute"; product: string; grade: string; covers: number; unit: BaseUnit }
  | { kind: "notify-short"; amount: number; unit: BaseUnit };

export function shortages(l: Ledger): Shortage[] {
  return planOf(l).unfilled.map(u => {
    const o = l.snapshot.orders.find(x => x.id === u.orderId)!;
    return { orderId: o.id, buyerId: o.buyerId, product: o.product, deliveryOn: o.deliveryOn, unit: u.unit, short: u.amount };
  }).sort((a, b) => a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0);
}

// Coordinators cover shorts by calling the grower with the product, then other members, then outside sources (docs/EVIDENCE.md E5).
export function options(l: Ledger, orderId: string, contacts: Contact[]): Option[] {
  const order = l.snapshot.orders.find(o => o.id === orderId);
  if (!order) throw new Error("Unknown order");
  const gap = shortages(l).find(s => s.orderId === orderId);
  if (!gap) return [];
  const { unit, short } = gap, out: Option[] = [];
  const lots = l.snapshot.lots.filter(x => x.product === order.product && order.acceptedGrades.includes(x.grade) && x.deliveryOn === order.deliveryOn &&
    x.confirmed && normalize(x.quantity).unit === unit).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const lot of lots) out.push({ kind: "ask-grower", contactId: lot.growerId, hasLot: true, lotId: lot.id, amount: short, unit, reducedRecently: reduced(l, lot.id) });
  const withLot = new Set(lots.map(x => x.growerId));
  for (const kind of ["member", "outside"] as const)
    for (const c of contacts) if (c.kind === kind && !withLot.has(c.id)) out.push({ kind: "ask-grower", contactId: c.id, hasLot: false, contactKind: kind, amount: short, unit });
  const spare = new Map<string, { product: string; grade: string; sum: number }>(), byId = new Map(l.snapshot.lots.map(x => [x.id, x]));
  for (const u of planOf(l).unallocated) {
    const lot = byId.get(u.lotId)!;
    if (!u.confirmed || u.unit !== unit || lot.deliveryOn !== order.deliveryOn || lot.product === order.product || order.approvedSubstitutions.some(s => s.product === lot.product && s.maxAmount === undefined)) continue;
    const key = JSON.stringify([lot.product, lot.grade]), g = spare.get(key) ?? { product: lot.product, grade: lot.grade, sum: 0 };
    g.sum += u.amount; spare.set(key, g);
  }
  [...spare.values()].sort((a, b) => a.product < b.product ? -1 : a.product > b.product ? 1 : a.grade < b.grade ? -1 : a.grade > b.grade ? 1 : 0)
    .forEach(g => out.push({ kind: "offer-substitute", product: g.product, grade: g.grade, covers: Math.min(short, g.sum), unit }));
  out.push({ kind: "notify-short", amount: short, unit });
  return out;
}

// What the page recommends: one of the options, or reading a reply that is already waiting.
export type Recommendation = Option | { kind: "review-reply"; contactId: string; itemId: string };

// The one next step, in the hubs' own order of moves (docs/EVIDENCE.md E4-E6). A sent ask whose reply is
// waiting in Review comes first: read it before asking anyone else. Then a grower who holds the product and
// was not cut recently (largest lot first); a substitute covering at least a quarter of the short (the one covering
// most) unless the buyer already declined it for this order; another grower or outside source; telling the
// buyer. A grower whose pending update lowers the lot is not asked for it. A contact who already answered an ask for this order is not asked again for it. Ties go by id.
export function recommend(w: Workbench, orderId: string, contacts: Contact[]): Recommendation | undefined {
  const l = w.ledger, opts = options(l, orderId, contacts);
  if (!opts.length) return undefined;
  const mine = w.resolutions.filter(r => r.orderId === orderId && r.option.kind === "ask-grower");
  const waiting = mine.map(r => ({ r, item: w.items.find(i => i.id === r.linkedItemId) })).find(x => x.r.status === "sent" && x.item && x.item.state !== "approved" && x.item.state !== "dismissed");
  if (waiting) return { kind: "review-reply", contactId: waiting.item!.source.growerId, itemId: waiting.item!.id };
  const answered = new Set(mine.filter(r => r.linkedItemId || r.status === "accepted" || r.status === "declined").map(r => (r.option as Extract<Option, { kind: "ask-grower" }>).contactId));
  const short = opts.find(o => o.kind === "notify-short")!.amount, lots = new Map(l.snapshot.lots.map(x => [x.id, x]));
  const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0, size = (id: string) => normalize(lots.get(id)!.quantity).amount;
  const holders = opts.filter((o): o is Extract<Option, { hasLot: true }> => o.kind === "ask-grower" && o.hasLot && !answered.has(o.contactId) && !cutByPending(w, o.lotId));
  const best = holders.filter(o => !o.reducedRecently).sort((a, b) => size(b.lotId) - size(a.lotId) || byId(a.lotId, b.lotId))[0];
  if (best) return best;
  const refused = new Set(w.resolutions.filter(r => r.orderId === orderId && r.option.kind === "offer-substitute" && r.status === "declined")
    .map(r => JSON.stringify([(r.option as Extract<Option, { kind: "offer-substitute" }>).product, (r.option as Extract<Option, { kind: "offer-substitute" }>).grade])));
  const subs = opts.filter((o): o is Extract<Option, { kind: "offer-substitute" }> => o.kind === "offer-substitute" && o.covers * 4 >= short && !refused.has(JSON.stringify([o.product, o.grade])))
    .sort((a, b) => b.covers - a.covers || byId(a.product, b.product) || byId(a.grade, b.grade));
  if (subs[0]) return subs[0];
  const others = opts.filter((o): o is Extract<Option, { hasLot: false }> => o.kind === "ask-grower" && !o.hasLot && !answered.has(o.contactId))
    .sort((a, b) => byId(a.contactKind, b.contactKind) || byId(a.contactId, b.contactId));
  return others[0] ?? holders.sort((a, b) => byId(a.lotId, b.lotId))[0] ?? opts.find(o => o.kind === "notify-short");
}

// An update waiting in Review from the lot's own grower that would lower the lot: asking them for more now
// would ask about a lot they have just said is smaller. It is read first (pendingCover), not asked past.
function cutByPending(w: Workbench, lotId: string): boolean {
  const lot = w.ledger.snapshot.lots.find(l => l.id === lotId);
  if (!lot) return false;
  return w.items.some(i => {
    const p = i.proposal?.interpretation;
    if (i.state === "approved" || i.state === "dismissed" || i.source.growerId !== lot.growerId || !p || p.lotId !== lotId || !p.quantity) return false;
    if (p.operation !== "replace-total" && p.operation !== "correction") return false;
    try { const a = normalize(p.quantity), b = normalize(lot.quantity); return a.unit === b.unit && a.amount < b.amount; } catch { return false; }
  });
}

// Latest grower update (forecasts excluded) that lowered the lot.
function reduced(l: Ledger, lotId: string): boolean {
  const e = l.events.filter(x => x.lotId === lotId && x.effect !== "forecast").at(-1);
  return !!e && normalize(e.lotAfter).amount < normalize(e.lotBefore).amount;
}

// Could this unreviewed message raise supply of the order's product? An unread message might.
// A reading counts when it adds, or sets a total above the lot it names (or names no lot, or a
// quantity that cannot be compared). Forecasts, corrections and cuts cannot cover a shortfall.
function couldRaise(i: InboxItem, lots: Lot[]): boolean {
  const p = i.proposal?.interpretation;
  if (!p) return true;
  if (p.operation === "add-quantity") return true;
  if (p.operation !== "replace-total") return false;
  const lot = lots.find(l => l.id === p.lotId);
  if (!lot || !p.quantity) return true;
  try { const a = normalize(p.quantity), b = normalize(lot.quantity); return a.unit !== b.unit || a.amount > b.amount; }
  catch { return true; }
}

// Updates not yet reviewed, from growers who hold this order's product, that could raise its
// supply: one of them may already cover the shortfall, so the coordinator reads it before calling
// anyone. Grouped by grower, in the order the first of each arrived. An update that is plainly
// about another product, or that cannot raise supply, is left out.
export function pendingCover(w: Workbench, orderId: string): { growerId: string; items: InboxItem[] }[] {
  const order = w.ledger.snapshot.orders.find(o => o.id === orderId);
  if (!order) throw new Error("Unknown order");
  const lots = w.ledger.snapshot.lots, holders = new Set(lots.filter(l => l.product === order.product).map(l => l.growerId));
  const out = new Map<string, InboxItem[]>();
  for (const i of w.items) {
    if (i.state === "approved" || i.state === "dismissed" || !holders.has(i.source.growerId)) continue;
    const named = i.proposal?.interpretation.lotId;
    if (named && lots.some(l => l.id === named && l.product !== order.product)) continue;
    if (!couldRaise(i, lots)) continue;
    out.set(i.source.growerId, [...out.get(i.source.growerId) ?? [], i]);
  }
  return [...out].map(([growerId, items]) => ({ growerId, items }));
}
