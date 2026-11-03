import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LATE, seedWorkbench } from "../src/seed.ts";
import { numberSpan } from "../app/lib/quote.ts";
import { approve, latestChange, preview, previewHand, readByHandAndApprove, receive, suggestReading } from "../src/workbench.ts";
import { changeCut, changeableCuts, commitKey, confirmPlan, conflicts, decideCut, markStage } from "../src/commitments.ts";
import { shortages } from "../src/orders.ts";
import { dayRecord } from "../app/lib/record.ts";

// Task 28: a settled cut can be handed back and decided again, until something is built on it.
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z", T3 = "2026-10-28T14:10:00.000Z", T4 = "2026-10-28T14:15:00.000Z", T5 = "2026-10-28T14:20:00.000Z", ME = "A Name";
type W = Awaited<ReturnType<typeof open>>;
const open = async () => {
  let w = await seedWorkbench(JSON.parse(readFileSync(new URL("../data/seed-readings.json", import.meta.url), "utf8")), NOW);
  const t = w.items.find(i => i.source.id === "msg-tomato")!;
  w = confirmPlan(approve(w, t.id, ME, preview(w, t.id).reviewHash!, NOW), ME, NOW, { shipShort: true });
  w = receive(w, LATE.source, LATER);
  const id = w.items.at(-1)!.id, g = suggestReading(w, id);
  const reading = { operation: g.operation!, lotId: g.lotId!, quantity: g.quantity!, grade: g.grade!, deliveryOn: g.deliveryOn!, quote: numberSpan(LATE.source.text, String(g.quantity!.amount)) };
  return readByHandAndApprove(w, id, reading, ME, LATER, previewHand(w, id, reading, LATER)!.reviewHash).next;
};
const settle = (w: W, orderId: string, at = T3) => { const c = conflicts(w.ledger)[0]; return decideCut(w, c.lotId, [{ orderId, amount: c.excess }], c.excess, ME, at); };
const lines = (w: W) => JSON.stringify(w.ledger.commitments!.promised);

test("settle, change, settle the other way: the ledger is right and both events are kept", async () => {
  const w0 = await open(), c = conflicts(w0.ledger)[0], before = lines(w0), [a, b] = c.promises.map(p => p.orderId).sort();
  const first = settle(w0, a);
  assert.equal(conflicts(first.ledger).length, 0);
  const back = changeCut(first, c.lotId, T3, ME, T4);
  assert.equal(lines(back), before, "promises come back exactly");
  assert.equal(conflicts(back.ledger)[0].excess, c.excess);
  assert.notEqual(commitKey(back.ledger), commitKey(first.ledger), "stale pages elsewhere are refused by their cs check");
  const second = settle(back, b, T5);
  assert.equal(conflicts(second.ledger).length, 0);
  assert.notEqual(lines(second), lines(first));
  assert.deepEqual(second.ledger.commitments!.log.map(e => e.kind).slice(-3), ["cut", "cut-changed", "cut"]);
  assert.deepEqual(shortages(second.ledger).map(s => s.orderId).sort(), shortages(settle(await open(), b).ledger).map(s => s.orderId).sort());
  assert.equal(JSON.stringify(dayRecord(second, 1, T5)).match(/"cut-changed"/g)?.length, 1, "the day export shows both events");
});

test("a changed cut is not offered again, and a stale page is refused", async () => {
  const w0 = await open(), c = conflicts(w0.ledger)[0], first = settle(w0, c.promises[0].orderId);
  const offered = changeableCuts(first.ledger);
  assert.equal(offered.length, 1);
  assert.equal(offered[0].at, T3);
  const back = changeCut(first, c.lotId, T3, ME, T4);
  assert.equal(changeableCuts(back.ledger).length, 0);
  assert.throws(() => changeCut(back, c.lotId, T3, ME, T4), /not the latest cut/);
  assert.throws(() => changeCut(first, c.lotId, "2020-01-01T00:00:00.000Z", ME, T4), /changed or replaced/);
  const again = settle(back, c.promises[1].orderId, T5);
  assert.throws(() => changeCut(again, c.lotId, T3, ME, T4), /not the latest cut/, "an older page cannot undo the newer cut");
});

test("refusals: bad name, confirmed since, packed since, no record; the state is unchanged", async () => {
  const w0 = await open(), c = conflicts(w0.ledger)[0], first = settle(w0, c.promises[0].orderId), snap = JSON.stringify(first);
  assert.throws(() => changeCut(first, c.lotId, T3, " ", T4), /name/i);
  assert.throws(() => changeCut(confirmPlan(first, ME, T4, { shipShort: true }), c.lotId, T3, ME, T4), /confirmed again since/);
  const packed = markStage(first, c.promises[0].orderId, "packed", ME, T4);
  assert.throws(() => changeCut(packed, c.lotId, T3, ME, T4), /has been packed since/);
  assert.equal(changeableCuts(packed.ledger).length, 0, "nothing is offered once it can't be changed");
  const old = structuredClone(first);
  delete (old.ledger.commitments!.log.find(e => e.kind === "cut") as { removed?: unknown }).removed;
  assert.throws(() => changeCut(old, c.lotId, T3, ME, T4), /settled before changes were recorded/);
  assert.equal(JSON.stringify(first), snap, "input state is untouched");
});

test("the history line names the product and the grower", async () => {
  const w0 = await open(), c = conflicts(w0.ledger)[0], back = changeCut(settle(w0, c.promises[0].orderId), c.lotId, T3, ME, T4);
  assert.match(latestChange(back)!, /^A Name changed the cut on .+ from .+ at /);
});
