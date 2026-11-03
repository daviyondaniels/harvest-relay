import { conflicts, type Conflict } from "../src/commitments.ts";
import type { Workbench } from "../src/workbench.ts";
import { decideCutAction } from "./actions.ts";
import { NamedSubmit } from "./named-submit.tsx";
import { Problem, fieldId, type Bad } from "./lib/field-error.tsx";
import { CutChoice } from "./cut-choice.tsx";
import { buyer, grower, possessive, weight } from "./lib/format.ts";
import { RECONFIRM } from "./lib/cut.ts";
import { readNotice } from "./lib/notice.ts";
import { Result } from "./result.tsx";

type Params = Record<string, string | string[] | undefined>;
const SUGGESTED = " — suggested: lowest priority on this lot";

// Every open conflict (or those on one lot), with the result or refusal of the last "Settle the
// cut" shown with it. The page it sits on is named so the action can come back to it; `id` is
// the item or order that page has open. Pages hide their own handling of these notices.
export function Conflicts({ w, version, known, page, id, params, level, lotId }: { w: Workbench; version: number; known: boolean; page: "/orders" | "/pack" | "/review"; id?: string; params: Params; level: 2 | 3; lotId?: string }) {
  const notice = readNotice(params, { page, id }), mine = notice?.on === "cut" ? notice : undefined;
  const list = conflicts(w.ledger).filter(c => !lotId || c.lotId === lotId), sig = String(params.sig);
  // A refused form comes back with what was chosen and typed; only whole numbers and this lot's own choices are used.
  const kept = (c: Conflict) => mine && !mine.ok && mine.res === c.lotId ? params : undefined;
  const bad = (c: Conflict): Bad => mine && !mine.ok && mine.res === c.lotId ? { on: `cut-${c.lotId}`, field: mine.field === "who" ? "who" : "cut", text: mine.text } : undefined;
  const loose = mine && !mine.ok && !list.some(c => c.lotId === mine.res);
  // The cut's result ends in a link: to Orders from Review and Pack, to the order's own Next step on Orders. The sentence that
  // says the sheets need confirming again links to Pack.
  const done = mine?.ok ? mine.text.match(/^(.*)Orders\.$/) : null, next = mine?.ok ? mine.text.match(/^(.*)See the next step\.$/) : null;
  const again = (t: string) => { const i = t.indexOf(RECONFIRM); return i < 0 ? t : <>{t.slice(0, i)}<a href="/pack">Confirm today's plan</a>{t.slice(i + "Confirm today's plan".length)}</>; };
  return <>
    {/* One mechanism: a success moves focus to the paragraph below, which is read once; it is not also said in the status region. */}
    {mine && <Result key={sig} text={undefined} focus={mine.ok ? "cut-done" : loose ? "cut-error" : fieldId(`cut-${mine.res}`, mine.field === "who" ? "who" : "cut")} />}
    {mine?.ok && <p id="cut-done" tabIndex={-1} className="result">{done ? <>{again(done[1])}<a href={`/orders?order=${encodeURIComponent(mine.res ?? "")}`}>Orders</a>.</> : next ? <>{again(next[1])}<a href="#next-step">See the next step</a>.</> : again(mine.text)}</p>}
    {loose && <p id="cut-error" tabIndex={-1} className="error" role="alert">{mine.text}</p>}
    {list.map(c => <ConflictPanel key={c.lotId} w={w} version={version} known={known} conflict={c} headingLevel={level} page={page} id={id} bad={bad(c)} kept={kept(c)} />)}
  </>;
}

// One lot that now holds less than was promised from it: whose promises broke, and who takes the cut.
export function ConflictPanel({ w, version, known, conflict: c, headingLevel, page, id, bad, kept }: { w: Workbench; version: number; known: boolean; conflict: Conflict; headingLevel: 2 | 3; page: string; id?: string; bad?: Bad; kept?: Params }) {
  const H = `h${headingLevel}` as "h2" | "h3", lot = w.ledger.snapshot.lots.find(l => l.id === c.lotId);
  const who = lot ? grower(lot.growerId) : "The grower", on = `cut-${c.lotId}`, cutOf = (orderId: string) => c.suggestion?.find(x => x.orderId === orderId)?.amount;
  const excess = weight(c.excess, c.unit), order = (orderId: string) => w.ledger.snapshot.orders.find(o => o.id === orderId);
  const name = (orderId: string) => buyer(order(orderId)?.buyerId ?? orderId), packed = (s: string) => s === "packed" || s === "handed-off";
  const single = c.suggestion?.length === 1 ? c.suggestion[0].orderId : undefined, split = (c.suggestion?.length ?? 0) > 1;
  const alone = c.promises.some(p => p.amount >= c.excess);
  // One promise has nobody to split with: the only choice is that buyer.
  const sole = c.promises.length === 1 && alone;
  const one = (k: string) => typeof kept?.[k] === "string" ? kept[k] as string : undefined;
  const picked = one("choice") && (one("choice") === "split" || c.promises.some(p => p.orderId === one("choice") && p.amount >= c.excess)) ? one("choice") : undefined;
  const typed = (orderId: string) => { const v = one(`cut-${orderId}`); return v && /^-?\d{1,9}(\.\d{1,9})?$/.test(v) ? v : undefined; };
  const initial = picked ?? (sole ? c.promises[0].orderId : single ?? (split || !alone ? "split" : undefined));
  return (
    <section className="panel conflict" aria-labelledby={`${on}-head`}>
      <H id={`${on}-head`} tabIndex={-1}>{possessive(who)} {c.product} dropped {excess}. You promised more than is left.</H>
      <ul>
        {c.promises.map(p => { const cut = cutOf(p.orderId); return <li key={p.orderId}>{name(p.orderId)}: promised {weight(p.amount, c.unit)}{cut !== undefined && <> → can now get {weight(p.amount - cut, c.unit)}</>}</li>; })}
      </ul>
      <p>Everyone else's {c.product} is unchanged.</p>
      <form action={decideCutAction} className="form" noValidate>
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="lot" value={c.lotId} />
        <input type="hidden" name="excess" value={c.excess} />
        <input type="hidden" name="page" value={page} />
        <input type="hidden" name="ctx" value={id ?? ""} />
        <fieldset id={fieldId(on, "cut")} tabIndex={-1} {...(bad?.field === "cut" ? { "aria-describedby": `${fieldId(on, "cut")}-error` } : {})}>
          <legend>Who takes the cut?</legend>
          {!c.suggestion && <p className="muted small">Every order on this lot is packed or handed off. Choose who takes the cut.</p>}
          <CutChoice on={on} excess={c.excess} excessText={excess} unit={c.unit} initial={initial} split={!sole}
            radios={c.promises.filter(p => p.amount >= c.excess).map(p => ({ id: p.orderId, label: `${name(p.orderId)} gets ${excess} less${single === p.orderId ? SUGGESTED : ""}${packed(p.stage) ? " (already packed)" : ""}` }))}
            splitLabel={`Split it${split ? SUGGESTED : ""}`}
            rows={c.promises.map(p => ({ id: p.orderId, label: `${name(p.orderId)} gets less by (up to ${weight(p.amount, c.unit)})`, max: p.amount, initial: (picked ? typed(p.orderId) : split ? String(cutOf(p.orderId) ?? 0) : undefined) ?? "" }))} />
          <Problem bad={bad} on={on} name="cut" />
        </fieldset>
        <div className="row"><NamedSubmit label={<>Settle the cut<span className="sr-only"> for {possessive(who)} {c.product}</span></>} className="primary" known={known} on={on} bad={bad} /></div>
      </form>
    </section>
  );
}
