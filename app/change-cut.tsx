import { changeableCuts, commitKey } from "../src/commitments.ts";
import type { Workbench } from "../src/workbench.ts";
import { changeCutAction } from "./actions.ts";
import { NamedSubmit } from "./named-submit.tsx";
import { buyer, grower, possessive, weight } from "./lib/format.ts";

// "Change this cut" for each settled cut that can still be changed (the domain's changeableCuts: the latest cut
// on its lot, no confirm or packing since). A secondary button, so the page's one primary action stays as it was.
// only: show just the cuts on one lot, or touching one order. Once a cut cannot be changed nothing is offered.
export function ChangeCuts({ w, version, known, page, id, only }: { w: Workbench; version: number; known: boolean; page: "/orders" | "/pack" | "/review"; id?: string; only?: { lotId?: string; orderId?: string } }) {
  const l = w.ledger, list = changeableCuts(l).filter(c => (!only?.lotId || c.lotId === only.lotId) && (!only?.orderId || c.orders.includes(only.orderId)));
  if (!list.length) return null;
  const name = (orderId: string) => buyer(l.snapshot.orders.find(o => o.id === orderId)?.buyerId ?? orderId);
  return <>{list.map(c => {
    const lot = l.snapshot.lots.find(x => x.id === c.lotId), of = `${possessive(grower(lot?.growerId ?? ""))} ${c.product}`;
    return (
      <form key={c.lotId} action={changeCutAction} className="form no-print">
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="lot" value={c.lotId} />
        <input type="hidden" name="cutAt" value={c.at} />
        <input type="hidden" name="cs" value={commitKey(l)} />
        <input type="hidden" name="page" value={page} />
        <input type="hidden" name="ctx" value={id ?? ""} />
        <p className="small muted">{c.by} settled the cut on {of}: {c.cuts.map(x => `${name(x.orderId)} gets ${weight(x.amount, c.unit)} less`).join(", ")}.</p>
        <div className="row"><NamedSubmit label={<>Change this cut<span className="sr-only"> on {of}</span></>} known={known} on={`change-${c.lotId}`} purpose="changing this cut" /></div>
      </form>
    );
  })}</>;
}
