import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dayRecord, recordFilename } from "../app/lib/record.ts";
import { measures } from "../src/measures.ts";
import { confirmPlan, conflicts, planOf, stageOf } from "../src/commitments.ts";
import { acceptSubstitute } from "../src/orders.ts";
import { ME, T, morning } from "./story.ts";

test("the day record carries the ledger, the resolutions, the outbox, the commitments and the measures", () => {
  const w = confirmPlan(morning(), ME, T(60), { shipShort: true });
  const before = JSON.stringify(w), r = dayRecord(w, 7, T(61));
  assert.equal(JSON.stringify(w), before, "building the record does not change the workbench");
  assert.equal(r.storedVersion, 7);
  for (const k of ["snapshot", "snapshotHash", "proposedPlan", "events", "forecasts", "records", "inbox", "resolutions", "outbox", "commitments", "conflicts", "stages", "measures"]) assert.ok(k in r, k);
  assert.ok(!("lock" in r), "the packing lock is gone");
  assert.deepEqual(r.proposedPlan, planOf(w.ledger));
  assert.deepEqual(r.stages["order-b"], stageOf(w.ledger, "order-b"));
  assert.deepEqual(r.conflicts, conflicts(w.ledger));
  assert.match(r.label, /Allocations are proposals until confirmed; confirmed allocations are promises to the buyer, not deliveries\./);
  assert.deepEqual(r.resolutions, w.resolutions);
  assert.deepEqual(r.outbox, w.outbox);
  assert.deepEqual(r.records, w.ledger.records, "consent and added lots are in the record");
  assert.equal(r.commitments?.confirmed.by, ME);
  assert.deepEqual(r.commitments?.shippedShort.map(s => s.orderId), ["order-b"]);
  assert.deepEqual(r.measures, measures(w));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)));
});

test("Task 23: the file is named for the delivery day, without the store version", () => {
  assert.equal(recordFilename(morning()), "harvest-relay-day-2026-10-30.json");
  const route = readFileSync(new URL("../app/export/route.ts", import.meta.url), "utf8");
  assert.match(route, /filename="\$\{recordFilename\(w\)\}"/);
  assert.doesNotMatch(route, /-v\$\{version\}/);
});

test("before confirming the record says there are no commitments", () => {
  assert.equal(dayRecord(morning(), 1, T(0)).commitments, null);
});

test("the route serves the record, and Pack links to it once the plan is confirmed", () => {
  const route = readFileSync(new URL("../app/export/route.ts", import.meta.url), "utf8"), pack = readFileSync(new URL("../app/pack/page.tsx", import.meta.url), "utf8");
  assert.match(route, /dayRecord\(w, version/);
  assert.match(pack, /href="\/export"[^>]*>Download day record/);
});

test("Final review: the record carries substitute consent and added lots", () => {
  let w = morning();
  const l = w.ledger, ev = { id: "e1", messageId: "m1", channel: "text" as const, text: "Yes, zucchini is fine.", quote: "zucchini is fine" };
  w = { ...w, ledger: acceptSubstitute(l, "order-b", { product: "zucchini", acceptedGrades: ["standard"], maxAmount: 30 }, ev, ME) };
  const r = dayRecord(w, 1, T(0));
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].kind, "substitute-accepted");
  assert.equal(r.records[0].recordedBy, ME);
});
