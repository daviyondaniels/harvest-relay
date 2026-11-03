import { measures } from "../../src/measures.ts";
import { conflicts, planOf, stageOf } from "../../src/commitments.ts";
import { snapshotHash } from "../../src/planner.ts";
import type { Workbench } from "../../src/workbench.ts";

// The day record as one consistent JSON object, built from a single workbench: the snapshot,
// its hash, the plan (promises kept, the rest proposed) computed from that same ledger, every recorded change and
// forecast, the buyer's substitute consent and the lots added by hand (ledger records), the inbox with its decision history (where the model and prompt behind each
// automatic reading are kept), the order resolutions and the messages sent for them, the
// commitments with open conflicts and order stages, and the measures. Pure; the export route serves it.
// The file's name: the delivery day it covers (the earliest order's), not the store version.
export function recordFilename(w: Workbench): string {
  const days = w.ledger.snapshot.orders.map(o => o.deliveryOn).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return `harvest-relay-day-${days[0] ?? "undated"}.json`;
}
export function dayRecord(w: Workbench, version: number, exportedAt: string) {
  const s = w.ledger.snapshot;
  return {
    label: "Harvest Relay demo day record. Synthetic growers, buyers and messages. Allocations are proposals until confirmed; confirmed allocations are promises to the buyer, not deliveries.",
    exportedAt, storedVersion: version, ledgerVersion: w.ledger.version,
    snapshot: s, snapshotHash: snapshotHash(s), proposedPlan: planOf(w.ledger),
    events: w.ledger.events, forecasts: w.ledger.forecasts, records: w.ledger.records, inbox: w.items,
    resolutions: w.resolutions, outbox: w.outbox,
    commitments: w.ledger.commitments ?? null, conflicts: conflicts(w.ledger),
    stages: Object.fromEntries(s.orders.map(o => [o.id, stageOf(w.ledger, o.id)])),
    measures: measures(w),
    // The authored time of a seeded grower message is not a real arrival time, so the minutes are demo timing, not a result.
    measuresNote: "minutesToBuyerNotice is demo timing: it runs from the authored time of a demo grower message to the recorded time of the message to the buyer. It does not measure a coordinator's work."
  };
}
