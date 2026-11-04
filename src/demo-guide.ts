import { conflicts, planOf, stageOf } from "./commitments.ts";
import type { Workbench } from "./workbench.ts";
import { changedOrderQuantities, changedSinceConfirm } from "./commitments.ts";

// Evidence of actions in this workspace, never completion inferred from the untouched seed.
export function demoProgress(w: Workbench) {
  const approved = (id: string) => w.items.find(i => i.source.id === id)?.state === "approved";
  const c = w.ledger.commitments, late = w.items.find(i => i.source.id === "msg-late-tomato");
  const plan = planOf(w.ledger);
  const unpromised = w.ledger.snapshot.orders.some(o => plan.allocations.filter(a => a.orderId === o.id).reduce((n, a) => n + a.amount, 0) > stageOf(w.ledger, o.id).promised);
  const ready = !!c && !unpromised && !changedSinceConfirm(w.ledger).length && !changedOrderQuantities(w.ledger).length && !conflicts(w.ledger).length;
  return {
    reduction: approved("msg-tomato"),
    cases: approved("msg-zucchini") && approved("msg-cucumber"),
    covered: approved("msg-tomato") && !planOf(w.ledger).unfilled.some(x => x.orderId === "order-b"),
    confirmed: ready,
    late: !!late && late.state === "approved" && ready && Date.parse(c!.confirmed.at) >= Date.parse(late.decisions.findLast(d => d.kind === "approved")?.at ?? "invalid")
  };
}
