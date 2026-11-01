import type { Metadata } from "next";
import { measures, type Measures } from "../src/measures.ts";
import { conflicts, stageable } from "../src/commitments.ts";
import { lockGate } from "../src/pack.ts";
import { shortages } from "../src/orders.ts";
import { normalize } from "../src/quantity.ts";
import { orderStatus, unresolved } from "../src/resolve.ts";
import { approveAction, confirmAction, dismissNoChangeAction, stageAllAction } from "./actions.ts";
import { Basket, Calendar, Crate, Gap, Message } from "./icons.tsx";
import { HUB_NAME, ORDER_STATUS, buyer, changeLine, day, forecastTag, grower, quantity, status, time, weight } from "./lib/format.ts";
import { Problem, fieldId, type Bad } from "./lib/field-error.tsx";
import { current } from "./lib/hub.ts";
import { queueOrder } from "./lib/queue.ts";
import { rememberedName } from "./lib/name.ts";
import { readNotice } from "./lib/notice.ts";
import { ATTENTION_ROWS, becomesShort, byAttention, newSinceConfirm, overview, questionCounts, readyToApprove, stageCounts, staleSinceConfirm, unsettledLine, updateKind, type ProductRow } from "./lib/view.ts";
import { pendingCover } from "../src/orders.ts";
import { NamedSubmit } from "./named-submit.tsx";
import { PendingCover } from "./pending-cover.tsx";
import { Result } from "./result.tsx";

export const dynamic = "force-dynamic";
// The layout's title template applies to child pages only, so the Overview spells it out.
export const metadata: Metadata = { title: { absolute: "Overview · Harvest Relay" } };

// Amounts are in the hub's base unit (the demo hub works in pounds), taken from its orders.
type Unit = "g" | "lb" | "each";

function Meter({ r, unit }: { r: ProductRow; unit: Unit }) {
  const scale = Math.max(r.ordered, r.supply + r.forecast, 1), pct = (n: number) => `${(100 * n) / scale}%`;
  return (
    <div className="meter" role="img" aria-label={`${weight(r.direct + r.substitutedIn, unit)} of ${weight(r.ordered, unit)} ordered is covered`}>
      <span className="fill" style={{ width: pct(r.direct) }} />
      <span className="sub" style={{ left: pct(r.direct), width: pct(r.substitutedIn) }} />
      {r.short > 0 && <span className="gap" style={{ left: pct(r.direct + r.substitutedIn), width: pct(r.short) }} />}
      {r.forecast > 0 && <span className="forecast" style={{ left: pct(r.supply), width: pct(r.forecast) }} />}
    </div>
  );
}

// Half-circle gauge: share of ordered weight covered by the proposed allocation.
function Gauge({ covered }: { covered: number }) {
  const r = 100, len = Math.PI * r, on = len * Math.min(1, Math.max(0, covered));
  return (
    <div className="gauge" role="img" aria-label={`${Math.round(covered * 100)}% of ordered weight covered`}>
      <svg viewBox="0 0 240 130">
        <path d="M20 120a100 100 0 0 1 200 0" stroke="var(--surface-2)" strokeWidth="22" fill="none" strokeLinecap="round" />
        <path d="M20 120a100 100 0 0 1 200 0" stroke={covered >= 1 ? "var(--forest)" : "var(--sun)"} strokeWidth="22" fill="none" strokeLinecap="round" strokeDasharray={`${on} ${len}`} />
      </svg>
      <p className="value">{Math.round(covered * 100)}%</p>
      <p className="label">of ordered weight covered</p>
    </div>
  );
}

const MIX = ["var(--forest)", "var(--leaf)", "#9cc5a7", "#c9ddcf"];
function Donut({ rows, unit }: { rows: ProductRow[]; unit: Unit }) {
  const total = rows.reduce((n, r) => n + r.supply, 0) || 1, c = 2 * Math.PI * 52;
  let at = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Confirmed supply by product">
        <circle cx="70" cy="70" r="52" fill="none" stroke="var(--surface-2)" strokeWidth="18" />
        {rows.map((r, n) => { const part = (c * r.supply) / total, el = <circle key={r.product} cx="70" cy="70" r="52" fill="none" stroke={MIX[n % MIX.length]} strokeWidth="18" strokeDasharray={`${part} ${c}`} strokeDashoffset={-at} transform="rotate(-90 70 70)" />; at += part; return el; })}
        <text x="70" y="68" textAnchor="middle" fontSize="20" fontWeight="600" fill="currentColor">{weight(total, unit)}</text>
        <text x="70" y="88" textAnchor="middle" fontSize="11" fill="var(--ink-soft)">confirmed</text>
      </svg>
    </div>
  );
}

function SupplyCard({ rows, unit }: { rows: ProductRow[]; unit: Unit }) {
  return (
      <section className="card supply" aria-labelledby="supply">
      <div className="card-head">
        <div><h2 id="supply">Supply against orders</h2><p className="muted small">Confirmed supply only. Forecasts are dashed and never allocated.</p></div>
      </div>
      {rows.map(r => (
        <div className="produce" key={r.product}>
          <h3>{r.product}</h3>
          <Meter r={r} unit={unit} />
          <p className="legend">
            <span><b>{weight(r.supply, unit)}</b> confirmed</span>
            <span><b>{weight(r.ordered, unit)}</b> ordered</span>
            {r.substitutedIn > 0 && <span><b>{weight(r.substitutedIn, unit)}</b> by approved substitute</span>}
            {r.short > 0 && <span className="bad"><b>{weight(r.short, unit)}</b> short</span>}
            {r.unallocated > 0 && <span><b>{weight(r.unallocated, unit)}</b> unallocated</span>}
            {r.forecast > 0 && <span><b>{weight(r.forecast, unit)}</b> forecast, not confirmed</span>}
          </p>
        </div>
      ))}
    </section>
  );
}

// Only what measures() observes; no estimates. Times are rounded to the nearest minute.
function DayCard({ m, names }: { m: Measures; names: Map<string, string> }) {
  const r = m.resolvedBy;
  return (
    <section className="card day" aria-labelledby="day">
      <div className="card-head"><h2 id="day">This delivery day</h2><span className="muted small">Measured in this demo session</span></div>
      <div className="stats">
        <span className="stat"><b>{m.shortsDetected}</b><span>Shortages caught</span></span>
        <span className="stat"><b>{r.grower}</b><span>Grower asks that added supply</span></span>
        <span className="stat"><b>{r.substitute}</b><span>Substitutes agreed</span></span>
        <span className="stat"><b>{r.notice}</b><span>Buyers told they'd be short</span></span>
        <span className="stat"><b>{r.shipShort}</b><span>Orders shipped short</span></span>
      </div>
      <div>
        <h3>Time to first message to the buyer</h3>
        {m.minutesToBuyerNotice.length
          ? <ul className="minutes">{m.minutesToBuyerNotice.map(x => { const n = Math.round(x.minutes); return <li key={x.orderId}><b>{n} {n === 1 ? "minute" : "minutes"}</b> for {names.get(x.orderId) ?? x.orderId}</li>; })}</ul>
          : <p className="muted">No message sent to a buyer yet</p>}
        <p className="fine-print">From the grower message that made the order short to the first message sent to its buyer: a substitute offer or a shortfall notice.</p>
      </div>
    </section>
  );
}

type Params = Record<string, string | string[] | undefined>;

export default async function Overview({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams, row = typeof params.item === "string" ? params.item : undefined, notice = readNotice(params, { page: "/", id: row });
  const { state: w, version } = await current(), known = !!await rememberedName();
  const { plan, rows, previews } = overview(w), counts = questionCounts(previews);
  const s = w.ledger.snapshot, open = queueOrder(w.items.filter(i => i.state !== "approved" && i.state !== "dismissed"), counts);
  const delivery = s.orders[0]?.deliveryOn, unit: Unit = s.orders[0] ? normalize(s.orders[0].quantity).unit : "g";
  const fill = (orderId: string, kind: string) => plan.allocations.filter(a => a.orderId === orderId && a.kind === kind).reduce((n, a) => n + a.amount, 0);
  const gaps = shortages(w.ledger), toResolve = unresolved(w).flatMap(id => gaps.filter(g => g.orderId === id));
  const cuts = conflicts(w.ledger), settle = cuts.length, { blocking, warnings } = lockGate(w);
  const names = new Map(s.orders.map(o => [o.id, buyer(o.buyerId)]));
  // Work first, in this order: a cut to settle, orders still short, updates ready to approve, updates with
  // questions, then messages that can be dismissed. The card shows up to eight.
  const work = byAttention([
    ...cuts.map(c => ({ kind: "cut" as const, c })),
    ...toResolve.map(g => ({ kind: "short" as const, g, st: ORDER_STATUS[orderStatus(w, g.orderId)] })),
    ...open.map(i => { const p = previews.get(i.id); return { kind: updateKind(i, p), i, p, st: status(i, p) }; })
  ]), shown = work.slice(0, ATTENTION_ROWS);
  const ordered = rows.reduce((n, r) => n + r.ordered, 0), covered = rows.reduce((n, r) => n + r.direct + r.substitutedIn, 0), short = rows.reduce((n, r) => n + r.short, 0);
  // Messages that arrived after the plan was confirmed, and the plan's own state for the all-clear card.
  const fresh = newSinceConfirm(w), isNew = new Set(fresh.map(i => i.id)), confirmed = !!w.ledger.commitments?.confirmed;
  // Nothing short and no cut open: the plan can be confirmed even while updates wait.
  const canConfirm = blocking.length === 0 && settle === 0, stale = staleSinceConfirm(w), c = w.ledger.commitments, counts2 = stageCounts(w);
  const nextStage = stageable(w, "packed").length > 0 ? "packed" as const : stageable(w, "handed-off").length > 0 ? "handed-off" as const : undefined;
  // The name is asked once on the page: on the first form that records it; the others use it (quiet).
  const lockOn = "lock-plan"; // the confirm and Confirm again forms share a name: only one is on the page
  let asked = false;
  const quiet = () => { const q = asked; asked = true; return q; };
  // The result of an action done from a row: a problem with a field is shown beside that row's field,
  // anything else at the top of the card. Focus goes to the field, else the card's heading (the page's for a reset).
  const bad: Bad = notice && !notice.ok && notice.field && row ? { on: `${notice.on}-${row}`, field: notice.field, text: notice.text } : undefined;
  const top = notice && !notice.ok && !bad ? notice : undefined;
  const reset = notice?.ok && notice.on === "reset";
  const result = notice && <Result key={String(params.sig)} text={notice.ok ? notice.text : undefined} focus={bad ? fieldId(bad.on, bad.field) : reset ? "hub" : "needs"} />;
  const hidden = (item: string) => <><input type="hidden" name="item" value={item} /><input type="hidden" name="version" value={version} /><input type="hidden" name="from" value="/" /></>;
  return (
    <div className="overview">
      <div className="main-col">
      <section className="hero" aria-labelledby="hub">
        {reset && result}
        <h1 id="hub" tabIndex={-1}>{HUB_NAME}</h1>
        <p className="hero-sub"><span>{delivery ? `Delivery ${day(delivery)}` : "No delivery scheduled"}</span><span>{s.orders.length} buyer orders from {new Set(s.lots.map(l => l.growerId)).size} growers</span></p>
        <div className="stats">
          <span className="stat"><span className="icon"><Crate /></span><b>{weight(rows.reduce((n, r) => n + r.supply, 0), unit)}</b><span>confirmed supply</span></span>
          <span className="stat"><span className="icon"><Basket /></span><b>{weight(ordered, unit)}</b><span>ordered</span></span>
          <span className={`stat${short ? " bad" : ""}`}><span className="icon"><Gap /></span><b>{weight(short, unit)}</b><span>short</span></span>
          <span className="stat"><span className="icon"><Message /></span><b>{open.length}</b><span>{open.length === 1 ? "update to review" : "updates to review"}</span></span>
          {fresh.length > 0 && <span className="stat"><b>{fresh.length}</b><span>new {fresh.length === 1 ? "message" : "messages"} since you confirmed</span></span>}
        </div>
      </section>

      <section className="card needs" aria-labelledby="needs">
        {!reset && result}
        <div className="card-head"><h2 id="needs" tabIndex={-1}>Needs your attention</h2></div>
        {top && <p className="error" role="alert">{top.text}</p>}
        {notice?.ok && notice.on === "approve" && notice.res && row && (notice.res.startsWith("order:")
          ? <p className="small"><a className="button" href={`/orders?order=${encodeURIComponent(notice.res.slice(6))}`}>Resolve<span className="sr-only"> the new shortage</span></a></p>
          : <p className="small"><a href={`/review?item=${encodeURIComponent(row)}`}>Decide who takes the cut</a></p>)}
        {shown.length > 0 && (
          <div className="attention">
            {shown.map(x => {
              if (x.kind === "cut") return (
                <div key={x.c.lotId} className="short-order">
                  <span className="icon"><Crate /></span>
                  <span className="text"><b>{x.c.product}: {weight(x.c.excess, x.c.unit)} of what you promised can't be filled</b><span>Promises to settle: a lot dropped below what was promised.</span></span>
                  <a className="button primary" href="/orders">Decide who takes the cut<span className="sr-only"> on {x.c.product}</span></a>
                </div>
              );
              if (x.kind === "short") {
                const cover = pendingCover(w, x.g.orderId)[0], resolve = `/orders?order=${encodeURIComponent(x.g.orderId)}`;
                return (
                  <div key={x.g.orderId} className="short-order">
                    <span className="icon"><Crate /></span>
                    <span className="text"><b>{buyer(x.g.buyerId)}, {weight(x.g.short, x.g.unit)} {x.g.product} short</b><PendingCover w={w} orderId={x.g.orderId} /></span>
                    {x.st.label !== ORDER_STATUS.short.label && <span className={`chip ${x.st.tone}`}>{x.st.label}</span>}
                    {cover ? <>
                      <a className="button primary" href={`/review?item=${encodeURIComponent(cover.items[0].id)}`}>Review {grower(cover.growerId)}'s {cover.items.length === 1 ? "update" : "updates"}<span className="sr-only"> for {buyer(x.g.buyerId)}</span></a>
                      <a className="button" href={resolve}>Resolve<span className="sr-only"> {buyer(x.g.buyerId)}</span></a>
                    </> : <a className="button primary" href={resolve}>Resolve<span className="sr-only"> {buyer(x.g.buyerId)}</span></a>}
                  </div>
                );
              }
              const i = x.i, p = x.p, fresher = isNew.has(i.id);
              const newChip = fresher && <span className="chip wait">New since you confirmed</span>;
              if (x.kind === "asks") return (
                <a key={i.id} href={`/review?item=${i.id}`}>
                  <span className="icon"><Message /></span>
                  <span className="text"><b>{grower(i.source.growerId)}</b><span>{i.source.text}</span></span>
                  <span className="chips"><span className={`chip ${x.st.tone}`}>{x.st.label}</span>{newChip}</span>
                </a>
              );
              const ready = x.kind === "ready" && readyToApprove(i, p) ? p : undefined;
              const forecast = ready?.change.effect === "forecast";
              const lot = ready ? s.lots.find(l => l.id === ready.change.lotId) : undefined;
              const line = ready ? (forecast ? (forecastTag(ready.change) ?? "Forecast, not confirmed") : changeLine(ready.change.before, ready.change.after)) : undefined;
              const shorts = ready ? becomesShort(ready) : [];
              const on = (form: string) => `${form}-${i.id}`;
              return (
                <div key={i.id} className="item">
                  <span className="icon"><Message /></span>
                  <span className="text">
                    <a href={`/review?item=${i.id}`}><b>{grower(i.source.growerId)}</b></a>
                    <span>{i.source.text}</span>
                    {ready && <span className="change"><b>{lot ? `${lot.product}: ` : ""}{line}</b>{forecast && " (forecast, not confirmed supply)"}</span>}
                    {shorts.map(o => <span key={o.orderId} className="bad">{names.get(o.orderId) ?? o.orderId} becomes short {weight(o.after.short, o.unit)}</span>)}
                  </span>
                  <span className="chips"><span className={`chip ${x.st.tone}`}>{x.st.label}</span>{newChip}</span>
                  {ready ? (
                    <form action={approveAction} className="act">{hidden(i.id)}<input type="hidden" name="hash" value={ready.reviewHash} />
                      <NamedSubmit label={<>{forecast ? "Note this forecast" : "Approve"}<span className="sr-only"> {grower(i.source.growerId)}'s update</span></>} className="primary" known={known} on={on("approve")} bad={bad} quiet={quiet()} />
                    </form>
                  ) : (
                    <form action={dismissNoChangeAction} className="act">{hidden(i.id)}
                      <NamedSubmit label={<>Dismiss<span className="sr-only"> {grower(i.source.growerId)}'s message, no supply change</span></>} known={known} on={on("dismiss")} bad={bad} quiet={quiet()} />
                    </form>
                  )}
                </div>
              );
            })}
            {work.length > shown.length && <a href={work.slice(shown.length).some(x => x.kind === "ready" || x.kind === "asks" || x.kind === "dismiss") ? "/review" : "/orders"} className="more">and {work.length - shown.length} more <span className="sr-only">things that need you</span></a>}
          </div>
        )}
        {c ? (
          <div className="clear confirmed" role="group" aria-label="Plan confirmed">
            <p><b>Plan confirmed by {c.confirmed.by} at {time(c.confirmed.at)}</b></p>
            <p>{counts2.packed} of {counts2.total} packed, {counts2.handed} of {counts2.total} handed off</p>
            <div className="row">
              {nextStage && (
                <form action={stageAllAction}>
                  <input type="hidden" name="version" value={version} /><input type="hidden" name="stage" value={nextStage} /><input type="hidden" name="from" value="/" />
                  <NamedSubmit label={nextStage === "packed" ? "Mark all packed" : "Mark all handed off"} className="primary" known={known} on="stageall-stageall" bad={bad} quiet={quiet()} />
                </form>
              )}
              <a className="button" href="/pack?print=1">Print sheets</a>
              {stale && (canConfirm
                ? <form action={confirmAction}>{hidden("plan")}<NamedSubmit label="Confirm again" className={nextStage ? undefined : "primary"} known={known} on={lockOn} bad={bad} quiet={quiet()} /></form>
                : <a className="button" href="/pack">Confirm again on Pack</a>)}
            </div>
            {stale && <p className="small">The plan has changed since you confirmed. Confirm again to promise the new amounts.</p>}
          </div>
        ) : canConfirm ? (
          <form action={confirmAction} className="clear" id="confirm">{hidden("plan")}
            <p>{shown.length === 0 ? "Everything is covered. Confirm today's plan" : "Nothing is short. You can confirm today's plan."}</p>
            {warnings.length > 0 && <p className="small">{unsettledLine(warnings.length)}</p>}
            <NamedSubmit label="Confirm today's plan" className="primary" known={known} on={lockOn} bad={bad} quiet={quiet()} />
          </form>
        ) : null}
        {open.length > 0 && <a className="button" href="/review">Review updates</a>}
      </section>

      <section className="card orders" aria-labelledby="orders">
        <div className="card-head"><h2 id="orders">Buyer orders</h2><span className="row small muted"><Calendar /> {delivery ? day(delivery) : ""}</span></div>
        <div className="table-scroll"><table className="buyers">
          <thead><tr><th>Buyer</th><th>Wants</th><th className="num">Covered / ordered</th><th>Progress</th><th className="num">Short</th></tr></thead>
          <tbody>{s.orders.map(o => { const want = normalize(o.quantity).amount, direct = fill(o.id, "requested"), sub = fill(o.id, "approved-substitution"), gap = plan.unfilled.find(u => u.orderId === o.id)?.amount ?? 0, total = direct + sub + gap || 1; return (
            <tr key={o.id}>
              <td data-label="Buyer"><b>{buyer(o.buyerId)}</b></td>
              <td data-label="Wants">{o.product}{o.approvedSubstitutions.length ? <span className="muted small"><br />or {o.approvedSubstitutions.map(x => x.maxAmount !== undefined ? `${x.product} up to ${weight(x.maxAmount, normalize(o.quantity).unit)}` : x.product).join(", ")}</span> : null}</td>
              <td data-label="Covered / ordered" className="num">{weight(direct + sub, unit)} / {weight(want, unit)}</td>
              <td className="bar"><div className="progress" aria-hidden="true"><span style={{ width: `${(100 * direct) / total}%` }} /><span style={{ width: `${(100 * sub) / total}%` }} /></div></td>
              <td data-label="Short" className={`num${gap ? " worse" : ""}`}>{weight(gap, unit)}</td>
            </tr>
          ); })}</tbody>
        </table></div>
      </section>

      <SupplyCard rows={rows} unit={unit} />

      <details className="day-details">
        <summary>Day details</summary>
        <DayCard m={measures(w)} names={names} />
        <div className="day-grid">
          <section className="card side" aria-labelledby="coverage">
            <div className="card-head"><h2 id="coverage">Order coverage</h2></div>
            <Gauge covered={ordered ? covered / ordered : 1} />
          </section>
          <section className="card mix" aria-labelledby="mix">
            <h2 id="mix">Supply by product</h2>
            <Donut rows={rows} unit={unit} />
            <div className="key">{rows.map((r, n) => <span key={r.product}><i style={{ background: MIX[n % MIX.length] }} />{r.product}, {weight(r.supply, unit)}</span>)}</div>
          </section>
          <section className="card lots" aria-labelledby="lots">
            <h2 id="lots">Grower lots</h2>
            <div className="key">{s.lots.map(l => <span key={l.id}><b>{quantity(l.quantity)}</b> {l.product}, {grower(l.growerId)}</span>)}</div>
            {w.ledger.events.length > 0 && <>
              <h3>Approved changes</h3>
              <div className="key small">{w.ledger.events.map(e => { const l = s.lots.find(x => x.id === e.lotId); return <span key={e.id}><a href={`/events/${e.id}`}>{l ? `${l.product}, ${grower(l.growerId)}` : "Recorded change"}</a> {e.effect === "forecast" ? "forecast noted" : `${quantity(e.lotBefore)} to ${quantity(e.lotAfter)}`} by {e.approval.reviewer}</span>; })}</div>
            </>}
          </section>
        </div>
      </details>
      <p><a className="button" href="/export">Download the day record</a></p>
      </div>
    </div>
  );
}
