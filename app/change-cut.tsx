import { changeableCuts, commitKey } from "../src/commitments.ts";
import type { Workbench } from "../src/workbench.ts";
import { changeCutAction } from "./actions.ts";
import { NamedSubmit } from "./named-submit.tsx";
import { readNotice } from "./lib/notice.ts";
import { Result } from "./result.tsx";
import { fieldId, type Bad } from "./lib/field-error.tsx";
import { buyer, grower, possessive, weight } from "./lib/format.ts";

// "Change this cut" for each settled cut that can still be changed (the domain's changeableCuts: the latest cut
// on its lot, no confirm or packing since). A secondary button, so the page's one primary action stays as it was.
// only: show just the cuts on one lot, or touching one order. Once a cut cannot be changed nothing is offered.
export function ChangeCuts({ w, version, known, page, id, only, params }: { w: Workbench; version: number; known: boolean; page: "/orders" | "/pack" | "/review"; id?: string; params: Record<string, string | string[] | undefined>; only?: { lotId?: string; orderId?: string } }) {
  const l = w.ledger, list = changeableCuts(l).filter(c => (!only?.lotId || c.lotId === only.lotId) && (!only?.orderId || c.orders.includes(only.orderId)));
  if (!list.length) return null;
  // A refused name comes back as a notice on this form (on change-<lot>, field who), shown beside its name field.
  const notice = readNotice(params, { page, id }), mine = notice && !notice.ok && notice.field === "who" && notice.on?.startsWith("change-") ? notice : undefined;
  const name = (orderId: string) => buyer(l.snapshot.orders.find(o => o.id === orderId)?.buyerId ?? orderId);
  return <>{mine && list.some(c => `change-${c.lotId}` === mine.on) && <Result key={String(params.sig)} text={undefined} focus={fieldId(mine.on!, "who")} />}{list.map(c => {
    const bad: Bad = mine?.on === `change-${c.lotId}` ? { on: mine.on, field: "who", text: mine.text } : undefined;
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
        <div className="row"><NamedSubmit label={<>Change this cut<span className="sr-only"> on {of}</span></>} known={known} on={`change-${c.lotId}`} bad={bad} purpose="changing this cut" /></div>
      </form>
    );
  })}</>;
}
