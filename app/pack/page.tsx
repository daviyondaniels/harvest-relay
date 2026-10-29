import type { Metadata } from "next";
import { shortages } from "../../src/orders.ts";
import { lockGate, lockState, orderSheets, pickLists, type Lock } from "../../src/pack.ts";
import { orderStatus } from "../../src/resolve.ts";
import { lockAction } from "../actions.ts";
import { HUB_NAME, ORDER_STATUS, buyer, day, grower, time, weight } from "../lib/format.ts";
import { Problem, fieldId, invalid, type Bad } from "../lib/field-error.tsx";
import { current } from "../lib/hub.ts";
import { PrintButton } from "./print.tsx";
import { readNotice } from "../lib/notice.ts";
import { Result } from "../result.tsx";
import { PendingCover } from "../pending-cover.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pack" };

// The Pack tab: the gate, the lock, and the sheets drawn from the locked plan only. Once the
// live snapshot moves on, the lock has lapsed and its sheets are not shown, so an old sheet
// cannot be printed as current.
export default async function Pack({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, notice = readNotice(params, { page: "/pack" });
  const { state: w, version } = await current();
  const { blocking, warnings } = lockGate(w), state = lockState(w), gaps = new Map(shortages(w.ledger).map(s => [s.orderId, s]));
  // Orders the lock shipped short whose buyer has been told since; the lock itself is history.
  const toldSince = new Set(state === "valid" ? w.lock!.shippedShort.map(x => x.orderId).filter(id => orderStatus(w, id) === "buyer-told") : []);
  const shipped = new Set(state === "valid" ? w.lock!.shippedShort.map(x => x.orderId) : []);
  const orders = w.ledger.snapshot.orders, settled = orders.filter(o => !blocking.includes(o.id));
  // A refused lock is shown beside the Ship short box when it is on the page, else at the top.
  const bad: Bad = notice && !notice.ok && blocking.length > 0 ? { on: "lock", field: "shipShort", text: notice.text } : undefined;
  return (
    <div className="pack">
      {state === "lapsed" && <p className="error lapsed" role="alert"><b>Plan changed after locking. Review and lock again</b><br /><span className="small">The sheets from the earlier lock are hidden; they no longer match the plan.</span></p>}
      <section className="panel no-print" aria-labelledby="pack">
        {notice && <Result key={String(params.sig)} text={notice.ok ? notice.text : undefined} focus={bad ? fieldId(bad.on, bad.field) : notice.ok && state === "valid" ? "sheets" : "pack"} />}
        {notice && !notice.ok && !bad && <p className="error" role="alert">{notice.text}</p>}
        <div className="section-head row">
          <h1 id="pack" tabIndex={-1}>Pack</h1>
          {state === "valid" && <span className="chip ready">Locked</span>}
          {state === "lapsed" && <span className="chip block">Lock lapsed</span>}
          {state === "none" && <span className="chip quiet">Not locked</span>}
        </div>
        {state === "valid" && w.lock
          ? <div className="locked" role="group" aria-label="Plan locked">
              <p><b>Plan locked at {time(w.lock.at)}. Print the sheets.</b> <span className="muted small">Locked by {w.lock.lockedBy}.</span></p>
              <div className="row"><PrintButton /><a className="button" href="/export">Download day record</a></div>
            </div>
          : w.lock && <p className="muted small">Last locked by {w.lock.lockedBy}, {time(w.lock.at)}.</p>}

        <h2>Lock check</h2>
        <ul className="gate">
          {blocking.map(id => { const o = orders.find(x => x.id === id)!, g = gaps.get(id), st = ORDER_STATUS[orderStatus(w, id)]; return (
            <li key={id} className="fail">
              <span className="mark" aria-hidden="true">✕</span>
              <span><b>{buyer(o.buyerId)}</b>{g ? `, ${weight(g.short, g.unit)} ${g.product} short` : ""}{!(g && orderStatus(w, id) === "short") && <> <span className={`chip ${st.tone}`}>{st.label}</span></>}{shipped.has(id) && <> <span className="chip wait">Shipped short in this lock</span></>}{g && <PendingCover w={w} orderId={id} />}</span>
              <a className="button" href={`/orders?order=${encodeURIComponent(id)}`}>Resolve<span className="sr-only"> {buyer(o.buyerId)}</span></a>
            </li>
          ); })}
          {settled.map(o => { const st = ORDER_STATUS[orderStatus(w, o.id)]; return (
            <li key={o.id} className="pass">
              <span className="mark" aria-hidden="true">✓</span>
              <span><b>{buyer(o.buyerId)}</b> <span className={`chip ${st.tone}`}>{st.label}</span></span>
            </li>
          ); })}
          <li className={warnings.length ? "warn" : "pass"}>
            <span className="mark" aria-hidden="true">{warnings.length ? "!" : "✓"}</span>
            <span>{warnings.length
              ? <>{warnings.length === 1 ? "1 grower update" : `${warnings.length} grower updates`} not settled. The plan uses approved updates only, so this does not block the lock.</>
              : "Every grower update is settled."}</span>
            {warnings.length > 0 && <a className="button" href={`/review?item=${encodeURIComponent(warnings[0])}`}>Review</a>}
          </li>
        </ul>

        <form action={lockAction} className="form">
          <input type="hidden" name="version" value={version} />
          {blocking.length > 0 && (
            <label className="check"><input type="checkbox" name="shipShort" value="yes" {...invalid(bad, "lock", "shipShort")} /> Ship these orders short without telling the buyer yet. This is recorded.</label>
          )}
          <Problem bad={bad} on="lock" name="shipShort" />
          <div className="row">
            <button type="submit" className={state === "valid" ? undefined : "primary"}>{state === "valid" ? "Lock again" : "Lock plan for packing"}</button>
            {blocking.length > 0 && <span className="muted small">With orders still to resolve, the lock needs Ship short.</span>}
          </div>
        </form>
      </section>

      {state === "valid" && w.lock && <Sheets lock={w.lock} toldSince={toldSince} />}
    </div>
  );
}

// Each sheet is one printed page: the hub, the delivery day, then what to pack with a box to
// tick. Names only; no internal IDs.
function Sheets({ lock, toldSince }: { lock: Lock; toldSince: Set<string> }) {
  const picks = pickLists(lock), sheets = orderSheets(lock);
  return (
    <section className="sheets" aria-labelledby="sheets">
      <div className="card-head">
        <div><h2 id="sheets" tabIndex={-1}>Packing sheets</h2><p className="muted small">From the plan locked by {lock.lockedBy}, {time(lock.at)}. Each buyer and each grower prints on its own page.</p></div>
      </div>

      <h3>Order sheets</h3>
      <div className="sheet-grid">
        {sheets.map(s => (
          <article key={s.orderId} className="card sheet">
            <p className="sheet-hub small">{HUB_NAME}, delivery {day(s.deliveryOn)}</p>
            <div className="card-head"><h4>{buyer(s.buyerId)}</h4></div>
            <p>Ordered <b>{weight(s.ordered, s.unit)} {s.product}</b></p>
            <table><tbody>
              {s.lines.map(l => (
                <tr key={l.lotId}><td><span className="tick" aria-hidden="true" /></td><td className="num">{weight(l.amount, s.unit)}</td><td>{l.product}{l.substitute && " (substitute)"}, {l.grade}</td><td className="muted">{grower(l.growerId)}</td></tr>
              ))}
              {s.lines.length === 0 && <tr><td colSpan={4} className="muted">Nothing allocated</td></tr>}
            </tbody></table>
            {s.short > 0 && <p className="worse">Short {weight(s.short, s.unit)}</p>}
            {s.shippedShortUntold && (toldSince.has(s.orderId)
              ? <p className="flag told">Shipped short: buyer told after locking</p>
              : <p className="flag">Shipped short: buyer not told</p>)}
          </article>
        ))}
      </div>

      <h3>Pick lists</h3>
      <div className="sheet-grid">
        {picks.map(p => (
          <article key={p.growerId} className="card sheet">
            <p className="sheet-hub small">{HUB_NAME}, pick list</p>
            <h4>{grower(p.growerId)}</h4>
            {p.lines.map(l => (
              <div key={l.lotId}>
                <p><span className="tick" aria-hidden="true" /><b>{weight(l.total, l.unit)} {l.product}</b>, {l.grade}, delivery {day(l.deliveryOn)}</p>
                <ul className="small">{l.to.map(t => <li key={t.orderId}><span className="tick" aria-hidden="true" />{weight(t.amount, l.unit)} to {buyer(t.buyerId)}{t.kind === "approved-substitution" && " (substitute)"}</li>)}</ul>
                <p className="small">Left over: {weight(l.leftOver, l.unit)}</p>
              </div>
            ))}
          </article>
        ))}
        {picks.length === 0 && <p className="muted">Nothing to pick.</p>}
      </div>
    </section>
  );
}
