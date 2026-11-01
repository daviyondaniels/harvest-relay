import type { Metadata } from "next";
import { measures, type Measures } from "../src/measures.ts";
import { conflicts } from "../src/commitments.ts";
import { shortages } from "../src/orders.ts";
import { normalize } from "../src/quantity.ts";
import { orderStatus, unresolved } from "../src/resolve.ts";
import { approveAction, confirmAction, dismissNoChangeAction } from "./actions.ts";
import { Basket, Calendar, Crate, Gap, Message } from "./icons.tsx";
import { HUB_NAME, ORDER_STATUS, buyer, changeLine, day, forecastTag, grower, quantity, status, weight } from "./lib/format.ts";
import { Problem, fieldId, type Bad } from "./lib/field-error.tsx";
import { current } from "./lib/hub.ts";
import { queueOrder } from "./lib/queue.ts";
import { rememberedName } from "./lib/name.ts";
import { readNotice } from "./lib/notice.ts";
import { becomesShort, dismissable, newSinceConfirm, overview, questionCounts, readyToApprove, type ProductRow } from "./lib/view.ts";
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
      <p className="fine-print">Allocation is a proposal from the hub's rules: direct orders first, then substitutes each buyer has already approved. Nothing is reserved, delivered to buyers or confirmed for delivery.</p>
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
        <span className="stat"><b>{m.shortsDetected}</b><span>{m.shortsDetected === 1 ? "short caught" : "shorts caught"}</span></span>
        <span className="stat"><b>{r.grower}</b><span>{r.grower === 1 ? "grower ask that added supply" : "grower asks that added supply"}</span></span>
        <span className="stat"><b>{r.substitute}</b><span>{r.substitute === 1 ? "substitute agreed" : "substitutes agreed"}</span></span>
        <span className="stat"><b>{r.notice}</b><span>{r.notice === 1 ? "shortfall notice sent" : "shortfall notices sent"}</span></span>
        <span className="stat"><b>{r.shipShort}</b><span>shipped short</span></span>
      </div>
      <p className="fine-print">Counts of actions, not of orders. One order can appear under several, a corrected notice to the same buyer counts again, and a grower ask counts once its reply added supply, even if the order is still short.</p>
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
  const settle = conflicts(w.ledger).length;
  const names = new Map(s.orders.map(o => [o.id, buyer(o.buyerId)]));
  // Work first: orders still short, then messages to review; the card shows the first four.
  const work = [...toResolve.map(g => ({ kind: "order" as const, g, st: ORDER_STATUS[orderStatus(w, g.orderId)] })), ...open.map(i => ({ kind: "update" as const, i, st: status(i, previews.get(i.id)) }))], shown = work.slice(0, 4);
  const ordered = rows.reduce((n, r) => n + r.ordered, 0), covered = rows.reduce((n, r) => n + r.direct + r.substitutedIn, 0), short = rows.reduce((n, r) => n + r.short, 0);
  // Messages that arrived after the plan was confirmed, and the plan's own state for the all-clear card.
  const fresh = newSinceConfirm(w), isNew = new Set(fresh.map(i => i.id)), confirmed = !!w.ledger.commitments?.confirmed;
  const clear = work.length === 0 && settle === 0;
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
        {notice?.ok && notice.on === "approve" && notice.res && row && <p className="small"><a href={`/review?item=${encodeURIComponent(row)}`}>Decide who takes the cut</a></p>}
        {settle > 0 && <p className="muted"><a href="/orders">Promises to settle</a>: {settle === 1 ? "1 lot dropped below what was promised" : `${settle} lots dropped below what was promised`}.</p>}
        {shown.length > 0 ? (
          <div className="attention">
            {shown.map(x => {
              if (x.kind === "order") {
                const cover = pendingCover(w, x.g.orderId)[0], resolve = `/orders?order=${encodeURIComponent(x.g.orderId)}`;
                return (
                  <div key={x.g.orderId} className="short-order">
                    <span className="icon"><Crate /></span>
                    <span className="text"><b>{buyer(x.g.buyerId)}, {weight(x.g.short, x.g.unit)} {x.g.product} short</b><PendingCover w={w} orderId={x.g.orderId} /></span>
                    {x.st.label !== ORDER_STATUS.short.label && <span className={`chip ${x.st.tone}`}>{x.st.label}</span>}
                    {cover ? <>
                      <a className="button primary" href={`/review?item=${encodeURIComponent(cover.items[0].id)}`}>Review {grower(cover.growerId)}'s {cover.items.length === 1 ? "update" : "updates"}<span className="sr-only"> for {buyer(x.g.buyerId)}</span></a>
                      <a className="plain" href={resolve}>Resolve<span className="sr-only"> {buyer(x.g.buyerId)}</span></a>
                    </> : <a className="button primary" href={resolve}>Resolve<span className="sr-only"> {buyer(x.g.buyerId)}</span></a>}
                  </div>
                );
              }
              const i = x.i, p = previews.get(i.id), fresher = isNew.has(i.id);
              const ready = readyToApprove(i, p), noChange = dismissable(i);
              const newChip = fresher && <span className="chip wait">New since you confirmed</span>;
              if (!ready && !noChange) return (
                <a key={i.id} href={`/review?item=${i.id}`}>
                  <span className="icon"><Message /></span>
                  <span className="text"><b>{grower(i.source.growerId)}</b><span>{i.source.text}</span></span>
                  <span className="chips"><span className={`chip ${x.st.tone}`}>{x.st.label}</span>{newChip}</span>
                </a>
              );
              const forecast = ready && p.change.effect === "forecast";
              const lot = ready ? s.lots.find(l => l.id === p.change.lotId) : undefined;
              const line = ready ? (forecast ? (forecastTag(p.change) ?? "Forecast, not confirmed") : changeLine(p.change.before, p.change.after)) : undefined;
              const shorts = ready ? becomesShort(p) : [];
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
                    <form action={approveAction} className="act">{hidden(i.id)}<input type="hidden" name="hash" value={p.reviewHash} />
                      <NamedSubmit label={<>{forecast ? "Note this forecast" : "Approve"}<span className="sr-only"> {grower(i.source.growerId)}'s update</span></>} className="primary" known={known} on={on("approve")} bad={bad} />
                    </form>
                  ) : (
                    <form action={dismissNoChangeAction} className="act">{hidden(i.id)}
                      <NamedSubmit label={<>Dismiss<span className="sr-only"> {grower(i.source.growerId)}'s message, no supply change</span></>} known={known} on={on("hold")} bad={bad} />
                    </form>
                  )}
                </div>
              );
            })}
            {work.length > shown.length && <a href={work.slice(shown.length).some(x => x.kind === "update") ? "/review" : "/orders"} className="more">and {work.length - shown.length} more <span className="sr-only">things that need you</span></a>}
          </div>
        ) : clear ? (
          confirmed ? (
            <div className="clear"><p><b>Plan confirmed.</b> Pack and hand off</p><a className="button primary" href="/pack">Pack and hand off</a></div>
          ) : (
            <form action={confirmAction} className="clear" id="confirm">{hidden("plan")}
              <p>Everything is covered. Confirm today's plan</p>
              <NamedSubmit label="Confirm today's plan" className="primary" known={known} on="lock-plan" bad={bad} />
            </form>
          )
        ) : <p className="muted">Nothing waiting. New grower messages appear here.</p>}
        <a className="bar-action" href="/review">Review updates</a>
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
