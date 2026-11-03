import type { Metadata } from "next";
import { CUT_FIRST, commitKey, conflicts, planOf, stageOf, stageable } from "../../src/commitments.ts";
import { shortages } from "../../src/orders.ts";
import { lockGate, orderSheets, pickLists } from "../../src/pack.ts";
import { orderStatus } from "../../src/resolve.ts";
import { canReceiveLate } from "../../src/seed.ts";
import type { Workbench } from "../../src/workbench.ts";
import { confirmAction, lateMessageAction, stageAction, stageAllAction } from "../actions.ts";
import { HUB_NAME, ORDER_STATUS, STAGE, buyer, day, grower, promiseText, time, weight } from "../lib/format.ts";
import { Problem, fieldId, invalid, type Bad } from "../lib/field-error.tsx";
import { current } from "../lib/hub.ts";
import { PickFold, PrintButton } from "./print.tsx";
import { changedSheets, staleSheetLine } from "../lib/cut.ts";
import { readNotice } from "../lib/notice.ts";
import { Result } from "../result.tsx";
import { Conflicts } from "../conflict.tsx";
import { ChangeCuts } from "../change-cut.tsx";
import { NamedSubmit } from "../named-submit.tsx";
import { rememberedName } from "../lib/name.ts";
import { PendingCover } from "../pending-cover.tsx";
import { CHECK_IT, CONFIRM_WITHOUT, LEAVE_PROMPT, SETTLE_FIRST, SHIP_SHORT, STALE_HEADING, arrivedLead, leaveSentence, leaveVisible, leavesShort, newSinceConfirm, overview, reallyShort, staleSentence, staleSinceConfirm, unsettledFor } from "../lib/view.ts";
import { AutoPrint } from "./print.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pack" };

// The Pack tab: the gate, the confirm, and the sheets drawn from the live plan. Confirmed
// promises are kept in it, so the sheets stay after supply moves; a line that differs from
// the confirm says what it was, so an old figure is never printed as if it were current.
export default async function Pack({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, notice = readNotice(params, { page: "/pack" }), shown = notice?.on === "cut" ? undefined : notice;
  const { state: w, version } = await current();
  const { blocking, warnings } = lockGate(w), gaps = new Map(shortages(w.ledger).map(s => [s.orderId, s]));
  const c = w.ledger.commitments, stale = staleSinceConfirm(w);
  // Orders shipped short whose buyer has been told since; the confirm itself is history.
  const shipped = new Set(c?.shippedShort.map(x => x.orderId) ?? []);
  const toldSince = new Set([...shipped].filter(id => orderStatus(w, id) === "buyer-told"));
  const orders = w.ledger.snapshot.orders, settled = orders.filter(o => !blocking.includes(o.id));
  // A refused confirm is shown beside the Ship short box when it is on the page, else at the top.
  const known = !!await rememberedName();
  // A missing name is shown beside the name field of the form that was refused (confirm, late message, or one order's stage).
  const noName: Bad = shown && !shown.ok && shown.field === "who" && (shown.on === "lock" || shown.on === "late" || ((shown.on === "stage" || shown.on === "stageall") && !!shown.res))
    ? { on: shown.on === "stage" ? `stage-${shown.res}` : shown.on === "stageall" ? `stageall-${shown.res}` : shown.on, field: "who", text: shown.text } : undefined;
  const bad: Bad = noName ?? (shown && !shown.ok && blocking.length > 0 && shown.text !== CUT_FIRST ? { on: "lock", field: "shipShort", text: shown.text } : undefined);
  const fresh = newSinceConfirm(w), arrived = fresh.length;
  // Same rule as the Overview: a waiting update that would leave a buyer short is reviewed before confirming. The domain
  // still allows confirming on approved updates only, so Pack keeps a secondary "Confirm without it".
  // It is shown before confirming, or while the plan is stale; never once everything is handed off.
  const leave = leaveVisible(w) ? leavesShort(w, overview(w).previews)[0] : undefined, cuts = conflicts(w.ledger), cutOpen = cuts.length > 0;
  // A buyer on a cut lot can be covered: only orders that are short now are marked short and counted.
  const shortNow = reallyShort(blocking, new Set(gaps.keys())), unsettled = unsettledFor(warnings, leave?.item.id);
  // The confirm form sits in the header once a plan is confirmed (its button is primary once the plan has changed), else under the gate.
  // With a cut open the one primary on the page is Settle the cut; the second confirm comes after it is settled.
  const confirmForm = c && stale && cutOpen ? <p className="small">{SETTLE_FIRST}</p> : (
    <form action={confirmAction} className="form">
      <input type="hidden" name="version" value={version} />
      {leave && <p className="small leave"><b>{leaveSentence(grower(leave.item.source.growerId), buyer(orders.find(o => o.id === leave.order.orderId)?.buyerId ?? leave.order.orderId), weight(leave.order.after.short, leave.order.unit))}</b> {LEAVE_PROMPT} <a href={`/review?item=${encodeURIComponent(leave.item.id)}`}>Review {grower(leave.item.source.growerId)}'s update</a></p>}
      {blocking.length > 0 && (
        <label className="check"><input type="checkbox" name="shipShort" value="yes" {...invalid(bad, "lock", "shipShort")} /> {SHIP_SHORT} without telling the buyer yet. This is recorded.</label>
      )}
      <Problem bad={bad} on="lock" name="shipShort" />
      <div className="row">
        <NamedSubmit label={leave ? CONFIRM_WITHOUT(grower(leave.item.source.growerId), leave.product, leave.before, leave.after) : c ? "Confirm again" : "Confirm today's plan"} className={leave || arrived > 0 ? undefined : "primary"} known={known} on="lock" bad={bad} />
        {blocking.length > 0 && <span className="muted small">Confirming with orders still to resolve needs “{SHIP_SHORT}”.</span>}
      </div>
    </form>
  );
  // The cut card sits on this page, so the checklist jumps to it; with no card to show it goes to the cut's page.
  const cutLink = (lot?: string) => lot && cutOpen ? `#cut-${lot}-head` : `/orders#cut-${lot}-head`;
  const checklist = (
  <ul className="gate">
    {blocking.map(id => { const o = orders.find(x => x.id === id)!, g = gaps.get(id), st = ORDER_STATUS[orderStatus(w, id)]; return !g ? (
      <li key={id} className="warn">
        <span className="mark" aria-hidden="true">!</span>
        <span><b>{buyer(o.buyerId)}</b> <span className={`chip ${st.tone}`}>{st.label}</span> Covered now, on a lot with a cut to settle.</span>
        <a className="button" href={cutLink(cuts.find(x => x.promises.some(p => p.orderId === id))?.lotId)}>Settle the cut</a>
      </li>
    ) : (
      <li key={id} className="fail">
        <span className="mark" aria-hidden="true">✕</span>
        <span><b>{buyer(o.buyerId)}</b>{g ? `, ${weight(g.short, g.unit)} ${g.product} short` : ""}{!(g && orderStatus(w, id) === "short") && <> <span className={`chip ${st.tone}`}>{st.label}</span></>}{shipped.has(id) && <> <span className="chip wait">Shipped short at confirm</span></>}{g && <PendingCover w={w} orderId={id} />}</span>
        <a className="button" href={`/orders?order=${encodeURIComponent(id)}`}>Resolve<span className="sr-only"> {buyer(o.buyerId)}</span></a>
      </li>
    ); })}
    {settled.map(o => { const st = ORDER_STATUS[orderStatus(w, o.id)]; return (
      <li key={o.id} className="pass">
        <span className="mark" aria-hidden="true">✓</span>
        <span><b>{buyer(o.buyerId)}</b> <span className={`chip ${st.tone}`}>{st.label}</span></span>
      </li>
    ); })}
    <li className={unsettled ? "warn" : "pass"}>
      <span className="mark" aria-hidden="true">{unsettled ? "!" : "✓"}</span>
      <span>{unsettled ?? (leave ? "No other grower updates are waiting." : "Every grower update is settled.")}</span>
      {unsettled && <a className="button" href={`/review?item=${encodeURIComponent(warnings.find(id => id !== leave?.item.id) ?? warnings[0])}`}>Review</a>}
    </li>
  </ul>
  );
  return (
    <div className="pack">
      <section className="panel no-print" aria-labelledby="pack">
        {shown && <Result key={String(params.sig)} text={shown.ok ? shown.text : undefined} focus={bad ? fieldId(bad.on, bad.field) : shown.ok && c ? (shown.on === "late" && shown.res ? "late-link" : shown.on === "stage" && shown.res ? `sheet-${shown.res}` : "sheets") : "pack"} />}
        {shown && !shown.ok && !bad && <p className="error" role="alert">{shown.text}</p>}
        <div className="section-head row">
          <h1 id="pack" tabIndex={-1}>Pack</h1>
          {!c && <span className="chip quiet">Not confirmed</span>}
          {c && !stale && <span className="chip ready">Confirmed</span>}
          {stale && <span className="chip wait">Changed since confirmed</span>}
        </div>
        {shown?.ok && shown.on === "late" && shown.res && <p><a id="late-link" href={`/review?item=${encodeURIComponent(shown.res)}`}>Open the late message in Review</a></p>}
        <Conflicts w={w} version={version} known={known} page="/pack" params={params} level={2} />
        <ChangeCuts w={w} version={version} known={known} page="/pack" />
        {c && (
          <div className="locked" role="group" aria-label="Plan confirmed">
            {stale && <div className="warnbox"><h3>{STALE_HEADING}</h3><p>{staleSentence(w, cutOpen)} Each changed line on a sheet says what it was.</p></div>}
            <p><b>Confirmed by {c.confirmed.by} at {time(c.confirmed.at)}.</b>{!stale && arrived === 0 && " Print the sheets."}</p>
            {arrived > 0 && <p className="small"><b>{arrivedLead(arrived)}</b> <a className="button primary" href={`/review?item=${encodeURIComponent(fresh[0].id)}`}>{CHECK_IT(arrived)}</a></p>}
            <div className="row"><PrintButton primary={!stale && arrived === 0} outOfDate={stale} /><a className="button" href="/export">Download day record</a></div>
            {stale && confirmForm}
          </div>
        )}

        {c ? (
          <>
            <p className="small">{shortNow.length ? `${shortNow.length} ${shortNow.length === 1 ? "order is" : "orders are"} still short.` : cutOpen ? "No order is short, but a cut is still to settle." : "Every order is covered or settled."}{unsettled && ` ${unsettled}`}</p>
            <details className="checklist no-print" open={blocking.length > 0}><summary>Show checklist</summary>
            {checklist}
            </details>
          </>
        ) : (
          <>
            <h2>Before you confirm</h2>
            {checklist}
          </>
        )}

        {!c && confirmForm}
      </section>

      {c && params.print === "1" && <AutoPrint />}
      {c && <Sheets w={w} version={version} toldSince={toldSince} known={known} bad={bad} />}
      {c && canReceiveLate(w) && (
        <details className="demo-tools no-print" open={bad?.on === "late"}>
          <summary>Demo tools</summary>
          <div className="demo" role="group" aria-label="Demo"><span className="demo-tag">Demo</span>
            <form action={lateMessageAction} className="form">
              <input type="hidden" name="version" value={version} />
              <div><NamedSubmit label={<>Late grower message (demo)<span className="sr-only"> from Birch Hollow Gardens</span></>} known={known} on="late" bad={bad} /></div>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}

// Each sheet is one printed page: the hub, the delivery day, then what to pack with a box to
// tick. Names only; no internal IDs.
function Sheets({ w, version, toldSince, known, bad }: { w: Workbench; version: number; toldSince: Set<string>; known: boolean; bad: Bad }) {
  const l = w.ledger, c = l.commitments!, picks = pickLists(l), sheets = orderSheets(l), plan = planOf(l), stamp = `Confirmed by ${c.confirmed.by} at ${time(c.confirmed.at)}.`, changed = changedSheets(l);
  // A sheet whose lines changed says so on paper too: the warning box above is not printed.
  const staleLine = <p className="flag stale-sheet">{staleSheetLine(time(c.confirmed.at))}</p>;
  return (
    <section className="sheets" aria-labelledby="sheets">
      <div className="card-head">
        <div><h2 id="sheets" tabIndex={-1}>Packing sheets</h2><p className="muted small">From the plan confirmed by {c.confirmed.by}, {time(c.confirmed.at)}. Each buyer and each grower prints on its own page.</p></div>
      </div>

      <h3>Order sheets</h3>
      <div className="row no-print">
        {(["packed", "handed-off"] as const).map(st => stageable(w, st).length > 0 && (
          <form key={st} action={stageAllAction}>
            <input type="hidden" name="version" value={version} />
            <input type="hidden" name="stage" value={st} />
            <input type="hidden" name="orders" value={stageable(w, st).join(",")} />
            <input type="hidden" name="cs" value={commitKey(l)} />
            <NamedSubmit label={st === "packed" ? "Mark all packed" : "Mark all handed off"} known={known} on={`stageall-${st}`} bad={bad} />
          </form>
        ))}
      </div>
      <div className="sheet-grid">
        {sheets.map(s => { const st = stageOf(l, s.orderId), notes = promiseText(st, plan.allocations.filter(a => a.orderId === s.orderId).reduce((n, a) => n + a.amount, 0)); return (
          <article key={s.orderId} className="card sheet">
            <p className="sheet-hub small">{HUB_NAME}, delivery {day(s.deliveryOn)}. {stamp}</p>
            {changed.orders.has(s.orderId) && staleLine}
            <div className="card-head"><h4 id={`sheet-${s.orderId}`} tabIndex={-1}>{buyer(s.buyerId)}</h4><span className={`chip ${STAGE[s.stage].tone}`}>{STAGE[s.stage].label}</span></div>
            <p>Ordered <b>{weight(s.ordered, s.unit)} {s.product}</b></p>
            {s.undecided && <p className="flag">Cut not decided yet</p>}
            {notes.length > 0 && <p className="small">{notes.join(". ")}.</p>}
            <table>
              <thead className="sheet-cols"><tr><th scope="col">Packed</th><th scope="col" className="num">Amount</th><th scope="col">Product and grade</th><th scope="col">Grower</th></tr></thead>
              <tbody>
              {s.lines.map(x => (
                <tr key={x.lotId}><td><span className="tick" aria-hidden="true" /></td><td className="num"><span className="amt">{weight(x.amount, s.unit)}</span>{x.was !== undefined && <span className="was muted small">(was {weight(x.was, s.unit)} at confirm)</span>}</td><td>{x.product}{x.substitute && " (substitute)"}, {x.grade}</td><td className="muted who">{grower(x.growerId)}</td></tr>
              ))}
              {s.lines.length === 0 && <tr><td colSpan={4} className="muted">Nothing allocated</td></tr>}
            </tbody></table>
            {s.short > 0 && <p className="worse">Short {weight(s.short, s.unit)}</p>}
            {s.shippedShortUntold && (toldSince.has(s.orderId)
              ? <p className="flag told">Shipped short: buyer told after confirming</p>
              : <p className="flag">Shipped short: buyer not told</p>)}
            {((s.stage === "promised" && st.promised > 0) || s.stage === "packed") && (
              <form action={stageAction} className="no-print">
                <input type="hidden" name="version" value={version} />
                <input type="hidden" name="order" value={s.orderId} />
                <input type="hidden" name="cs" value={commitKey(l)} />
                <input type="hidden" name="stage" value={s.stage === "promised" ? "packed" : "handed-off"} />
                <NamedSubmit label={<>{s.stage === "promised" ? "Mark packed" : "Mark handed off"}<span className="sr-only"> for {buyer(s.buyerId)}</span></>} known={known} on={"stage-" + s.orderId} bad={bad} />
              </form>
            )}
          </article>
        ); })}
      </div>

      <PickFold count={picks.length}>
      <div className="sheet-grid">
        {picks.map(p => (
          <article key={p.growerId} className="card sheet">
            <p className="sheet-hub small">{HUB_NAME}, pick list, delivery {[...new Set(p.lines.map(x => day(x.deliveryOn)))].join(", ")}. {stamp}</p>
            {p.lines.some(x => changed.lots.has(x.lotId)) && staleLine}
            <h4>{grower(p.growerId)}</h4>
            {p.lines.map(l => (
              <div key={l.lotId}>
                {l.undecided && <p className="flag small">Cut not decided yet</p>}
                <p><span className="tick" aria-hidden="true" /><b>{weight(l.total, l.unit)} {l.product}</b>, {l.grade}, delivery {day(l.deliveryOn)}</p>
                <table className="picks">
                  <thead className="sheet-cols"><tr><th scope="col">Packed</th><th scope="col" className="num">Amount</th><th scope="col">To buyer</th></tr></thead>
                  <tbody>{l.to.map(t => <tr key={t.orderId}><td><span className="tick" aria-hidden="true" /></td><td className="num"><span className="amt">{weight(t.amount, l.unit)}</span>{t.was !== undefined && <span className="was muted small">(was {weight(t.was, l.unit)} at confirm)</span>}</td><td className="who">{buyer(t.buyerId)}{t.kind === "approved-substitution" && " (substitute)"}</td></tr>)}</tbody>
                </table>
                <p className="small">Left over: {weight(l.leftOver, l.unit)}</p>
              </div>
            ))}
          </article>
        ))}
        {picks.length === 0 && <p className="muted">Nothing to pick.</p>}
      </div>
      </PickFold>
    </section>
  );
}
