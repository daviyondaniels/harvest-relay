import test from "node:test";
import assert from "node:assert/strict";
import { answer, propose, scenario, shortage, surplus } from "../evaluation/scenario.ts";
import { proposeAllocations, verifyPlan } from "../src/planner.ts";
import { normalize } from "../src/quantity.ts";
import { commitUpdate, createLedger, reviewUpdate, type Ledger, type Operation, type UpdateProposal } from "../src/updates.ts";

// Authored synthetic development cases; not customer records or a model holdout.
const FRIDAY = "2026-10-30";
const approve = (l: Ledger, p: UpdateProposal) => commitUpdate(l, p, { reviewer: "test", reviewHash: reviewUpdate(l, p).hash });
const grams = (l: Ledger, lotId: string) => normalize(l.snapshot.lots.find(x => x.id === lotId)!.quantity).amount;
const checked = (l: Ledger) => { const p = proposeAllocations(l.snapshot); verifyPlan(l.snapshot, p); return p; };
function tomatoes(l: Ledger, id: string, text: string, operation: Operation, kg: number, extra: { lotId?: string; growerId?: string; revision?: number; correctsEventId?: string } = {}) {
  const { lotId = "lot-b", growerId = "grower-b", revision = 1, correctsEventId } = extra;
  return propose(l, `proposal-${id}`, { id, revision, growerId, text }, { operation, lotId, quantity: { amount: kg, unit: "kg" }, grade: "standard", deliveryOn: FRIDAY, correctsEventId, quotes: [text] });
}

test("new totals, added quantities and corrections have distinct, explicit effects", () => {
  const l = createLedger(scenario());
  const replaced = approve(l, tomatoes(l, "msg-1", "Lot B is now 10 kg standard tomatoes for Friday.", "replace-total", 10));
  assert.equal(grams(replaced, "lot-b"), 10000);
  const added = approve(l, tomatoes(l, "msg-2", "Picked another 10 kg of standard tomatoes for Friday.", "add-quantity", 10));
  assert.equal(grams(added, "lot-b"), 50000);
  const add = added.events[0].proposal;
  const corrected = approve(added, tomatoes(added, "msg-3", "Correction: it was 5 kg extra, not 10.", "correction", 5, { correctsEventId: "event-1" }));
  assert.equal(grams(corrected, "lot-b"), 45000);
  const again = approve(corrected, tomatoes(corrected, "msg-3b", "Actually 7 kg extra.", "correction", 7, { correctsEventId: "event-2" }));
  assert.equal(grams(again, "lot-b"), 47000, "a chained correction rebases on the original starting quantity");
  assert.deepEqual(corrected.events.map(e => [e.id, e.effect, e.proposal.interpretation.operation]), [["event-1", "add-quantity", "add-quantity"], ["event-2", "add-quantity", "correction"]]);
  assert.deepEqual(corrected.events[0].proposal, add, "corrected evidence is kept, not replaced");
  const short = approve(l, shortage(l));
  const fixed = approve(short, tomatoes(short, "msg-4", "Sorry, 35 kg of tomatoes, not 30.", "correction", 35, { lotId: "lot-a", growerId: "grower-a", correctsEventId: "event-1" }));
  assert.equal(grams(fixed, "lot-a"), 35000);
  assert.equal(fixed.snapshot.version, 2);
  for (const x of [replaced, added, corrected, fixed]) checked(x);
});

test("unresolved meaning or details block inventory changes and leave the ledger untouched", () => {
  const l = approve(createLedger(scenario()), tomatoes(createLedger(scenario()), "seed", "Picked another 10 kg of standard tomatoes for Friday.", "add-quantity", 10));
  const base = shortage(l), before = structuredClone(l);
  const cases: [string, (p: UpdateProposal) => void][] = [
    ["operation", p => { p.interpretation.operation = "unresolved"; }],
    ["lot", p => { delete p.interpretation.lotId; }],
    ["lot", p => { p.interpretation.lotId = "lot-x"; }],
    ["lot", p => { p.source.growerId = "grower-b"; }],
    ["grade", p => { delete p.interpretation.grade; }],
    ["grade", p => { p.interpretation.grade = "premium"; }],
    ["date", p => { delete p.interpretation.deliveryOn; }],
    ["date", p => { p.interpretation.deliveryOn = "2026-10-31"; }],
    ["quantity", p => { delete p.interpretation.quantity; }],
    ["pack", p => { p.interpretation.quantity = { amount: 4, unit: "case" }; }],
    ["unit", p => { p.interpretation.quantity = { amount: 30, unit: "each" }; }],
    ["unit", p => { p.interpretation.quantity = { amount: 30, unit: "lb" } as never; }],
    ["pack", p => { p.interpretation.unresolved = ["pack"]; }],
    ["grade", p => { p.clarifications = [{ field: "grade", question: "Standard or seconds?" }]; }],
    ["correction-target", p => { p.interpretation.correctsEventId = "event-1"; }],
    ["correction-target", p => { p.interpretation.operation = "correction"; p.interpretation.correctsEventId = "event-9"; }],
    ["correction-target", p => { p.interpretation.operation = "correction"; p.interpretation.correctsEventId = "event-1"; }]
  ];
  for (const [field, alter] of cases) {
    const p = structuredClone(base); alter(p);
    const review = reviewUpdate(l, p);
    assert.ok(review.questions.some(q => q.field === field), `${field}: ${JSON.stringify(review.questions)}`);
    assert.throws(() => commitUpdate(l, p, { reviewer: "test", reviewHash: review.hash }), /Clarification required/);
  }
  assert.deepEqual(l, before);
});

test("corrections must target the latest inventory update for the same lot", () => {
  let l = createLedger(scenario());
  l = approve(l, shortage(l));
  l = approve(l, tomatoes(l, "msg-5", "Now 20 kg standard tomatoes for Friday.", "replace-total", 20, { lotId: "lot-a", growerId: "grower-a" }));
  const late = tomatoes(l, "msg-6", "Sorry, 35 kg of tomatoes, not 30.", "correction", 35, { lotId: "lot-a", growerId: "grower-a", correctsEventId: "event-1" });
  assert.match(reviewUpdate(l, late).questions[0].question, /Later updates/);
  const elsewhere = tomatoes(l, "msg-7", "Sorry, 35 kg of tomatoes, not 30.", "correction", 35, { correctsEventId: "event-2" });
  assert.match(reviewUpdate(l, elsewhere).questions.map(q => q.question).join(), /different lot/);
});

test("clarification questions and answers stay linked to the original evidence and its hash", () => {
  let l = createLedger(scenario());
  const open = surplus(l);
  assert.deepEqual(reviewUpdate(l, open).questions.map(q => q.field).sort(), ["operation", "pack"]);
  const p = surplus(l, true);
  l = approve(l, p);
  const event = l.events[0];
  assert.equal(event.proposal.source.text, "We have four cases of standard zucchini for Friday now.");
  assert.deepEqual(event.proposal.clarifications, p.clarifications);
  assert.deepEqual(event.proposal.clarifications.map(c => { const a = c.answer!; return a.source.text.slice(a.span.start, a.span.end); }),
    ["Confirmed net contents: 5 kg per case", "this is the new lot total"]);
  assert.equal(grams(l, "lot-d"), 20000);

  const fresh = createLedger(scenario()), q = surplus(fresh, true), hash = reviewUpdate(fresh, q).hash;
  const reworded = structuredClone(q); reworded.clarifications[0] = answer("pack", "Clarify the confirmed contents of one case", { ...q.clarifications[0].answer!.source, text: "Confirmed net contents: 5 kg per case, washed." }, "Confirmed net contents: 5 kg per case");
  const resourced = structuredClone(q); resourced.source.text += " ";
  for (const changed of [reworded, resourced]) {
    assert.notEqual(reviewUpdate(fresh, changed).hash, hash);
    assert.throws(() => commitUpdate(fresh, changed, { reviewer: "test", reviewHash: hash }), /approval/);
  }
  const unsupported = structuredClone(q); unsupported.clarifications[0].answer!.span = { start: 0, end: 500 };
  assert.throws(() => reviewUpdate(fresh, unsupported), /evidence/);
});

test("duplicate, conflicting and superseded source revisions cannot alter a lot twice", () => {
  const l0 = createLedger(scenario()), l1 = approve(l0, shortage(l0));
  assert.throws(() => approve(l1, shortage(l1)), /Duplicate/);
  const edited = shortage(l1); edited.source.text = edited.source.text.replace("for Friday", "for Friday morning");
  assert.throws(() => approve(l1, edited), /conflict/);
  const v2 = (l: Ledger) => tomatoes(l, "note-a", "Only 25 kg of standard tomatoes for Friday, replacing the earlier total.", "replace-total", 25, { lotId: "lot-a", growerId: "grower-a", revision: 2 });
  const l2 = approve(l1, v2(l1));
  assert.equal(grams(l2, "lot-a"), 25000);
  const newerFirst = approve(l0, v2(l0));
  assert.throws(() => approve(newerFirst, shortage(newerFirst)), /Superseded/);

  // One message naming two lots may update each lot once.
  const text = "Only 30 kg of standard tomatoes for Friday; cucumbers now 25 kg standard for Friday.";
  const lotA = (l: Ledger) => propose(l, "multi-a", { id: "multi", revision: 1, growerId: "grower-a", text }, { operation: "replace-total", lotId: "lot-a", quantity: { amount: 30, unit: "kg" }, grade: "standard", deliveryOn: FRIDAY, quotes: ["Only 30 kg of standard tomatoes for Friday"] });
  const lotC = (l: Ledger) => propose(l, "multi-c", { id: "multi", revision: 1, growerId: "grower-a", text }, { operation: "replace-total", lotId: "lot-c", quantity: { amount: 25, unit: "kg" }, grade: "standard", deliveryOn: FRIDAY, quotes: ["cucumbers now 25 kg standard for Friday"] });
  let m = approve(l0, lotA(l0)); m = approve(m, lotC(m));
  assert.deepEqual([grams(m, "lot-a"), grams(m, "lot-c")], [30000, 25000]);
  assert.throws(() => approve(m, lotC(m)), /Duplicate/);
});

test("approvals go stale when any other update commits, even if inventory is unchanged", () => {
  const l0 = createLedger(scenario()), p = shortage(l0), approval = { reviewer: "test", reviewHash: reviewUpdate(l0, p).hash };
  const other = approve(l0, tomatoes(l0, "msg-8", "Picked another 10 kg of standard tomatoes for Friday.", "add-quantity", 10));
  assert.throws(() => commitUpdate(other, p, approval), /Stale/);
  assert.throws(() => commitUpdate(other, shortage(other), approval), /approval/);
  assert.equal(grams(approve(other, shortage(other)), "lot-a"), 30000);
  // A forecast leaves the snapshot hash unchanged; the ledger version still invalidates the review.
  const forecast = approve(l0, propose(l0, "f", { id: "f", revision: 1, growerId: "grower-a", text: "Maybe 15 kg more standard cucumbers by Friday." }, { operation: "forecast", lotId: "lot-c", quantity: { amount: 15, unit: "kg" }, grade: "standard", deliveryOn: FRIDAY, quotes: ["Maybe 15 kg more standard cucumbers by Friday"] }));
  assert.deepEqual(forecast.snapshot, l0.snapshot);
  assert.throws(() => commitUpdate(forecast, p, approval), /Stale/);
});

test("forecast supply is recorded separately and never becomes allocatable", () => {
  const l0 = createLedger(scenario());
  const text = "Expect about 15 kg more standard cucumbers by Friday if the weather holds.";
  const p = propose(l0, "forecast-c", { id: "msg-9", revision: 1, growerId: "grower-a", text }, { operation: "forecast", lotId: "lot-c", quantity: { amount: 15, unit: "kg" }, grade: "standard", deliveryOn: FRIDAY, quotes: ["about 15 kg more standard cucumbers", "if the weather holds"] });
  const l1 = approve(l0, p);
  assert.deepEqual(l1.snapshot, l0.snapshot);
  assert.deepEqual(checked(l1), checked(l0));
  assert.deepEqual(checked(l1).unfilled.map(x => [x.orderId, x.amount]), [["order-c", 10000]]);
  assert.deepEqual(l1.forecasts, [{ eventId: "event-1", lotId: "lot-c", amount: 15000, unit: "g", deliveryOn: FRIDAY }]);
  assert.deepEqual([l1.version, l1.snapshot.version, l1.events[0].effect], [1, 0, "forecast"]);
  const fix = propose(l1, "fix", { id: "msg-10", revision: 1, growerId: "grower-a", text: "Make that 20 kg." }, { operation: "correction", correctsEventId: "event-1", lotId: "lot-c", quantity: { amount: 20, unit: "kg" }, grade: "standard", deliveryOn: FRIDAY, quotes: ["20 kg"] });
  assert.match(reviewUpdate(l1, fix).questions[0].question, /Forecasts/);
});

test("generated update sequences keep deterministic allocation and complete residuals", () => {
  // Repeatable development property checks, not a customer or model holdout.
  let seed = 4127;
  const rand = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const products: Record<string, string> = { "lot-a": "tomatoes", "lot-b": "tomatoes", "lot-c": "cucumbers", "lot-d": "zucchini" };
  let l = createLedger(scenario());
  const expected = new Map(l.snapshot.lots.map(x => [x.id, normalize(x.quantity).amount]));
  const before = new Map<string, number>();
  for (let step = 0; step < 150; step++) {
    const lot = l.snapshot.lots[rand(4)], kg = rand(60), target = l.events.findLast(e => e.lotId === lot.id && e.effect !== "forecast");
    const ops: Operation[] = ["replace-total", "add-quantity", "forecast", "unresolved", ...(target ? ["correction" as const] : [])];
    const operation = ops[rand(ops.length)];
    const text = `Update ${step}: ${kg} kg standard ${products[lot.id]} for Friday.`;
    const p = tomatoes(l, `gen-${step}`, text, operation, kg, { lotId: lot.id, growerId: lot.growerId, correctsEventId: operation === "correction" ? target!.id : undefined });
    if (operation === "unresolved") { const prior = structuredClone(l); assert.throws(() => approve(l, p), /Clarification/); assert.deepEqual(l, prior); continue; }
    l = approve(l, p);
    const event = l.events.at(-1)!;
    before.set(event.id, expected.get(lot.id)!);
    const start = operation === "correction" ? before.get(target!.id)! : expected.get(lot.id)!;
    if (event.effect === "replace-total") expected.set(lot.id, kg * 1000);
    if (event.effect === "add-quantity") expected.set(lot.id, start + kg * 1000);
    if (operation === "correction") before.set(event.id, before.get(target!.id)!);
    for (const [id, amount] of expected) assert.equal(grams(l, id), amount, `step ${step} ${id}`);
    const plan = checked(l);
    assert.deepEqual(proposeAllocations({ ...l.snapshot, lots: [...l.snapshot.lots].reverse(), orders: [...l.snapshot.orders].reverse() }).allocations, plan.allocations);
  }
  assert.equal(l.events.length, l.version);
  assert.equal(l.events.filter(e => e.effect !== "forecast").length, l.snapshot.version);
});
