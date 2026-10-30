import { createHash } from "node:crypto";
import { integer, normalize, type Quantity, type BaseUnit } from "./quantity.ts";

export type Lot = {
  id: string; growerId: string; product: string; grade: string;
  quantity: Quantity; deliveryOn: string; confirmed: boolean;
};
export type Order = {
  id: string; buyerId: string; product: string; acceptedGrades: string[];
  quantity: Quantity; deliveryOn: string; priority: number;
  // These permissions must already be supplied/confirmed by the customer.
  approvedSubstitutions: { product: string; acceptedGrades: string[]; maxAmount?: number }[];
};
export type Snapshot = { version: number; lots: Lot[]; orders: Order[] };
export type Allocation = {
  orderId: string; lotId: string; amount: number; unit: BaseUnit;
  kind: "requested" | "approved-substitution";
};
export type Plan = {
  snapshotHash: string; status: "proposal"; allocations: Allocation[];
  unfilled: { orderId: string; amount: number; unit: BaseUnit; reason: string }[];
  unallocated: { lotId: string; amount: number; unit: BaseUnit; confirmed: boolean }[];
  promisesHash?: string; // set only when promises were honoured: digest of them in canonical order
};
// An allocation already promised to an order; the planner places these before anything else.
export type Promised = { orderId: string; lotId: string; amount: number; unit: BaseUnit; kind: Allocation["kind"] };

function identifier(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 160) throw new Error(`Invalid ${field}`);
}
function date(value: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Invalid delivery date");
}
function grades(values: string[]): void {
  if (!Array.isArray(values) || values.length === 0) throw new Error("Explicit accepted grades required");
  values.forEach(v => identifier(v, "grade"));
}
export function validateSnapshot(s: Snapshot): void {
  integer(s.version, "version");
  if (!Array.isArray(s.lots) || !Array.isArray(s.orders) || s.lots.length > 100 || s.orders.length > 100) throw new Error("Bounded lot/order arrays required");
  for (const [label, records] of [["lot", s.lots], ["order", s.orders]] as const) {
    const ids = new Set<string>();
    for (const record of records) {
      identifier(record.id, `${label} ID`);
      if (ids.has(record.id)) throw new Error(`Duplicate ${label} ID`);
      ids.add(record.id);
      identifier(record.product, "product"); date(record.deliveryOn); normalize(record.quantity);
    }
  }
  for (const lot of s.lots) {
    identifier(lot.growerId, "grower ID"); identifier(lot.grade, "grade");
    if (typeof lot.confirmed !== "boolean") throw new Error("Explicit lot confirmation required");
  }
  for (const order of s.orders) {
    identifier(order.buyerId, "buyer ID"); integer(order.priority, "priority"); grades(order.acceptedGrades);
    if (!Array.isArray(order.approvedSubstitutions) || order.approvedSubstitutions.length > 20) throw new Error("Explicit bounded substitution list required");
    for (const sub of order.approvedSubstitutions) { identifier(sub.product, "substitute product"); grades(sub.acceptedGrades); if (sub.maxAmount !== undefined && (!Number.isSafeInteger(sub.maxAmount) || sub.maxAmount <= 0)) throw new Error("Invalid substitute cap"); }
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function snapshotHash(s: Snapshot): string { validateSnapshot(s); return digest(s); }
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const promisesDigest = (promised: Promised[]) => digest([...promised].sort((a, b) => byOrder(a, b) || byId({ id: a.kind }, { id: b.kind }) || a.amount - b.amount));
const byOrder = (a: Promised, b: Promised) => byId({ id: a.orderId }, { id: b.orderId }) || byId({ id: a.lotId }, { id: b.lotId });
// Same eligibility test as the planner and verifier: confirmed lot, unit, date, product/grade or permitted substitute.
function eligible(s: Snapshot, p: Promised): { lot: Lot; order: Order } {
  const lot = s.lots.find(l => l.id === p.lotId), order = s.orders.find(o => o.id === p.orderId);
  if (!lot || !order || !lot.confirmed || lot.deliveryOn !== order.deliveryOn || normalize(lot.quantity).unit !== p.unit || normalize(order.quantity).unit !== p.unit) throw new Error("Ineligible promise");
  const ok = p.kind === "requested" ? lot.product === order.product && order.acceptedGrades.includes(lot.grade)
    : p.kind === "approved-substitution" && lot.product !== order.product && order.approvedSubstitutions.some(x => x.product === lot.product && x.acceptedGrades.includes(lot.grade));
  if (!ok) throw new Error("Ineligible promise");
  return { lot, order };
}

// Transparent heuristic: higher supplied priority first, ID tie-break (docs/EVIDENCE.md E15).
// Promised allocations are placed first, in input order; the rule then plans the remaining supply
// and need. All direct demand is considered before approved substitutions; no optimality claim.
export function proposeAllocations(s: Snapshot, promised: Promised[] = []): Plan {
  validateSnapshot(s);
  const orders = [...s.orders].sort((a, b) => b.priority - a.priority || byId(a, b));
  const lots = [...s.lots].sort(byId);
  const remaining = new Map(lots.map(l => [l.id, normalize(l.quantity).amount]));
  const need = new Map(orders.map(o => [o.id, normalize(o.quantity).amount]));
  const used = new Map<string, number>(); // substitute amount given so far, per order and substitute product
  const allocations: Allocation[] = [];
  for (const p of promised) {
    integer(p.amount, "promise");
    const { lot, order } = eligible(s, p);
    if (p.amount > remaining.get(lot.id)!) throw new Error("Promises exceed the lot");
    if (p.amount > need.get(order.id)!) throw new Error("Promises exceed the order");
    const cap = p.kind === "requested" ? Infinity : order.approvedSubstitutions.find(sub => sub.product === lot.product)?.maxAmount ?? Infinity, key = `${order.id}\n${lot.product}`;
    if (p.kind === "approved-substitution") { if (p.amount > cap - (used.get(key) ?? 0)) throw new Error("Promise over the agreed substitute amount"); used.set(key, (used.get(key) ?? 0) + p.amount); }
    if (!p.amount) continue;
    allocations.push({ orderId: p.orderId, lotId: p.lotId, amount: p.amount, unit: p.unit, kind: p.kind });
    remaining.set(lot.id, remaining.get(lot.id)! - p.amount); need.set(order.id, need.get(order.id)! - p.amount);
  }
  for (const kind of ["requested", "approved-substitution"] as const) {
    for (const order of orders) {
      const oq = normalize(order.quantity);
      for (const lot of lots) {
        const lq = normalize(lot.quantity);
        if (!lot.confirmed || lq.unit !== oq.unit || lot.deliveryOn !== order.deliveryOn) continue;
        const fits = kind === "requested"
          ? lot.product === order.product && order.acceptedGrades.includes(lot.grade)
          : lot.product !== order.product && order.approvedSubstitutions.some(sub => sub.product === lot.product && sub.acceptedGrades.includes(lot.grade));
        if (!fits) continue;
        const cap = kind === "requested" ? Infinity : order.approvedSubstitutions.find(sub => sub.product === lot.product)?.maxAmount ?? Infinity;
        const key = `${order.id}\n${lot.product}`;
        const amount = Math.min(need.get(order.id)!, remaining.get(lot.id)!, cap - (used.get(key) ?? 0));
        if (amount <= 0) continue;
        if (kind === "approved-substitution") used.set(key, (used.get(key) ?? 0) + amount);
        allocations.push({ orderId: order.id, lotId: lot.id, amount, unit: oq.unit, kind });
        remaining.set(lot.id, remaining.get(lot.id)! - amount);
        need.set(order.id, need.get(order.id)! - amount);
      }
    }
  }
  return {
    snapshotHash: snapshotHash(s), status: "proposal", allocations, ...(promised.length ? { promisesHash: promisesDigest(promised) } : {}),
    unfilled: orders.filter(o => need.get(o.id)! > 0).map(o => ({ orderId: o.id, amount: need.get(o.id)!, unit: normalize(o.quantity).unit, reason: "Insufficient eligible confirmed supply for the requested date, unit, product and grade" })),
    unallocated: lots.filter(l => remaining.get(l.id)! > 0).map(l => ({ lotId: l.id, amount: remaining.get(l.id)!, unit: normalize(l.quantity).unit, confirmed: l.confirmed }))
  };
}

// Separate verifier: accepts no trust in generated quantities or eligibility.
export function verifyPlan(s: Snapshot, plan: Plan, promised: Promised[] = []): void {
  validateSnapshot(s);
  if (plan.status !== "proposal" || plan.snapshotHash !== snapshotHash(s)) throw new Error("Stale or invalid plan");
  if (plan.promisesHash !== (promised.length ? promisesDigest(promised) : undefined)) throw new Error("Plan drops a promise");
  const lotTotals = new Map(s.lots.map(l => [l.id, 0]));
  const orderTotals = new Map(s.orders.map(o => [o.id, 0])), subTotals = new Map<string, number>();
  for (const a of plan.allocations) {
    integer(a.amount, "allocation");
    if (!a.amount) throw new Error("Zero allocation");
    const l = s.lots.find(l => l.id === a.lotId), o = s.orders.find(o => o.id === a.orderId);
    if (!l || !o || !l.confirmed || l.deliveryOn !== o.deliveryOn || normalize(l.quantity).unit !== a.unit || normalize(o.quantity).unit !== a.unit) throw new Error("Ineligible allocation");
    const direct = a.kind === "requested" && l.product === o.product && o.acceptedGrades.includes(l.grade);
    const sub = a.kind === "approved-substitution" && l.product !== o.product && o.approvedSubstitutions.some(p => p.product === l.product && p.acceptedGrades.includes(l.grade));
    if (!direct && !sub) throw new Error("Unapproved product or grade");
    const lt = lotTotals.get(l.id)! + a.amount, ot = orderTotals.get(o.id)! + a.amount;
    integer(lt, "lot total"); integer(ot, "order total");
    if (lt > normalize(l.quantity).amount || ot > normalize(o.quantity).amount) throw new Error("Over-allocation");
    if (a.kind === "approved-substitution") {
      const cap = o.approvedSubstitutions.find(p => p.product === l.product)?.maxAmount, key = `${o.id}\n${l.product}`, ut = (subTotals.get(key) ?? 0) + a.amount;
      if (cap !== undefined && ut > cap) throw new Error("Over the agreed substitute amount");
      subTotals.set(key, ut);
    }
    lotTotals.set(l.id, lt); orderTotals.set(o.id, ot);
  }
  const kept = new Map<string, number>(); // allocated per order, lot and kind
  for (const a of plan.allocations) { const k = `${a.orderId}\n${a.lotId}\n${a.kind}`; kept.set(k, (kept.get(k) ?? 0) + a.amount); }
  const owed = new Map<string, number>();
  for (const p of promised) { const k = `${p.orderId}\n${p.lotId}\n${p.kind}`; owed.set(k, (owed.get(k) ?? 0) + p.amount); }
  for (const [k, amount] of owed) if ((kept.get(k) ?? 0) < amount) throw new Error("Plan drops a promise");
  const expectedUnfilled = s.orders.map(o => ({ orderId: o.id, amount: normalize(o.quantity).amount - orderTotals.get(o.id)!, unit: normalize(o.quantity).unit })).filter(x => x.amount > 0);
  const expectedUnallocated = s.lots.map(l => ({ lotId: l.id, amount: normalize(l.quantity).amount - lotTotals.get(l.id)!, unit: normalize(l.quantity).unit, confirmed: l.confirmed })).filter(x => x.amount > 0);
  const actualUnfilled = plan.unfilled.map(({ orderId, amount, unit }) => ({ orderId, amount, unit }));
  const sort = (xs: unknown[]) => xs.map(canonical).sort();
  if (digest(sort(actualUnfilled)) !== digest(sort(expectedUnfilled)) || digest(sort(plan.unallocated)) !== digest(sort(expectedUnallocated))) throw new Error("Residual accounting mismatch");
}
