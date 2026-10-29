import { measures } from "../../src/measures.ts";
import { lockState } from "../../src/pack.ts";
import { proposeAllocations, snapshotHash } from "../../src/planner.ts";
import type { Workbench } from "../../src/workbench.ts";

// The day record as one consistent JSON object, built from a single workbench: the snapshot,
// its hash, the proposed plan computed from that same snapshot, every recorded change and
// forecast, the buyer's substitute consent and the lots added by hand (ledger records), the inbox with its decision history (where the model and prompt behind each
// automatic reading are kept), the order resolutions and the messages sent for them, the
// packing lock with its sheets' plan, and the measures. Pure; the export route serves it.
// The file's name: the delivery day it covers (the earliest order's), not the store version.
export function recordFilename(w: Workbench): string {
  const days = w.ledger.snapshot.orders.map(o => o.deliveryOn).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return `harvest-relay-day-${days[0] ?? "undated"}.json`;
}
export function dayRecord(w: Workbench, version: number, exportedAt: string) {
  const s = w.ledger.snapshot;
  return {
    label: "Harvest Relay demo day record. Synthetic growers, buyers and messages. Allocations are proposals, not reservations or deliveries.",
    exportedAt, storedVersion: version, ledgerVersion: w.ledger.version,
    snapshot: s, snapshotHash: snapshotHash(s), proposedPlan: proposeAllocations(s),
    events: w.ledger.events, forecasts: w.ledger.forecasts, records: w.ledger.records, inbox: w.items,
    resolutions: w.resolutions, outbox: w.outbox,
    lock: w.lock ? { state: lockState(w), ...w.lock } : null,
    measures: measures(w)
  };
}
