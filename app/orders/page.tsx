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
import { canSend, draftWaiting, factsFor, noNote, openFor, orderStatus, toConfirm, toldBuyer, type Resolution } from "../../src/resolve.ts";
import { REQUEST_REPLIES, recordedDraft } from "../../src/seed.ts";
import type { Workbench } from "../../src/workbench.ts";
import type { Order } from "../../src/planner.ts";
import { buyerReplyAction, confirmDraftAction, discardDraftAction, editDraftAction, liveAllowance, museDraftAction, requestedCallAction, scriptedRequestReplyAction, sendAction, sendNowAction, startResolutionAction, supplyReplyAction } from "../actions.ts";
import { NOT_PROMISED, ORDER_STATUS, buyer, orderChip, day, grower, promiseText, quantity, time, weight } from "../lib/format.ts";
import { current, extras } from "../lib/hub.ts";
import { Problem, fieldId, invalid, type Bad } from "../lib/field-error.tsx";
import { rememberedName } from "../lib/name.ts";
import { readKept } from "../lib/kept.ts";
import { readNotice, type Notice } from "../lib/notice.ts";
import { QueueFold } from "../queue-fold.tsx";
import { NameField, NamedSubmit } from "../named-submit.tsx";
import { Result } from "../result.tsx";
import { Conflicts } from "../conflict.tsx";
import { ChangeCuts } from "../change-cut.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders" };

const KIND: Record<Resolution["kind"], string> = { "ask-grower": "Ask for more", "offer-substitute": "Substitute offer", "notify-short": "Shortage notice" };
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
// A sent message still waiting for an answer the coordinator records: an ask to an outside source, or an offer to the buyer.
// An ask to a grower who holds the product is answered in Review updates, so it waits on that instead.
const isWaiting = (r: Resolution) => r.status === "sent" && (r.option.kind === "offer-substitute" || (r.option.kind === "ask-grower" && !r.linkedItemId));
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
    // What a NamedSubmit on the form `on` of this card needs, to ask for a name beside it.
    named: (known: boolean, on: string) => ({ known, on: `${rid}-${on}`, bad }),
    inv: (on: string, name: string) => invalid(bad, `${rid}-${on}`, name),
    problem: (on: string, name: string): ReactNode => <Problem bad={bad} on={`${rid}-${on}`} name={name} />
  };
}
// One line of an order's thread, said as what a person did, with names and never IDs. How a
// draft was written (the template, or the model and whether it was recorded) stays here.
function ThreadLine({ r, d, reviewed }: { r: Resolution; d: Resolution["decisions"][number]; reviewed: boolean }) {
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
      {d.note && reviewed && <> <a href={`/review?item=${encodeURIComponent(d.note)}`}>See their reply</a></>}</>;
    default: return <>{d.actor}: {d.kind}</>;
  }
}

function Hidden({ order, version, res }: { order: string; version: number; res?: string }) {
  return <><input type="hidden" name="order" value={order} /><input type="hidden" name="version" value={version} />{res && <input type="hidden" name="res" value={res} />}</>;
}

// How the Substitutes row says a buyer agreed. Words are quoted only when they are the buyer's own: an answer recorded
// with no channel (or no note) has none, and is never put in quotation marks.
function agreedLine(channel: string, by: string, quote: string): ReactNode {
  if (channel === "recorded") return `agreed (recorded by ${by}, no note)`;
  const how = channel === "call" ? " by phone" : channel === "text" ? " by text" : "";
  if (channel === "call" && quote === noNote(by)) return `agreed${how} (recorded by ${by}, no note)`;
  return <>agreed{how}, recorded by {by}: <span className="quote">“{quote}”</span></>;
}
// The card's title: an ask reads as what was done once it is sent ("Asked Birch Hollow Gardens for more"); a draft has asked no one yet.
const cardTitle = (r: Resolution): string => r.kind === "ask-grower" ? `${r.status === "drafted" ? "Ask" : "Asked"} ${r.facts.to.name} for more` : `${KIND[r.kind]} to ${r.facts.to.name}`;
// What a recorded reply is called: an answer recorded with no channel claims no call or text.
const replyLabel = (channel: string) => channel === "call" ? "Call note" : channel === "recorded" ? "Answer recorded" : "Reply";

export default async function Orders({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, wanted = typeof params.order === "string" ? params.order : undefined, raw = readNotice(params, { page: "/orders", id: wanted }), notice = raw?.on === "cut" ? undefined : raw;
  const { state: w, version } = await current(), me = await rememberedName();
  const typed = (form: "send" | "buyer" | "supply" | "call", name: string) => readKept(params, form, name);
  const orders = w.ledger.snapshot.orders, statuses = new Map(orders.map(o => [o.id, orderStatus(w, o.id)]));
  const o = orders.find(x => x.id === wanted) ?? orders.find(x => statuses.get(x.id) === "short" || statuses.get(x.id) === "resolving") ?? orders[0];
  return (
    <div className="workspace item-first">
      {o ? <Order w={w} orderId={o.id} version={version} notice={notice} sig={String(params.sig)} cuts={<><Conflicts w={w} version={version} known={!!me} page="/orders" id={wanted} params={params} level={2} /><ChangeCuts w={w} version={version} known={!!me} page="/orders" id={wanted} only={{ orderId: o.id }} /></>} live={await liveAllowance()} me={me} typed={typed} /> : <p className="muted">No orders yet.</p>}
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
    </div>
  );
}

async function Order({ w, orderId, version, notice, sig, cuts, live, me, typed }: { w: Workbench; cuts: ReactNode; orderId: string; version: number; notice?: Notice; sig: string; live: number; me?: string; typed: (form: "send" | "buyer" | "supply" | "call", name: string) => string | undefined }) {
  const o = w.ledger.snapshot.orders.find(x => x.id === orderId)!;
  const plan = planOf(w.ledger), lots = new Map(w.ledger.snapshot.lots.map(l => [l.id, l]));
  const mine = plan.allocations.filter(a => a.orderId === orderId), unit = normalize(o.quantity).unit;
  const direct = mine.filter(a => a.kind === "requested").reduce((n, a) => n + a.amount, 0);
  const subs = mine.filter(a => a.kind === "approved-substitution"), gap = plan.unfilled.find(u => u.orderId === orderId)?.amount ?? 0;
  const stage = stageOf(w.ledger, orderId), st = orderChip(orderStatus(w, orderId), stage.stage, gap, unit), promised = promiseText(stage, mine.reduce((n, a) => n + a.amount, 0), w.resolutions.some(r => r.orderId === orderId && r.status === "accepted" && r.option.kind === "offer-substitute") || !!toldBuyer(w, orderId));
  // "Not promised to the buyer yet" is said once, beside the planned amount, not at the head of the card.
  const notPromised = promised.includes(NOT_PROMISED), promisedNow = promised.filter(x => x !== NOT_PROMISED);
  const offered = options(w.ledger, orderId, CONTACTS).map((opt, index) => ({ opt, index }));
  const resolutions = w.resolutions.filter(r => r.orderId === orderId);
  // A problem from a card's form is shown on that card while the card still shows the form;
  // otherwise at the top. A result moves focus to the card it is about, or to the order.
  const onCard = !!notice && !notice.ok && !!notice.res && resolutions.some(r => r.id === notice.res && cardForms(w, r).includes(notice.on ?? ""));
  // A missing name on "Send" / "Draft message", or an empty message on "Send", is shown on that option's own card.
  const optBad: Bad = notice && !notice.ok && notice.on === "draft" && (notice.field === "who" || notice.field === "body") && notice.res?.startsWith("opt-") && offered.some(x => `opt-${x.index}` === notice.res)
    ? { on: `${notice.res}-draft`, field: notice.field, text: notice.text } : undefined;
  const focus = !notice ? undefined
    : optBad ? fieldId(optBad.on, optBad.field)
    : onCard && notice.field ? `${notice.res}-${notice.on}-${notice.field}`
    : (notice.ok || onCard) && notice.res && resolutions.some(r => r.id === notice.res) ? `${notice.res}-title` : "order";
  const today = hubDay(new Date().toISOString());
  const onFile = o.approvedSubstitutions.map(x => x.product).filter(p => permissionSource(w.ledger, orderId, p).kind === "on-file");
  // The next suggestion appears only when there is nothing to wait for.
  const waiting = resolutions.filter(isWaiting);
  // Once the buyer has been told about the whole shortfall there is no second notice to offer, and while a message waits
  // to be sent its Send (in Messages) is the only one: the Next step points at it instead of offering another.
  const told = toldBuyer(w, orderId), draft = draftWaiting(w, orderId), visible = offered.filter(x => !(told && x.opt.kind === "notify-short"));
  const pick = recommend(w, orderId, CONTACTS), picked = !waiting.length && !draft && pick && pick.kind !== "review-reply" ? visible.find(x => sameOption(x.opt, pick)) : undefined;
  const names: Record<string, string> = { ...Object.fromEntries(CONTACTS.map(c => [c.id, c.name])), [o.buyerId]: buyer(o.buyerId) };
  const known = !!me, optBadOf = (index: number) => optBad?.on === `opt-${index}-draft` ? optBad : undefined;
  const card = (x: { opt: Option; index: number }) => <OptionCard key={x.index} {...x} order={orderId} buyerName={buyer(o.buyerId)} version={version} open={openFor(w, orderId, x.opt)} known={known} bad={optBadOf(x.index)} />;
  // Up to two other ways to cover the short, one tap each: offer a substitute, tell the buyer. The rest stay under Other options.
  const others = visible.filter(x => x !== picked);
  const alts = picked ? [others.filter(x => x.opt.kind === "offer-substitute").sort((a, b) => amountOf(b.opt) - amountOf(a.opt) || a.index - b.index)[0], others.find(x => x.opt.kind === "notify-short")].filter((x): x is { opt: Option; index: number } => !!x) : [];
  const rest = others.filter(x => !alts.includes(x));
  const errorOf = (r: Resolution): CardError | undefined => onCard && notice!.res === r.id ? { on: notice!.on!, text: notice!.text, field: notice!.field } : undefined;
  const reading = pick?.kind === "review-reply" ? pick : undefined;
  // Demo: a sent ask to a grower who holds the product, with no reply yet, can have the scripted reply delivered.
  const demo = resolutions.filter(r => r.status === "sent" && r.option.kind === "ask-grower" && r.option.hasLot && !r.linkedItemId && !!REQUEST_REPLIES[r.option.contactId]);
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
      {notice && !notice.ok && !onCard && !optBad && <p className="error" role="alert">{notice.text}</p>}
      <div className="section-head row">
        <h1 id="order" tabIndex={-1}>{buyer(o.buyerId)}</h1>
        <span className={`chip ${st.tone}`}>{st.label}</span>
        {unsent(w, orderId) && <span className="chip quiet">Draft not sent</span>}
      </div>
      {cuts}
      {promisedNow.length > 0 && <p className="muted small">{promisedNow.join(". ")}.</p>}
      <p className="lot">
        <b>Wants</b><span>{quantity(o.quantity)} {o.product}</span><span>{o.acceptedGrades.join(" or ")}</span><span>{day(o.deliveryOn)}</span>
      </p>
      <table className="reading"><tbody>
        <tr><td>Gets {o.product}</td><td><b>{weight(direct, unit)}</b>{notPromised && <span className="muted small"><br />{NOT_PROMISED}</span>}{mine.filter(a => a.kind === "requested").map(a => <span key={a.lotId} className="muted small"><br />{weight(a.amount, unit)} from {grower(lots.get(a.lotId)!.growerId)}</span>)}</td></tr>
        {subs.length > 0 && <tr><td>Gets by substitute</td><td>{subs.map(a => <span key={a.lotId}>{weight(a.amount, unit)} {lots.get(a.lotId)!.product} from {grower(lots.get(a.lotId)!.growerId)}<br /></span>)}</td></tr>}
        <tr><td>Short</td><td className={gap ? "worse" : ""}>{weight(gap, unit)}</td></tr>
        <tr><td>Substitutes this buyer accepts</td><td>{o.approvedSubstitutions.length ? o.approvedSubstitutions.map(s => { const src = permissionSource(w.ledger, orderId, s.product); return (
          <span key={s.product}>{s.product} ({s.acceptedGrades.join(", ")}){s.maxAmount !== undefined ? `, up to ${weight(s.maxAmount, unit)}` : ""}{src.kind === "on-file" ? ", on file" : <>: {src.record.kind === "substitute-accepted" ? <>{agreedLine(src.record.evidence.channel, src.record.recordedBy, src.record.evidence.quote)}</> : "agreed"}</>}<br /></span>
        ); }) : <span className="muted">None yet</span>}</td></tr>
      </tbody></table>

      {gap > 0 && <PendingCover w={w} orderId={orderId} />}

      {(reading || waiting.length > 0 || picked || told || draft) && <div className="option-group" aria-labelledby="next-step">
        <h2 id="next-step">Next step</h2>
        {told && <div className="option-card primary-card"><b>Told {buyer(o.buyerId)} they'll be short {weight(told.facts.amount, told.option.unit)}</b>
          <p className="draft">Nothing more to send. Cover the shortfall to change this.</p></div>}
        {draft && <div className="option-card primary-card"><b>Draft ready below</b>
          <p className="draft">{KIND[draft.kind]} to {draft.facts.to.name} is waiting to be checked and sent.</p>
          <div><a className="button primary" href={`#${draft.id}`}>Go to the draft<span className="sr-only"> to {draft.facts.to.name}</span></a></div></div>}
        {reading && <div className="option-card primary-card">
          <b>Review {grower(reading.contactId)}'s reply: it is waiting in Review updates</b>
          <p className="draft">Read what they said before asking anyone else.</p>
          <div><a className="button primary" href={`/review?item=${encodeURIComponent(reading.itemId)}`}>Review the reply<span className="sr-only"> from {grower(reading.contactId)}</span></a></div>
        </div>}
        {waiting.map(r => <WaitingCard key={r.id} r={r} w={w} version={version} me={me} typed={typed} error={errorOf(r)} buyerName={buyer(o.buyerId)} />)}
        {picked && <PrimaryCard x={picked} order={orderId} buyerName={buyer(o.buyerId)} version={version} open={openFor(w, orderId, picked.opt)} known={known} bad={optBadOf(picked.index)} why={why(picked.opt, o)}
          // The kept Send text is read only for the picked option: the other options use "Draft message", which has no text to keep.
          draft={(notice && !notice.ok && notice.res === `opt-${picked.index}` ? typed("send", "body") : undefined) ?? template(factsFor(w, orderId, picked.opt, names))} />}
        {alts.length > 0 && <div className="alternatives">
          <h3>Or</h3>
          <div className="option-cards">{alts.map(x => <AltButton key={x.index} x={x} order={orderId} buyerName={buyer(o.buyerId)} version={version} open={openFor(w, orderId, x.opt)} known={known} bad={optBadOf(x.index)} draft={template(factsFor(w, orderId, x.opt, names))} />)}</div>
        </div>}
      </div>}
      {offered.length > 0 ? (rest.length > 0 && <details className="option-group" open={rest.some(x => optBadOf(x.index)) || undefined}>
        <summary>Other options ({rest.length})</summary>
        {groups.map(([title, xs, note]) => (xs.length > 0 || note) && (
          <div key={title}>
            <h2>{title}</h2>
            {note && <p className="muted small">{note}</p>}
            {xs.length ? <div className="option-cards">{xs.map(card)}</div> : <p className="muted small">No {title.toLowerCase()} for this shortfall.</p>}
          </div>
        ))}
      </details>) : <p className="muted">This order is not short. Nothing to resolve.</p>}

      {demo.length > 0 && <details className="demo-tools" open={demo.some(r => errorOf(r)?.on === "script")}>
        <summary>Demo tools</summary>
        {demo.map(r => <div key={r.id} className="demo" role="group" aria-label="Demo"><span className="demo-tag">Demo</span>
          <form action={scriptedRequestReplyAction}><Hidden order={orderId} version={version} res={r.id} /><button type="submit" aria-describedby={errorOf(r)?.on === "script" ? `${r.id}-script-error` : undefined}>Receive the grower's reply (demo)<span className="sr-only"> from {r.facts.to.name}</span></button></form>
          {errorOf(r)?.on === "script" && !errorOf(r)?.field && <p id={`${r.id}-script-error`} className="field-error" role="alert">{errorOf(r)!.text}</p>}</div>)}
      </details>}

      {resolutions.length > 0 && <div className="history">
        <h2>Thread and history</h2>
        <ol>{resolutions.flatMap(r => r.decisions.map((d, n) => (
          <li key={`${r.id}-${n}`}><span className="muted">{time(d.at)}</span> <ThreadLine r={r} d={d} reviewed={["approved", "dismissed"].includes(w.items.find(i => i.id === r.linkedItemId)?.state ?? "")} /></li>
        ))).concat(resolutions.filter(r => r.reply).map(r => (
          <li key={`${r.id}-reply`}>{r.reply!.channel === "recorded" ? <span className="muted">{r.reply!.text}</span> : <><span className="muted">{replyLabel(r.reply!.channel)}</span> “{r.reply!.text}”</>}</li>
        )))}</ol>
      </div>}
      <p className="fine-print">Who gets what: direct orders first, by priority, then substitutes the buyer has agreed to.</p>
    </section>

    <aside className="preview" aria-labelledby="drafts">
      <h2 id="drafts">Messages</h2>
      <p className="muted small">Recorded only; nothing is delivered.</p>
      {resolutions.length ? [...resolutions].reverse().map(r => (
        <ResolutionCard key={r.id} r={r} w={w} version={version} me={me} typed={typed} canSuggest={recordedDraft(ex, r.facts) !== undefined || live > 0} today={today} error={errorOf(r)} />
      )) : <p className="muted small panel">Choose an option to draft a message. Drafts start from a template that uses only the order's facts.</p>}
    </aside>
  </>;
}

const sameOption = (a: Option, b: Option) => a.kind === b.kind && target(a) === target(b) && amountOf(a) === amountOf(b);
// Why this is the pick, in a coordinator's words. A substitute is "already allowed" only when the order holds that
// permission (the same list the table above reads), otherwise it still needs the buyer's yes.
function why(o: Option, order: Order): string {
  if (o.kind === "offer-substitute") {
    const held = order.approvedSubstitutions.find(s => s.product === o.product);
    return held ? `the buyer already allows ${o.product}${held.maxAmount !== undefined ? ` up to ${weight(held.maxAmount, o.unit)}` : ""}, and it covers ${weight(o.covers, o.unit)}` : `${o.product} is spare and covers ${weight(o.covers, o.unit)}, but the buyer has not agreed to it yet`;
  }
  if (o.kind === "notify-short") return "nobody else is left to ask";
  return o.hasLot ? `they hold ${order.product} for this day` : `${o.contactKind === "member" ? "a member grower" : "an outside source"} to try next`;
}
function PrimaryCard({ x, order, buyerName, version, open, known, bad, why, draft }: { x: { opt: Option; index: number }; order: string; buyerName: string; version: number; open?: Resolution; known: boolean; bad?: Bad; why: string; draft: string }) {
  const { opt } = x, amt = weight(amountOf(opt), opt.unit), on = `opt-${x.index}-draft`;
  const line = opt.kind === "ask-grower" ? `Ask ${grower(opt.contactId)} for ${amt}` : opt.kind === "offer-substitute" ? `Offer ${buyerName} ${opt.product} (${opt.grade}) for ${amt}` : `Tell ${buyerName} the order is ${amt} short`;
  return (
    <form action={sendNowAction} className="option-card primary-card" noValidate>
      <Hidden order={order} version={version} res={`opt-${x.index}`} />
      <input type="hidden" name="index" value={x.index} /><input type="hidden" name="kind" value={opt.kind} />
      <input type="hidden" name="amount" value={amountOf(opt)} /><input type="hidden" name="target" value={target(opt)} />
      <b>{line}: {why}</b>
      {open ? <><p className="draft">{draft}</p><OpenNote open={open} sr=" This is the message for this step." /></>
        : <>
          <label>Message<span className="sr-only"> ({line})</span><textarea name="body" required maxLength={480} rows={4} defaultValue={draft} {...invalid(bad, on, "body")} /></label>
          <Problem bad={bad} on={on} name="body" />
          <div className="row"><NamedSubmit label={<>Send<span className="sr-only"> to {opt.kind === "ask-grower" ? grower(opt.contactId) : buyerName}</span></>} className="primary" known={known} on={on} bad={bad} />
            <span className="fine-print">You can edit the words first.</span></div>
        </>}
    </form>
  );
}

// An option that already has a message: a draft is linked to; a sent one says it is sent, never "already open".
function OpenNote({ open, sr }: { open: Resolution; sr: string }) {
  return open.status === "sent" ? <a className="small" href={`#${open.id}`}>Message to {open.facts.to.name}, sent, waiting on the answer</a>
    : <a className="small" href={`#${open.id}`}>Message already open.<span className="sr-only">{sr}</span></a>;
}

// One tap for another way to cover the short: the same draft, check and send as the Next step (sendNowAction),
// with the template wording. It stops at the draft when words need confirming or the check finds something.
function AltButton({ x, order, buyerName, version, open, known, bad, draft }: { x: { opt: Option; index: number }; order: string; buyerName: string; version: number; open?: Resolution; known: boolean; bad?: Bad; draft: string }) {
  const { opt } = x, amt = weight(amountOf(opt), opt.unit), on = `opt-${x.index}-draft`;
  const label = opt.kind === "offer-substitute" ? `Offer ${opt.product}` : `Tell ${buyerName}`;
  const more = opt.kind === "offer-substitute" ? ` (${opt.grade}, covers ${amt}, needs ${buyerName}'s yes)` : ` (the order is ${amt} short)`;
  return (
    <form action={sendNowAction} className="option-card">
      <Hidden order={order} version={version} res={`opt-${x.index}`} />
      <input type="hidden" name="index" value={x.index} /><input type="hidden" name="kind" value={opt.kind} />
      <input type="hidden" name="amount" value={amountOf(opt)} /><input type="hidden" name="target" value={target(opt)} />
      <input type="hidden" name="body" value={draft} />
      {open ? <OpenNote open={open} sr={` This is the message for ${label}.`} />
        : <div><NamedSubmit label={<>{label}<span className="sr-only">{more}</span></>} known={known} on={on} bad={bad} quiet /></div>}
      {opt.kind === "offer-substitute" && <span className="fine-print">{amt} of {opt.product} ({opt.grade}).</span>}
    </form>
  );
}

// A message sent and waiting: what was asked and of whom, with the controls to record the answer. The next suggestion is not shown until it comes.
function WaitingCard({ r, w, version, me, typed, error, buyerName }: { r: Resolution; w: Workbench; version: number; me?: string; typed: (form: "send" | "buyer" | "supply" | "call", name: string) => string | undefined; error?: CardError; buyerName: string }) {
  const amt = weight(amountOf(r.option), r.option.unit);
  const line = r.option.kind === "ask-grower" ? `Asked ${r.facts.to.name} for ${amt}. Waiting on their reply.` : r.option.kind === "offer-substitute" ? `Offered ${buyerName} ${r.option.product} (${r.option.grade}) for ${amt}. Waiting on their answer.` : "";
  return (
    <div className="option-card primary-card">
      <b>{line}</b>
      <ReplyControls r={r} w={w} version={version} me={me} typed={typed} error={error} />
    </div>
  );
}

function OptionCard({ opt, index, order, buyerName, version, open, known, bad }: { opt: Option; index: number; order: string; buyerName: string; version: number; open?: Resolution; known: boolean; bad?: Bad }) {
  const amt = weight(amountOf(opt), opt.unit);
  return (
    <form action={startResolutionAction} className="option-card">
      <Hidden order={order} version={version} res={`opt-${index}`} />
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
      {open ? <OpenNote open={open} sr={` This is the message to ${opt.kind === "ask-grower" ? grower(opt.contactId) : buyerName}.`} />
        : <div><NamedSubmit label={<>Draft message<span className="sr-only"> {opt.kind === "ask-grower" ? `to ${grower(opt.contactId)}` : opt.kind === "offer-substitute" ? `to ${buyerName} offering ${opt.product} (${opt.grade})` : `to ${buyerName} about the shortfall`}</span></>} known={known} on={`opt-${index}-draft`} bad={bad} quiet /></div>}
    </form>
  );
}

function ResolutionCard({ r, w, version, me, typed, canSuggest, today, error }: { r: Resolution; w: Workbench; version: number; me?: string; typed: (form: "send" | "buyer" | "supply" | "call", name: string) => string | undefined; canSuggest: boolean; today: string; error?: CardError }) {
  const h = { order: r.orderId, version, res: r.id }, st = r.status === "sent" ? sentLabel(w, r) : STATE[r.status];
  // The words shown here are posted with Confirm, so only these are confirmed.
  const asks = r.status === "drafted" ? toConfirm(w, r, today) : [], confirmed = (c: Confirm) => !!r.confirmation?.items.includes(c.token);
  const open = asks.filter(c => !confirmed(c)), sendable = canSend(w, r, today);
  // A problem with a field is shown beside the field; one with a control, beside the control.
  const at = (on: string) => error?.on === on && !error.field, errId = (on: string) => at(on) ? `${r.id}-${on}-error` : undefined;
  const fieldError = (on: string) => at(on) && <p id={errId(on)} className="field-error" role="alert">{error!.text}</p>;
  const { inv, problem, named } = fields(r.id, error), known = !!me;
  const out = w.outbox.find(m => m.id === r.messageId);
  const to = r.facts.to.name, ctx = <span className="sr-only"> to {to}</span>;
  return (
    <div className="panel resolution" id={r.id}>
      <div className="card-head"><h3 id={`${r.id}-title`} tabIndex={-1}>{cardTitle(r)}</h3><span className={`chip ${st.tone}`}>{st.label}</span></div>
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
            <div><NamedSubmit label={<>Confirm these words<span className="sr-only"> in the message to {to}</span></>} aria-describedby={errId("confirm")} {...named(known, "confirm")} /></div>
          </form>}
          {fieldError("confirm")}
        </div>
      )}
      {r.status === "discarded" && <p className="small muted">Discarded: {r.decisions.findLast(d => d.kind === "discarded")?.note}</p>}
      {r.status === "drafted" && <>
        <details open={error?.on === "edit"}>
          <summary>Edit<span className="sr-only"> the message{ctx}</span></summary>
          <form action={editDraftAction} className="form" noValidate><Hidden {...h} />
            <label>Message<textarea name="body" required maxLength={480} rows={4} defaultValue={r.text} {...inv("edit", "body")} /></label>
            {problem("edit", "body")}
            <div><NamedSubmit label={<>Save edit and check<span className="sr-only"> the message{ctx}</span></>} {...named(known, "edit")} /></div>
          </form>
          {fieldError("edit")}
        </details>
        {canSuggest && <form action={museDraftAction} className="row"><Hidden {...h} />
          <NamedSubmit label={<>Suggest other wording<span className="sr-only"> for the message{ctx}</span></>} aria-describedby={errId("redraft")} {...named(known, "redraft")} />
        </form>}
        {fieldError("redraft")}
        <form action={sendAction} className="form"><Hidden {...h} />
          <div className="row">
            <NamedSubmit label={<>Send<span className="sr-only"> the message{ctx}</span></>} className="primary" disabled={!sendable} aria-describedby={errId("send")} {...named(known, "send")} />
            <span className="fine-print">{sendable ? "" : "Confirm the words above first."}</span>
          </div>
        </form>
        {fieldError("send")}
        <details open={error?.on === "discard"}>
          <summary>Discard draft<span className="sr-only">{ctx}</span></summary>
          <form action={discardDraftAction} className="form" noValidate><Hidden {...h} />
            <label>Why it won't be sent<input name="reason" aria-required="true" maxLength={480} {...inv("discard", "reason")} /></label>
            {problem("discard", "reason")}
            {fieldError("discard")}
            <div><NamedSubmit label={<>Discard draft<span className="sr-only">{ctx}</span></>} {...named(known, "discard")} /></div>
            <p className="fine-print">The text stays in the history, and this option can be drafted again.</p>
          </form>
        </details>
      </>}
      {out && <p className="fine-print">Sent by {out.sentBy}, {time(out.sentAt)}. (This demo records messages; it doesn't deliver them.)</p>}
      {isWaiting(r) && <p className="small">Waiting on the answer. Record it under <a href="#next-step">Next step</a>.</p>}
      {r.status === "sent" && r.option.kind === "ask-grower" && r.option.hasLot && r.linkedItemId && <ReplyControls r={r} w={w} version={version} me={me} typed={typed} error={error} />}
      {r.reply && (r.reply.channel === "recorded" ? <p className="small">{r.reply.text}</p> : <p className="small">{replyLabel(r.reply.channel)}: <span className="quote">“{r.reply.quote}”</span></p>)}
    </div>
  );
}

// The controls to record what came back for a sent message, on the card that shows them.
function ReplyControls({ r, w, version, me, typed, error }: { r: Resolution; w: Workbench; version: number; me?: string; typed: (form: "send" | "buyer" | "supply" | "call", name: string) => string | undefined; error?: CardError }) {
  const h = { order: r.orderId, version, res: r.id }, to = r.facts.to.name, known = !!me, o = w.ledger.snapshot.orders.find(x => x.id === r.orderId)!;
  const at = (on: string) => error?.on === on && !error.field, errId = (on: string) => at(on) ? `${r.id}-${on}-error` : undefined;
  const fieldError = (on: string) => at(on) && <p id={errId(on)} className="field-error" role="alert">{error!.text}</p>;
  const { problem, inv, named } = fields(r.id, error);
  const reviewed = ["approved", "dismissed"].includes(w.items.find(i => i.id === r.linkedItemId)?.state ?? "");
  return <>
      {r.option.kind === "offer-substitute" && <BuyerReply h={h} to={to} error={error} known={known} kept={error?.on === "reply" ? { channel: typed("buyer", "channel"), text: typed("buyer", "text"), quote: typed("buyer", "quote") } : {}} />}
      {r.option.kind === "ask-grower" && !r.option.hasLot && <ReplyForm h={h} to={to} error={error} known={known} grades={o.acceptedGrades} unit={r.option.unit} kept={name => typed("supply", name)} />}
      {r.option.kind === "ask-grower" && r.option.hasLot && (r.linkedItemId
        ? <p className="small">{reviewed ? "Their reply was reviewed." : "Their reply is in review."}</p>
        : <>
            <details open>
              <summary>Log their call<span className="sr-only"> ({to})</span></summary>
              <form action={requestedCallAction} className="form" noValidate><Hidden {...h} />
                <label>What {to} said<textarea name="note" required maxLength={480} rows={3} defaultValue={error?.on === "call" ? typed("call", "note") : undefined} {...inv("call", "note")} /></label>
                {problem("call", "note")}
                {fieldError("call")}
                <div><NamedSubmit label="Log call as their reply" {...named(known, "call")} /></div>
                <p className="fine-print">The note goes to Review updates as their reply to this ask.</p>
              </form>
            </details>
          </>)}
  </>;
}

// Two taps: They said yes, They said no. A phone answer needs no words; a pasted text is recorded in
// full, and a text holding the word supplies its own quote, otherwise the words that answer it are typed.
// Nothing is prefilled. A refused answer comes back with what was typed.
function BuyerReply({ h, to, error, known, kept }: { h: { order: string; version: number; res: string }; to: string; error?: CardError; known: boolean; kept: { channel?: string; text?: string; quote?: string } }) {
  const { inv, problem, named } = fields(h.res, error), mine = error?.on === "reply";
  return (
    <details open>
      <summary>Record the buyer's answer<span className="sr-only"> ({to})</span></summary>
      <form action={buyerReplyAction} className="form"><Hidden {...h} />
        <label>How it came<select name="channel" defaultValue={kept.channel === "text" || kept.channel === "call" ? kept.channel : ""} {...inv("reply", "channel")}><option value="">Not stated</option><option value="call">Phone call</option><option value="text">Text message</option></select></label>
        {problem("reply", "channel")}
        <label>What they said (optional unless it was a text)<textarea name="text" maxLength={480} rows={2} defaultValue={kept.text} {...inv("reply", "text")} /></label>
        <span className="fine-print">For a text, paste it in full. Otherwise a note is optional; with no note, only that you recorded the answer is kept.</span>
        {problem("reply", "text")}
        <label>Only if their text doesn't say plainly yes or no: the words that answer it<input name="quote" maxLength={480} defaultValue={kept.quote} {...inv("reply", "quote")} /></label>
        {problem("reply", "quote")}
        {problem("reply", "accept")}
        {mine && !error!.field && <p className="field-error" role="alert">{error!.text}</p>}
        <NameField {...named(known, "reply")} />
        <div className="row">
          <button type="submit" name="accept" value="yes">They said yes<span className="sr-only"> ({to})</span></button>
          <button type="submit" name="accept" value="no">They said no<span className="sr-only"> ({to})</span></button>
        </div>
      </form>
    </details>
  );
}

// noValidate: the browser's own bubble would hide the app's message; the server checks every field and names the one at fault.
function ReplyForm({ h, to, error, known, grades, unit, kept }: { h: { order: string; version: number; res: string }; to: string; error?: CardError; known: boolean; grades: string[]; unit: string; kept: (name: string) => string | undefined }) {
  const { inv, problem, named } = fields(h.res, error), mine = error?.on === "reply", k = (name: string) => mine ? kept(name) : undefined;
  return (
    <details open>
      <summary>Record their reply<span className="sr-only"> ({to})</span></summary>
      <form action={supplyReplyAction} className="form" noValidate><Hidden {...h} />
        <label>How it came<select name="channel" defaultValue={k("channel") === "call" ? "call" : "text"} {...inv("reply", "channel")}><option value="text">Text message</option><option value="call">Phone call</option></select></label>
        {problem("reply", "channel")}
        <label>Reply text, or your call note<textarea name="text" required maxLength={480} rows={2} defaultValue={k("text")} {...inv("reply", "text")} /></label>
        {problem("reply", "text")}
        <label>For a text: the words that answer it, copied exactly<input name="quote" maxLength={480} defaultValue={k("quote")} {...inv("reply", "quote")} /></label>
        {problem("reply", "quote")}
        <label>Can they supply?<select name="yes" required defaultValue={k("yes") === "yes" || k("yes") === "no" ? k("yes") : ""} {...inv("reply", "yes")}><option value="" disabled>Choose</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        {problem("reply", "yes")}
        <div className="row">
          <label>Amount ({unit})<input name="amount" type="number" min="1" step="1" inputMode="numeric" defaultValue={k("amount")} {...inv("reply", "amount")} /></label>
          <label>Grade<select name="grade" defaultValue={grades.includes(k("grade") ?? "") ? k("grade") : undefined} {...inv("reply", "grade")}>{grades.map(g => <option key={g}>{g}</option>)}</select></label>
        </div>
        {problem("reply", "amount")}{problem("reply", "grade")}
        {mine && !error!.field && <p className="field-error" role="alert">{error!.text}</p>}
        <div><NamedSubmit label={<>Record reply<span className="sr-only"> from {to}</span></>} {...named(known, "reply")} /></div>
        <p className="fine-print">A call note is its own evidence; a text needs the quoted words.</p>
      </form>
    </details>
  );
}
