import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CONTACTS } from "../../src/demo.ts";
import { failedTheCheck } from "../../src/draft.ts";
import { hubDay } from "../../src/hub.ts";
import { template, type Confirm } from "../../src/messages.ts";
import { options, permissionSource, recommend, type Option } from "../../src/orders.ts";
import { planOf, stageOf } from "../../src/commitments.ts";
import { normalize } from "../../src/quantity.ts";
import { PendingCover } from "../pending-cover.tsx";
import { canSend, factsFor, openFor, orderStatus, toConfirm, type Resolution } from "../../src/resolve.ts";
import { BUYER_REPLIES, REQUEST_REPLIES, recordedDraft } from "../../src/seed.ts";
import type { Workbench } from "../../src/workbench.ts";
import { buyerReplyAction, confirmDraftAction, discardDraftAction, editDraftAction, liveAllowance, museDraftAction, requestedCallAction, scriptedRequestReplyAction, sendAction, startResolutionAction, supplyReplyAction } from "../actions.ts";
import { ORDER_STATUS, STAGE, buyer, day, grower, promiseText, quantity, time, weight } from "../lib/format.ts";
import { current, extras } from "../lib/hub.ts";
import { Problem, invalid, type Bad } from "../lib/field-error.tsx";
import { rememberedName } from "../lib/name.ts";
import { readNotice, type Notice } from "../lib/notice.ts";
import { QueueFold } from "../queue-fold.tsx";
import { NameNeeded } from "../name-needed.tsx";
import { Result } from "../result.tsx";
import { Conflicts } from "../conflict.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders" };

const KIND: Record<Resolution["kind"], string> = { "ask-grower": "Ask for more", "offer-substitute": "Substitute offer", "notify-short": "Notice to buyer" };
const STATE: Record<Resolution["status"], { label: string; tone: string }> = {
  drafted: { label: "Draft", tone: "wait" }, sent: { label: "Sent, awaiting answer", tone: "wait" }, accepted: { label: "Answered yes", tone: "done" }, declined: { label: "Answered no", tone: "quiet" }, discarded: { label: "Discarded", tone: "quiet" }
};
// What the card says once sent: a notice awaits nothing, and an ask with a linked reply waits on review, not on the grower.
function sentLabel(w: Workbench, r: Resolution): { label: string; tone: string } {
  if (r.option.kind === "notify-short") return { label: "Sent. Buyer told.", tone: "done" };
  if (r.linkedItemId) {
    const state = w.items.find(i => i.id === r.linkedItemId)?.state;
    return state === "approved" || state === "dismissed" ? { label: "Reply reviewed", tone: "done" } : { label: "Reply in review", tone: "wait" };
  }
  return STATE.sent;
}
const amountOf = (o: Option) => o.kind === "offer-substitute" ? o.covers : o.amount;
const target = (o: Option) => o.kind === "ask-grower" ? o.contactId : o.kind === "offer-substitute" ? `${o.product}/${o.grade}` : "buyer";
// A drafted message has asked no one; the order stays short until it is sent.
const unsent = (w: Workbench, orderId: string) => w.resolutions.some(r => r.orderId === orderId && r.status === "drafted");
// The card forms a notice can belong to, while the card still shows them, so a problem is
// shown beside its control or field rather than at the top of the order.
function cardForms(w: Workbench, r: Resolution): string[] {
  if (r.status === "drafted") return ["redraft", "edit", "send", "confirm", "discard"];
  if (r.status !== "sent" || r.option.kind === "notify-short") return [];
  if (r.option.kind === "offer-substitute" || !r.option.hasLot) return ["reply"];
  return r.linkedItemId ? [] : ["call", "script"];
}
type CardError = { on: string; text: string; field?: string };
// Fields of a card's forms, on the shared helper: the form is named by the card and the form on it.
function fields(rid: string, error?: CardError) {
  const bad: Bad = error?.field ? { on: `${rid}-${error.on}`, field: error.field, text: error.text } : undefined;
  return {
    inv: (on: string, name: string) => invalid(bad, `${rid}-${on}`, name),
    problem: (on: string, name: string): ReactNode => <Problem bad={bad} on={`${rid}-${on}`} name={name} />
  };
}
// One line of an order's thread, said as what a person did, with names and never IDs. How a
// draft was written (the template, or the model and whether it was recorded) stays here.
function ThreadLine({ r, d }: { r: Resolution; d: Resolution["decisions"][number] }) {
  const to = r.facts.to.name, what = KIND[r.kind].toLowerCase(), detail = (s: string) => <span className="muted small"> ({s})</span>;
  const source = (by?: string) => by ? detail(by === "Template" ? "from the template" : `suggested by ${by}`) : null;
  switch (d.kind) {
    case "drafted": return <>{d.actor} drafted the {what} to {to}{source(d.note)}</>;
    case "redrafted": return <>{d.actor} asked for other wording{source(d.note)}{r.fallback && d === r.decisions.findLast(x => x.kind === "redrafted") && detail(`kept the template: ${r.fallback}`)}</>;
    case "edited": return <>{d.actor} edited the message to {to}</>;
    case "confirmed": return <>{d.actor} confirmed the words</>;
    case "discarded": return <>{d.actor} discarded the draft{d.note ? `: “${d.note}”` : ""}</>;
    case "sent": return <>{d.actor} sent the {what} to {to}</>;
    case "reply-recorded": return <>{d.actor} recorded {to}'s answer: {d.note === "accepted" ? "yes" : "no"}</>;
    case "supply-recorded": return <>{d.actor} recorded {to}'s answer: {d.note?.startsWith("yes, ") ? `yes, ${d.note.slice(5)} ${r.option.unit}` : d.note ?? ""}</>;
    case "grower-replied": return <>{r.option.kind === "ask-grower" && d.actor === r.option.contactId ? `${to} replied` : `${to} called back, noted by ${d.actor}`}
      {d.note && <> <a href={`/review?item=${encodeURIComponent(d.note)}`}>See their reply</a></>}</>;
    default: return <>{d.actor}: {d.kind}</>;
  }
}

function Hidden({ order, version, res }: { order: string; version: number; res?: string }) {
  return <><input type="hidden" name="order" value={order} /><input type="hidden" name="version" value={version} />{res && <input type="hidden" name="res" value={res} />}</>;
}

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, wanted = typeof params.order === "string" ? params.order : undefined, raw = readNotice(params, { page: "/orders", id: wanted }), notice = raw?.on === "cut" ? undefined : raw;
  const { state: w, version } = await current();
  const orders = w.ledger.snapshot.orders, statuses = new Map(orders.map(o => [o.id, orderStatus(w, o.id)]));
  const o = orders.find(x => x.id === wanted) ?? orders.find(x => statuses.get(x.id) === "short" || statuses.get(x.id) === "resolving") ?? orders[0];
  return (
    <div className="workspace item-first">
      {notice?.field === "who" && <NameNeeded key={String(params.sig)} text={notice.text} />}
      <nav className="queue" aria-label="Buyer orders">
        <QueueFold count={orders.length} noun="orders" open={false}>
          <h2>Orders</h2>
          {orders.map(x => { const st = ORDER_STATUS[statuses.get(x.id)!]; return (
            <a key={x.id} href={`/orders?order=${x.id}`} aria-current={x.id === o?.id ? "true" : undefined}>
              <span className="row"><b>{buyer(x.buyerId)}</b></span>
              <span className="muted small">{quantity(x.quantity)} {x.product}, {day(x.deliveryOn)}</span>
              <span className="row"><span className={`chip ${st.tone}`}>{st.label}</span>{unsent(w, x.id) && <span className="chip quiet">Draft not sent</span>}</span>
            </a>
          ); })}
        </QueueFold>
      </nav>
      {o ? <Order w={w} orderId={o.id} version={version} notice={notice} sig={String(params.sig)} cuts={<Conflicts w={w} version={version} page="/orders" id={wanted} params={params} level={2} />} live={await liveAllowance()} me={await rememberedName()} /> : <p className="muted">No orders yet.</p>}
    </div>
  );
}

async function Order({ w, orderId, version, notice, sig, cuts, live, me }: { w: Workbench; cuts: ReactNode; orderId: string; version: number; notice?: Notice; sig: string; live: number; me?: string }) {
  const o = w.ledger.snapshot.orders.find(x => x.id === orderId)!, st = ORDER_STATUS[orderStatus(w, orderId)];
  const plan = planOf(w.ledger), lots = new Map(w.ledger.snapshot.lots.map(l => [l.id, l]));
  const mine = plan.allocations.filter(a => a.orderId === orderId), unit = normalize(o.quantity).unit;
  const direct = mine.filter(a => a.kind === "requested").reduce((n, a) => n + a.amount, 0);
  const subs = mine.filter(a => a.kind === "approved-substitution"), gap = plan.unfilled.find(u => u.orderId === orderId)?.amount ?? 0;
  const stage = stageOf(w.ledger, orderId), promised = promiseText(stage, mine.reduce((n, a) => n + a.amount, 0));
  const offered = options(w.ledger, orderId, CONTACTS).map((opt, index) => ({ opt, index }));
  const resolutions = w.resolutions.filter(r => r.orderId === orderId);
  // A problem from a card's form is shown on that card while the card still shows the form;
  // otherwise at the top. A result moves focus to the card it is about, or to the order.
  const onCard = !!notice && !notice.ok && notice.field !== "who" && !!notice.res && resolutions.some(r => r.id === notice.res && cardForms(w, r).includes(notice.on ?? ""));
  const focus = !notice || notice.field === "who" ? undefined
    : onCard && notice.field ? `${notice.res}-${notice.on}-${notice.field}`
    : (notice.ok || onCard) && notice.res && resolutions.some(r => r.id === notice.res) ? `${notice.res}-title` : "order";
  const today = hubDay(new Date().toISOString());
  const onFile = o.approvedSubstitutions.map(x => x.product).filter(p => permissionSource(w.ledger, orderId, p).kind === "on-file");
  const pick = recommend(w, orderId, CONTACTS), picked = pick && pick.kind !== "review-reply" ? offered.find(x => sameOption(x.opt, pick)) : undefined;
  const names: Record<string, string> = { ...Object.fromEntries(CONTACTS.map(c => [c.id, c.name])), [o.buyerId]: buyer(o.buyerId) };
  const card = (x: { opt: Option; index: number }) => <OptionCard key={x.index} {...x} order={orderId} buyerName={buyer(o.buyerId)} version={version} open={openFor(w, orderId, x.opt)} />;
  const rest = offered.filter(x => x !== picked);
  const reading = pick?.kind === "review-reply" ? pick : undefined;
  // A substitute covering under a quarter of the short is only ever listed here (docs/EVIDENCE.md R6).
  const groups: [string, { opt: Option; index: number }[], string?][] = [
    [`Growers with ${o.product}`, rest.filter(x => x.opt.kind === "ask-grower" && x.opt.hasLot)],
    ["Other growers and sources", rest.filter(x => x.opt.kind === "ask-grower" && !x.opt.hasLot)],
    ["Substitutes", rest.filter(x => x.opt.kind === "offer-substitute"), onFile.length
      ? `Standing permission on file for ${onFile.join(", ")}; the plan already uses it. Any other substitute needs the buyer's consent.`
      : "Each substitute needs the buyer's consent, recorded from their answer."],
    ["Tell the buyer", rest.filter(x => x.opt.kind === "notify-short")]
  ];
  const ex = extras();
  return <>
    <section className="panel" aria-labelledby="order">
      {notice && <Result key={sig} text={notice.ok ? notice.text : undefined} focus={focus} />}
      {notice && !notice.ok && !onCard && notice.field !== "who" && <p className="error" role="alert">{notice.text}</p>}
      <div className="section-head row">
        <h1 id="order" tabIndex={-1}>{buyer(o.buyerId)}</h1>
        <span className={`chip ${st.tone}`}>{st.label}</span>
        <span className={`chip ${STAGE[stage.stage].tone}`}>{STAGE[stage.stage].label}</span>
        {unsent(w, orderId) && <span className="chip quiet">Draft not sent</span>}
      </div>
      {cuts}
      {promised.length > 0 && <p className="muted small">{promised.join(". ")}.</p>}
      <p className="lot">
        <b>Wants</b><span>{quantity(o.quantity)} {o.product}</span><span>{o.acceptedGrades.join(" or ")}</span><span>{day(o.deliveryOn)}</span>
      </p>
      <table className="reading"><tbody>
        <tr><td>Gets {o.product}</td><td><b>{weight(direct, unit)}</b>{mine.filter(a => a.kind === "requested").map(a => <span key={a.lotId} className="muted small"><br />{weight(a.amount, unit)} from {grower(lots.get(a.lotId)!.growerId)}</span>)}</td></tr>
        {subs.length > 0 && <tr><td>Gets by substitute</td><td>{subs.map(a => <span key={a.lotId}>{weight(a.amount, unit)} {lots.get(a.lotId)!.product} from {grower(lots.get(a.lotId)!.growerId)}<br /></span>)}</td></tr>}
        <tr><td>Short</td><td className={gap ? "worse" : ""}>{weight(gap, unit)}</td></tr>
        <tr><td>Substitute permissions</td><td>{o.approvedSubstitutions.length ? o.approvedSubstitutions.map(s => { const src = permissionSource(w.ledger, orderId, s.product); return (
          <span key={s.product}>{s.product} ({s.acceptedGrades.join(", ")}){s.maxAmount !== undefined ? `, up to ${weight(s.maxAmount, unit)}` : ""}: {src.kind === "on-file" ? "standing permission on file" : src.record.kind === "substitute-accepted" ? <>agreed {src.record.evidence.channel === "call" ? "by phone" : "by text"}, recorded by {src.record.recordedBy}: <span className="quote">“{src.record.evidence.quote}”</span></> : "agreed"}<br /></span>
        ); }) : <span className="muted">None</span>}</td></tr>
      </tbody></table>

      {gap > 0 && <PendingCover w={w} orderId={orderId} />}

      {reading && <div className="option-group" aria-labelledby="next-step">
        <h2 id="next-step">Next step</h2>
        <div className="option-card primary-card">
          <b>Review {grower(reading.contactId)}'s reply: it is waiting in Review updates</b>
          <p className="draft">Read what they said before asking anyone else.</p>
          <div><a className="button primary" href={`/review?item=${encodeURIComponent(reading.itemId)}`}>Review the reply<span className="sr-only"> from {grower(reading.contactId)}</span></a></div>
        </div>
      </div>}
      {picked && <div className="option-group" aria-labelledby="next-step">
        <h2 id="next-step">Next step</h2>
        <PrimaryCard x={picked} order={orderId} buyerName={buyer(o.buyerId)} version={version} open={openFor(w, orderId, picked.opt)} why={why(picked.opt, o.product)}
          draft={template(factsFor(w, orderId, picked.opt, names))} />
      </div>}
      {offered.length > 0 ? (rest.length > 0 && <details className="option-group">
        <summary>Other options ({rest.length})</summary>
        {groups.map(([title, xs, note]) => (xs.length > 0 || note) && (
          <div key={title}>
            <h2>{title}</h2>
            {note && <p className="muted small">{note}</p>}
            {xs.length ? <div className="option-cards">{xs.map(card)}</div> : <p className="muted small">No {title.toLowerCase()} for this shortfall.</p>}
          </div>
        ))}
      </details>) : <p className="muted">This order is not short. Nothing to resolve.</p>}

      {resolutions.length > 0 && <div className="history">
        <h2>Thread and history</h2>
        <ol>{resolutions.flatMap(r => r.decisions.map((d, n) => (
          <li key={`${r.id}-${n}`}><span className="muted">{time(d.at)}</span> <ThreadLine r={r} d={d} /></li>
        ))).concat(resolutions.filter(r => r.reply).map(r => (
          <li key={`${r.id}-reply`}><span className="muted">{r.reply!.channel === "call" ? "Call note" : "Reply"}</span> “{r.reply!.text}”</li>
        )))}</ol>
      </div>}
      <p className="fine-print">Allocation rule: each product goes to direct orders first, by order priority, then to substitutes each buyer has already approved. Nothing is reserved or confirmed for delivery, and Send only records a message: nothing is delivered to buyers or growers.</p>
    </section>

    <aside className="preview" aria-labelledby="drafts">
      <h2 id="drafts">Messages</h2>
      {resolutions.length ? [...resolutions].reverse().map(r => (
        <ResolutionCard key={r.id} r={r} w={w} version={version} me={me} canSuggest={recordedDraft(ex, r.facts) !== undefined || live > 0} today={today} error={onCard && notice!.res === r.id ? { on: notice!.on!, text: notice!.text, field: notice!.field } : undefined} />
      )) : <p className="muted small panel">Choose an option to draft a message. Drafts start from a template that uses only the order's facts.</p>}
    </aside>
  </>;
}

const sameOption = (a: Option, b: Option) => a.kind === b.kind && target(a) === target(b) && amountOf(a) === amountOf(b);
// Why this is the pick, in a coordinator's words.
function why(o: Option, product: string): string {
  if (o.kind === "offer-substitute") return `the buyer already allows ${o.product}, and it covers ${weight(o.covers, o.unit)}`;
  if (o.kind === "notify-short") return "nobody else is left to ask";
  return o.hasLot ? `they hold ${product} for this day` : `${o.contactKind === "member" ? "a member grower" : "an outside source"} to try next`;
}
function PrimaryCard({ x, order, buyerName, version, open, why, draft }: { x: { opt: Option; index: number }; order: string; buyerName: string; version: number; open?: Resolution; why: string; draft: string }) {
  const { opt } = x, amt = weight(amountOf(opt), opt.unit);
  const line = opt.kind === "ask-grower" ? `Ask ${grower(opt.contactId)} for ${amt}` : opt.kind === "offer-substitute" ? `Offer ${buyerName} ${opt.product} (${opt.grade}) for ${amt}` : `Tell ${buyerName} the order is ${amt} short`;
  return (
    <form action={startResolutionAction} className="option-card primary-card">
      <Hidden order={order} version={version} />
      <input type="hidden" name="index" value={x.index} /><input type="hidden" name="kind" value={opt.kind} />
      <input type="hidden" name="amount" value={amountOf(opt)} /><input type="hidden" name="target" value={target(opt)} />
      <b>{line}: {why}</b>
      <p className="draft">{draft}</p>
      {open ? <a className="small" href={`#${open.id}`}>Message already open<span className="sr-only"> for this step</span></a>
        : <div><button className="primary" type="submit">Use this message<span className="sr-only">: {line}</span></button></div>}
    </form>
  );
}

function OptionCard({ opt, index, order, buyerName, version, open }: { opt: Option; index: number; order: string; buyerName: string; version: number; open?: Resolution }) {
  const amt = weight(amountOf(opt), opt.unit);
  return (
    <form action={startResolutionAction} className="option-card">
      <Hidden order={order} version={version} />
      <input type="hidden" name="index" value={index} /><input type="hidden" name="kind" value={opt.kind} />
      <input type="hidden" name="amount" value={amountOf(opt)} /><input type="hidden" name="target" value={target(opt)} />
      {opt.kind === "ask-grower" ? <>
        <b>{grower(opt.contactId)}</b>
        <span className="small">{opt.hasLot ? `Holds a lot for this day. Ask for ${amt} more.` : `Ask for ${amt}.`}</span>
        {!opt.hasLot && <span><span className="chip quiet">{opt.contactKind === "member" ? "Member grower" : "Outside source"}</span></span>}
        {opt.hasLot && opt.reducedRecently && <span className="small worse">Cut this lot in their latest update</span>}
      </> : opt.kind === "offer-substitute" ? <>
        <b>{opt.product} ({opt.grade})</b>
        <span className="small">Unallocated supply covers {amt}. Needs the buyer's yes.</span>
      </> : <>
        <b>Tell the buyer</b>
        <span className="small">The order will be {amt} short.</span>
      </>}
      {/* Seven cards each have this button, so its name says who the message is to. */}
      {open ? <a className="small" href={`#${open.id}`}>Message already open<span className="sr-only"> to {opt.kind === "ask-grower" ? grower(opt.contactId) : buyerName}</span></a>
        : <div><button type="submit">Draft message<span className="sr-only"> {opt.kind === "ask-grower" ? `to ${grower(opt.contactId)}` : opt.kind === "offer-substitute" ? `to ${buyerName} offering ${opt.product} (${opt.grade})` : `to ${buyerName} about the shortfall`}</span></button></div>}
    </form>
  );
}

function ResolutionCard({ r, w, version, me, canSuggest, today, error }: { r: Resolution; w: Workbench; version: number; me?: string; canSuggest: boolean; today: string; error?: CardError }) {
  const h = { order: r.orderId, version, res: r.id }, st = r.status === "sent" ? sentLabel(w, r) : STATE[r.status];
  // The words shown here are posted with Confirm, so only these are confirmed.
  const asks = r.status === "drafted" ? toConfirm(w, r, today) : [], confirmed = (c: Confirm) => !!r.confirmation?.items.includes(c.token);
  const open = asks.filter(c => !confirmed(c)), sendable = canSend(w, r, today);
  // A problem with a field is shown beside the field; one with a control, beside the control.
  const at = (on: string) => error?.on === on && !error.field, errId = (on: string) => at(on) ? `${r.id}-${on}-error` : undefined;
  const fieldError = (on: string) => at(on) && <p id={errId(on)} className="field-error" role="alert">{error!.text}</p>;
  const { inv, problem } = fields(r.id, error);
  const reviewed = ["approved", "dismissed"].includes(w.items.find(i => i.id === r.linkedItemId)?.state ?? "");
  const out = w.outbox.find(m => m.id === r.messageId), o = w.ledger.snapshot.orders.find(x => x.id === r.orderId)!;
  const to = r.facts.to.name, ctx = <span className="sr-only"> to {to}</span>;
  return (
    <div className="panel resolution" id={r.id}>
      <div className="card-head"><h3 id={`${r.id}-title`} tabIndex={-1}>{KIND[r.kind]} to {to}</h3><span className={`chip ${st.tone}`}>{st.label}</span></div>
      {r.author === "coordinator" && <p className="small"><span className="chip ready">{r.draftedBy === me ? "Edited by you" : `Edited by ${r.draftedBy}`}</span></p>}
      {r.fallback && <p className="small muted">{failedTheCheck(r.fallback) ? "No other wording passed the check. The template stands." : "Couldn't get other wording just now. The template stands."}</p>}
      <p className="draft">{r.text}</p>
      {!r.check.ok && (
        <div className="blocker small" role="status"><b>The check found {r.check.problems.length === 1 ? "a problem" : `${r.check.problems.length} problems`}</b>
          <ul>{r.check.problems.map(p => <li key={p}>{p}</li>)}</ul>
          <span className="muted">A warning only: you decide what to send.</span></div>
      )}
      {asks.length > 0 && (
        <div className="blocker small" role="status">
          <b>{open.length ? "Confirm these words before sending" : "Words confirmed"}</b>
          <ul>{asks.map(c => <li key={c.token}>{c.question.includes(`"${c.token}"`) ? c.question : `“${c.token}”: ${c.question}`}{confirmed(c) && <span className="muted"> Confirmed by {r.confirmation!.by}.</span>}</li>)}</ul>
          {open.length > 0 && <form action={confirmDraftAction} className="form"><Hidden {...h} />
            {asks.map(c => <input key={c.token} type="hidden" name="words" value={c.token} />)}
            <div><button type="submit" aria-describedby={errId("confirm")}>Confirm these words<span className="sr-only"> in the message to {to}</span></button></div>
          </form>}
          {fieldError("confirm")}
        </div>
      )}
      {r.status === "discarded" && <p className="small muted">Discarded: {r.decisions.findLast(d => d.kind === "discarded")?.note}</p>}
      {r.status === "drafted" && <>
        <details open={error?.on === "edit"}>
          <summary>Edit<span className="sr-only"> the message{ctx}</span></summary>
          <form action={editDraftAction} className="form"><Hidden {...h} />
            <label>Message<textarea name="body" required maxLength={480} rows={4} defaultValue={r.text} {...inv("edit", "body")} /></label>
            {problem("edit", "body")}
            <div><button type="submit">Save edit and check<span className="sr-only"> the message{ctx}</span></button></div>
          </form>
          {fieldError("edit")}
        </details>
        {canSuggest && <form action={museDraftAction} className="row"><Hidden {...h} />
          <button type="submit" aria-describedby={errId("redraft")}>Suggest other wording<span className="sr-only"> for the message{ctx}</span></button>
        </form>}
        {fieldError("redraft")}
        <form action={sendAction} className="form"><Hidden {...h} />
          <div className="row">
            <button className="primary" type="submit" disabled={!sendable} aria-describedby={errId("send")}>Send<span className="sr-only"> the message{ctx}</span></button>
            <span className="fine-print">{sendable ? "Recorded only; nothing is delivered." : "Confirm the words above first."}</span>
          </div>
        </form>
        {fieldError("send")}
        <details open={error?.on === "discard"}>
          <summary>Discard draft<span className="sr-only">{ctx}</span></summary>
          <form action={discardDraftAction} className="form"><Hidden {...h} />
            <label>Why it won't be sent<input name="reason" aria-required="true" maxLength={480} {...inv("discard", "reason")} /></label>
            {problem("discard", "reason")}
            {fieldError("discard")}
            <div><button type="submit">Discard draft<span className="sr-only">{ctx}</span></button></div>
            <p className="fine-print">The text stays in the history, and this option can be drafted again.</p>
          </form>
        </details>
      </>}
      {out && <p className="fine-print">Recorded as sent (demo: not delivered) by {out.sentBy}, {time(out.sentAt)}.</p>}
      {r.status === "sent" && r.option.kind === "offer-substitute" && <BuyerReply h={h} to={to} error={error} prefill={r.option.kind === "offer-substitute" && BUYER_REPLIES[o.buyerId]?.text.includes(r.option.product) ? BUYER_REPLIES[o.buyerId].text : undefined} />}
      {r.status === "sent" && r.option.kind === "ask-grower" && !r.option.hasLot && <ReplyForm h={h} to={to} error={error} grades={o.acceptedGrades} unit={r.option.unit} />}
      {r.status === "sent" && r.option.kind === "ask-grower" && r.option.hasLot && (r.linkedItemId
        ? reviewed
          ? <p className="small">Their reply was reviewed. <a href={`/review?item=${r.linkedItemId}`}>See their reply</a></p>
          : <p className="small">Their reply is in review. <a href={`/review?item=${r.linkedItemId}`}>Review the reply</a></p>
        : <>
            {REQUEST_REPLIES[r.option.contactId] && <form action={scriptedRequestReplyAction}><Hidden {...h} /><button type="submit" aria-describedby={errId("script")}>Receive the grower's reply (demo)<span className="sr-only"> from {to}</span></button></form>}
            {fieldError("script")}
            <details open={error?.on === "call"}>
              <summary>Log their call<span className="sr-only"> ({to})</span></summary>
              <form action={requestedCallAction} className="form"><Hidden {...h} />
                <label>What {to} said<textarea name="note" required maxLength={480} rows={3} {...inv("call", "note")} /></label>
                {problem("call", "note")}
                {fieldError("call")}
                <div><button type="submit">Log call as their reply</button></div>
                <p className="fine-print">The note goes to Review updates as their reply to this ask.</p>
              </form>
            </details>
          </>)}
      {r.reply && <p className="small">{r.reply.channel === "call" ? "Call note" : "Reply"}: <span className="quote">“{r.reply.quote}”</span></p>}
    </div>
  );
}

// Two taps: They said yes, They said no. What they said is a call note or the text pasted in full;
// a text holding the word supplies its own quote, otherwise the words that answer it are typed or pasted.
function BuyerReply({ h, to, error, prefill }: { h: { order: string; version: number; res: string }; to: string; error?: CardError; prefill?: string }) {
  const { inv, problem } = fields(h.res, error), mine = error?.on === "reply";
  return (
    <details open>
      <summary>Record the buyer's answer<span className="sr-only"> ({to})</span></summary>
      <form action={buyerReplyAction} className="form"><Hidden {...h} />
        <label>How it came<select name="channel" defaultValue={prefill ? "call" : "text"} {...inv("reply", "channel")}><option value="text">Text message</option><option value="call">Phone call</option></select></label>
        {problem("reply", "channel")}
        <label>What they said<textarea name="text" required maxLength={480} rows={2} defaultValue={prefill} {...inv("reply", "text")} /></label>
        <span className="fine-print">Paste their text in full, or write your call note.</span>
        {problem("reply", "text")}
        <label>Only if their text doesn't say plainly yes or no: the words that answer it<input name="quote" maxLength={480} {...inv("reply", "quote")} /></label>
        {problem("reply", "quote")}
        {problem("reply", "accept")}
        {mine && !error!.field && <p className="field-error" role="alert">{error!.text}</p>}
        <div className="row">
          <button type="submit" name="accept" value="yes">They said yes<span className="sr-only"> ({to})</span></button>
          <button type="submit" name="accept" value="no">They said no<span className="sr-only"> ({to})</span></button>
        </div>
      </form>
    </details>
  );
}

function ReplyForm({ h, to, error, grades, unit }: { h: { order: string; version: number; res: string }; to: string; error?: CardError; grades: string[]; unit: string }) {
  const { inv, problem } = fields(h.res, error), mine = error?.on === "reply";
  return (
    <details open>
      <summary>Record their reply<span className="sr-only"> ({to})</span></summary>
      <form action={supplyReplyAction} className="form"><Hidden {...h} />
        <label>How it came<select name="channel" defaultValue="text" {...inv("reply", "channel")}><option value="text">Text message</option><option value="call">Phone call</option></select></label>
        {problem("reply", "channel")}
        <label>Reply text, or your call note<textarea name="text" required maxLength={480} rows={2} {...inv("reply", "text")} /></label>
        {problem("reply", "text")}
        <label>For a text: the words that answer it, copied exactly<input name="quote" maxLength={480} {...inv("reply", "quote")} /></label>
        {problem("reply", "quote")}
        <label>Can they supply?<select name="yes" required defaultValue="" {...inv("reply", "yes")}><option value="" disabled>Choose</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        {problem("reply", "yes")}
        <div className="row">
          <label>Amount ({unit})<input name="amount" type="number" min="1" step="1" {...inv("reply", "amount")} /></label>
          <label>Grade<select name="grade" {...inv("reply", "grade")}>{grades.map(g => <option key={g}>{g}</option>)}</select></label>
        </div>
        {problem("reply", "amount")}{problem("reply", "grade")}
        {mine && !error!.field && <p className="field-error" role="alert">{error!.text}</p>}
        <div><button type="submit">Record reply<span className="sr-only"> from {to}</span></button></div>
        <p className="fine-print">A call note is its own evidence; a text needs the quoted words.</p>
      </form>
    </details>
  );
}
