import test from "node:test";
import assert from "node:assert/strict";
import { scenario, shortage, surplus } from "../evaluation/scenario.ts";
import { proposeAllocations, type Lot } from "../src/planner.ts";
import { commitUpdate, createLedger, reviewUpdate, type Evidence, type Ledger } from "../src/updates.ts";
import { acceptSubstitute, addLot, options, pendingCover, permissionSource, recommend as recommendFor, shortages } from "../src/orders.ts";
import type { Contact } from "../src/demo.ts";
import { createWorkbench } from "../src/workbench.ts";
import { normalize } from "../src/quantity.ts";

const evidence: Evidence = { messageId: "in-1", channel: "call", quote: "Zucchini is fine" };
const zucchini = { product: "zucchini", acceptedGrades: ["standard"] };
function approved(): Ledger {
  const l = createLedger(scenario()), p = shortage(l);
  return commitUpdate(l, p, { reviewer: "test", reviewHash: reviewUpdate(l, p).hash });
}
const lotE: Lot = { id: "lot-e", growerId: "grower-c", product: "tomato", grade: "standard", quantity: { amount: 10, unit: "kg" }, deliveryOn: "2026-10-30", confirmed: true };

test("acceptSubstitute records the buyer's consent without touching the input", () => {
  const l = approved(), before = structuredClone(l);
  const n = acceptSubstitute(l, "order-b", zucchini, evidence, "Hub coordinator");
  assert.ok(n.snapshot.orders.find(o => o.id === "order-b")!.approvedSubstitutions.some(s => s.product === "zucchini"));
  assert.equal(n.records.length, 1);
  assert.equal(n.records[0].id, "record-1");
  assert.equal(n.version, l.version + 1);
  assert.equal(n.snapshot.version, l.snapshot.version + 1);
  assert.deepEqual(l, before);
  assert.throws(() => acceptSubstitute(n, "order-b", zucchini, evidence, "Hub coordinator"), /already allowed/);
  assert.throws(() => acceptSubstitute(l, "order-x", zucchini, evidence, "Hub coordinator"), /Unknown order/);
  assert.throws(() => acceptSubstitute(l, "order-b", zucchini, { ...evidence, quote: " " }, "Hub coordinator"), /quote/);
  assert.throws(() => acceptSubstitute(l, "order-b", { product: "tomato", acceptedGrades: ["standard"] }, evidence, "Hub coordinator"), /own product/);
});

test("addLot adds supply through validation and reduces the shortage", () => {
  const l = approved(), before = structuredClone(l), short = (x: Ledger) => proposeAllocations(x.snapshot).unfilled.reduce((a, u) => a + u.amount, 0);
  const n = addLot(l, lotE, { messageId: "in-2", channel: "text", quote: "10 kg more tomatoes" }, "Hub coordinator");
  assert.ok(n.snapshot.lots.some(x => x.id === "lot-e"));
  assert.equal(short(l) - short(n), 10000);
  assert.equal(n.records[0].kind, "lot-added");
  assert.equal(n.version, l.version + 1);
  assert.deepEqual(l, before);
  assert.throws(() => addLot(n, lotE, evidence, "Hub coordinator"), /Duplicate lot/);
});

test("permissionSource distinguishes agreed from on-file permission", () => {
  const l = approved();
  assert.deepEqual(permissionSource(l, "order-c", "zucchini"), { kind: "on-file" });
  assert.throws(() => permissionSource(l, "order-b", "zucchini"), /No permission/);
  assert.throws(() => permissionSource(l, "order-x", "zucchini"), /Unknown order/);
  const n = acceptSubstitute(l, "order-b", zucchini, evidence, "Hub coordinator"), s = permissionSource(n, "order-b", "zucchini");
  assert.equal(s.kind, "agreed");
  assert.equal(s.kind === "agreed" && s.record.id, "record-1");
});

test("commitUpdate keeps records", () => {
  const n = acceptSubstitute(createLedger(scenario()), "order-b", zucchini, evidence, "Hub coordinator"), p = shortage(n);
  const c = commitUpdate(n, p, { reviewer: "test", reviewHash: reviewUpdate(n, p).hash });
  assert.equal(c.records.length, 1);
});

const contacts: Contact[] = [
  { id: "grower-a", name: "Grower A", kind: "member" }, { id: "grower-b", name: "Grower B", kind: "member" },
  { id: "grower-c", name: "Grower C", kind: "member" }, { id: "outside-1", name: "Outside 1", kind: "outside" }
];
const approve = (l: Ledger, p: ReturnType<typeof shortage>) => commitUpdate(l, p, { reviewer: "Hub coordinator", reviewHash: reviewUpdate(l, p).hash });

test("shortages lists short orders sorted by order", () => {
  // order-c (cucumber, zucchini approved but none yet) is also short by 10000 in this scenario.
  assert.deepEqual(shortages(approved()), [
    { orderId: "order-b", buyerId: "buyer-b", product: "tomato", deliveryOn: "2026-10-30", unit: "g", short: 30000 },
    { orderId: "order-c", buyerId: "buyer-c", product: "cucumber", deliveryOn: "2026-10-30", unit: "g", short: 10000 }]);
});

test("options cover has-lot asks, no-lot contacts, substitutes and notify", () => {
  const l = approved(), o = options(l, "order-b", contacts);
  assert.deepEqual(o.slice(0, 2), [
    { kind: "ask-grower", contactId: "grower-a", hasLot: true, lotId: "lot-a", amount: 30000, unit: "g", reducedRecently: true },
    { kind: "ask-grower", contactId: "grower-b", hasLot: true, lotId: "lot-b", amount: 30000, unit: "g", reducedRecently: false }]);
  assert.deepEqual(o.slice(2, 4), [
    { kind: "ask-grower", contactId: "grower-c", hasLot: false, contactKind: "member", amount: 30000, unit: "g" },
    { kind: "ask-grower", contactId: "outside-1", hasLot: false, contactKind: "outside", amount: 30000, unit: "g" }]);
  assert.equal(o.some(x => x.kind === "offer-substitute"), false);
  assert.deepEqual(o[o.length - 1], { kind: "notify-short", amount: 30000, unit: "g" });
  assert.equal(o.length, 5);
  assert.deepEqual(options(l, "order-a", contacts), []);
  assert.throws(() => options(l, "order-x", contacts), /Unknown order/);
});

test("substitute offers appear from unallocated supply until accepted", () => {
  const l0 = approved(), l = approve(l0, surplus(l0, true));
  const sub = options(l, "order-b", contacts).filter(x => x.kind === "offer-substitute");
  assert.deepEqual(sub, [{ kind: "offer-substitute", product: "zucchini", grade: "standard", covers: 10000, unit: "g" }]);  // order-c's approved zucchini already takes 10000 of the 20000
  const n = acceptSubstitute(l, "order-b", zucchini, evidence, "Hub coordinator");
  assert.deepEqual(shortages(n).filter(s => s.orderId === "order-b").map(s => s.short), [10000]);
  assert.equal(options(n, "order-b", contacts).some(x => x.kind === "offer-substitute"), false);
});

test("acceptSubstitute records an optional cap and refuses a bad one, leaving the input unchanged", () => {
  const l = approved(), before = structuredClone(l);
  const n = acceptSubstitute(l, "order-b", { ...zucchini, maxAmount: 30 }, evidence, "Hub coordinator");
  assert.equal(n.snapshot.orders.find(o => o.id === "order-b")!.approvedSubstitutions.find(s => s.product === "zucchini")!.maxAmount, 30);
  for (const bad of [0, -5, 2.5, Number.NaN]) assert.throws(() => acceptSubstitute(l, "order-b", { ...zucchini, maxAmount: bad }, evidence, "Hub coordinator"), /cap/);
  assert.deepEqual(l, before);
});

test("a capped substitute can be raised or uncapped; a smaller or equal cap is refused; each change is recorded", () => {
  const l = approved(), cap = (maxAmount?: number) => ({ ...zucchini, ...(maxAmount === undefined ? {} : { maxAmount }) });
  const a = acceptSubstitute(l, "order-b", cap(30), evidence, "Hub coordinator"), before = structuredClone(a);
  assert.throws(() => acceptSubstitute(a, "order-b", cap(30), evidence, "Hub coordinator"), /already allowed.*up to 30/);
  assert.throws(() => acceptSubstitute(a, "order-b", cap(20), evidence, "Hub coordinator"), /already allowed.*up to 30/);
  const b = acceptSubstitute(a, "order-b", cap(50), evidence, "Hub coordinator");
  const subs = (x: Ledger) => x.snapshot.orders.find(o => o.id === "order-b")!.approvedSubstitutions;
  assert.deepEqual(subs(b).map(s => [s.product, s.maxAmount]), [["zucchini", 50]]);
  const rb = b.records.at(-1)!;
  assert.deepEqual([rb.kind === "substitute-accepted" && rb.change, b.records.length], ["raised", 2]);
  const c = acceptSubstitute(b, "order-b", cap(), evidence, "Hub coordinator");
  assert.equal(subs(c)[0].maxAmount, undefined);
  const rc = c.records.at(-1)!;
  assert.equal(rc.kind === "substitute-accepted" && rc.change, "uncapped");
  assert.throws(() => acceptSubstitute(c, "order-b", cap(90), evidence, "Hub coordinator"), /without a cap/);
  assert.deepEqual(a, before);
  assert.equal(permissionSource(c, "order-b", "zucchini").kind === "agreed" && true, true);
});

test("an equal cap that adds a grade adds the grade and records it; the same grades still throw", () => {
  const l = approved(), sub = (acceptedGrades: string[]) => ({ product: "zucchini", acceptedGrades, maxAmount: 30 });
  const a = acceptSubstitute(l, "order-b", sub(["standard"]), evidence, "Hub coordinator");
  assert.throws(() => acceptSubstitute(a, "order-b", sub(["standard"]), evidence, "Hub coordinator"), /already allowed/);
  const b = acceptSubstitute(a, "order-b", sub(["second"]), evidence, "Hub coordinator");
  const held = b.snapshot.orders.find(o => o.id === "order-b")!.approvedSubstitutions[0];
  assert.deepEqual([held.acceptedGrades, held.maxAmount], [["standard", "second"], 30]);
  const r = b.records.at(-1)!;
  assert.deepEqual(r.kind === "substitute-accepted" && [r.change, r.previousMax], ["grade-added", 30]);
});

test("Task 20: pendingCover lists unreviewed updates from growers who hold the order's product, and drops reviewed or off-product ones", async () => {
  const { morning, ME, T } = await import("./story.ts");
  const { logCall } = await import("../src/resolve.ts");
  const { dismiss, receive } = await import("../src/workbench.ts");
  let w = morning();
  assert.deepEqual(pendingCover(w, "order-b"), []);
  w = logCall(w, "grower-b", "Called: we can add 30 lb of standard tomatoes for Friday.", ME, T(30));
  w = receive(w, { id: "msg-zuke", revision: 1, growerId: "grower-b", text: "Zucchini is up to six cases." }, T(31));
  const ids = (o: string) => pendingCover(w, o).map(g => g.items.map(i => i.id));
  assert.deepEqual(ids("order-b"), [["item-4", "item-5"]]);
  assert.deepEqual(pendingCover(w, "order-b").map(g => g.growerId), ["grower-b"]);
  assert.deepEqual(ids("order-c"), []);
  w = dismiss(w, "item-4", "not now", ME, T(32));
  assert.deepEqual(ids("order-b"), [["item-5"]]);
  assert.throws(() => pendingCover(w, "order-x"), /Unknown order/);
});

// recommend reads a workbench; these cases have no messages yet, so the ledger alone decides.
const recommend = (l: Ledger, orderId: string, c: Contact[]) => recommendFor(createWorkbench(l), orderId, c);

test("Task 21: recommend follows the hubs' order of moves and breaks ties by id", () => {
  const l0 = approved(), l = approve(l0, surplus(l0, true));
  const mutate = (x: Ledger, f: (s: Ledger["snapshot"]) => void) => { const c = structuredClone(x); f(c.snapshot); return c; };
  // 1. a holder who was not cut: grower-b (grower-a was cut in their latest update)
  assert.deepEqual(recommend(l, "order-b", contacts), options(l, "order-b", contacts).find(o => o.kind === "ask-grower" && o.contactId === "grower-b"));
  assert.equal(recommend(l, "order-a", contacts), undefined);
  assert.throws(() => recommend(l, "order-x", contacts), /Unknown order/);
  // largest lot first; equal lots go by lot id, whatever order the lots are stored in
  const big = mutate(l, s => { s.lots.find(x => x.id === "lot-a")!.quantity = { amount: 90, unit: "kg" }; s.lots.find(x => x.id === "lot-b")!.quantity = { amount: 90, unit: "kg" }; });
  const first = recommend(big, "order-b", contacts), flipped = mutate(big, s => { s.lots.reverse(); });
  assert.deepEqual(recommend(flipped, "order-b", contacts), first);
  // 2. no holder left to ask: a substitute covering at least 25% of the short, only with standing permission
  const noHolders = (x: Ledger, cap?: number, cases = 10) => mutate(x, s => {
    s.lots.find(lot => lot.id === "lot-d")!.quantity.amount = cases;
    for (const lot of s.lots) if (lot.product === "tomato") lot.deliveryOn = "2026-11-02";
    if (cap !== undefined) s.orders.find(o => o.id === "order-b")!.approvedSubstitutions.push({ product: "zucchini", acceptedGrades: ["standard"], maxAmount: cap });
  });
  const wide = recommend(noHolders(l, 10000), "order-b", []);
  assert.deepEqual(wide, { kind: "offer-substitute", product: "zucchini", grade: "standard", covers: 30000, unit: "g" });
  // under a quarter of the short is listed but never the pick; a qualifying offer is the pick even before the buyer has said yes
  assert.equal(recommend(noHolders(l, 5000, 4), "order-b", [])?.kind, "notify-short");
  assert.deepEqual(recommend(noHolders(l), "order-b", []), { kind: "offer-substitute", product: "zucchini", grade: "standard", covers: 40000, unit: "g" });
  // 3. otherwise (no offer covers a quarter) the first other grower: members before outside sources, then by id
  const none = mutate(l, s => { s.lots = s.lots.filter(x => x.product !== "tomato"); s.lots.find(x => x.id === "lot-d")!.quantity.amount = 1; });
  assert.deepEqual(recommend(none, "order-b", contacts), { kind: "ask-grower", contactId: "grower-a", hasLot: false, contactKind: "member", amount: 40000, unit: "g" });
  assert.equal((recommend(none, "order-b", [...contacts].reverse()) as { contactId: string }).contactId, "grower-a");
  // 4. nobody left: tell the buyer
  assert.deepEqual(recommend(none, "order-b", []), { kind: "notify-short", amount: 40000, unit: "g" });
});

test("Task 4: pendingCover keeps only updates that could raise supply, one group per grower", async () => {
  const { morning, ME, T } = await import("./story.ts");
  const { propose } = await import("../evaluation/scenario.ts");
  const { interpret, receive } = await import("../src/workbench.ts");
  let w = morning();
  const lot = w.ledger.snapshot.lots.find(l => l.id === "lot-b")!, base = normalize(lot.quantity).amount;
  const read = (id: string, text: string, operation: "add-quantity" | "replace-total" | "forecast", amount: number, quote: string) => {
    const src = { id, revision: 1, growerId: "grower-b", text };
    w = receive(w, src, T(30));
    const item = w.items.at(-1)!.id;
    w = interpret(w, item, propose(w.ledger, `p-${id}`, src, { operation, lotId: "lot-b", quantity: { amount, unit: "lb" }, grade: "standard", deliveryOn: "2026-10-30", quotes: [quote, "Friday"] }), "test reading", ME, T(30));
    return item;
  };
  const add = read("m-add", "Add 5 lb more tomatoes Friday.", "add-quantity", 5, "Add 5 lb more tomatoes");
  const below = read("m-low", "Total is 1 lb of tomatoes Friday.", "replace-total", 1, "Total is 1 lb of tomatoes");
  const above = read("m-high", `Total is ${base + 50} lb of tomatoes Friday.`, "replace-total", base + 50, `Total is ${base + 50} lb of tomatoes`);
  const forecast = read("m-fc", "Maybe 20 lb of tomatoes Friday.", "forecast", 20, "Maybe 20 lb of tomatoes");
  w = receive(w, { id: "m-raw", revision: 1, growerId: "grower-b", text: "Hello" }, T(31));
  const raw = w.items.at(-1)!.id;
  const groups = pendingCover(w, "order-b");
  assert.equal(groups.length, 1, "one line per grower");
  assert.deepEqual(groups[0].items.map(i => i.id), [add, above, raw]);
  assert.ok(![below, forecast].some(id => groups[0].items.some(i => i.id === id)), "a lower total and a forecast cannot cover");
});
