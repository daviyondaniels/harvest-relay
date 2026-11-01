import type { Metadata } from "next";
import type { ReactNode } from "react";
import { conflicts, planOf } from "../../src/commitments.ts";
import type { Quantity } from "../../src/quantity.ts";
import { FIELDS, type Field, type Span } from "../../src/updates.ts";
import { BY_HAND, madeShort, needingRefresh, suggestReading, type Decision, type InboxItem, type Preview } from "../../src/workbench.ts";
import { SEED } from "../../src/seed.ts";
import { approveAction, askAction, correctAction, dismissAction, dismissNoChangeAction, liveAllowance, liveReadAction, liveReplyAction, pendingAction, readByHandAction, refreshAction, refreshAllAction, replyAction, returnAction, scriptedReplyAction } from "../actions.ts";
import { FIELD, OPERATION, OPERATION_CHOICE, buyer, changeLine, forecastTag, day, evidence, grower, quantity, status, time, weight } from "../lib/format.ts";
import { Result } from "../result.tsx";
import { Conflicts } from "../conflict.tsx";
import { Problem, fieldId, invalid, type Bad } from "../lib/field-error.tsx";
import { current, recording } from "../lib/hub.ts";
import { readNotice, type Notice } from "../lib/notice.ts";
import { QueueFold } from "../queue-fold.tsx";
import { AnswerFields, ValueFields } from "../value-fields.tsx";
import { readKept, type KeptForm } from "../lib/kept.ts";
import { numberSpan } from "../lib/quote.ts";
import { NameField, NamedSubmit } from "../named-submit.tsx";
import { rememberedName } from "../lib/name.ts";
import { queueOrder } from "../lib/queue.ts";
import { overview, questionCounts } from "../lib/view.ts";

export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
// The message the page opens: the one asked for, else the first still open, else the first.
function selected(w: Awaited<ReturnType<typeof current>>["state"], wanted?: string): InboxItem | undefined {
  const items = queueOrder(w.items, questionCounts(overview(w).previews));
  return items.find(i => i.id === wanted) ?? items.find(i => i.state !== "approved" && i.state !== "dismissed") ?? items[0];
}
// The tab names the grower whose message is open: "Review: Alder Creek Farm · Harvest Relay".
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const params = await searchParams, it = selected((await current()).state, typeof params.item === "string" ? params.item : undefined);
  return { title: it ? `Review: ${grower(it.source.growerId)}` : "Review updates" };
}

function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  const out: ReactNode[] = [];
  let at = 0;
  spans.forEach((s, n) => { out.push(text.slice(at, s.start), <mark key={n}>{text.slice(s.start, s.end)}</mark>); at = s.end; });
  out.push(text.slice(at));
  return <>{out}</>;
}
function Hidden({ item, version }: { item: string; version: number }) {
  return <><input type="hidden" name="item" value={item} /><input type="hidden" name="version" value={version} /></>;
}
function QueueLink({ i, p, current }: { i: InboxItem; p: Preview | undefined; current: boolean }) {
  const st = status(i, p);
  return (
    <a href={`/review?item=${i.id}`} aria-current={current ? "true" : undefined}>
      <span className="row"><b>{grower(i.source.growerId)}</b></span>
      <span className="muted small">{i.requestId ? "Reply to your ask, " : i.source.id.startsWith("call-") ? "Call note, " : ""}{time(i.receivedAt)}</span>
      <span className="snippet">{i.source.text}</span>
      <span><span className={`chip ${st.tone}`}>{st.label}</span></span>
    </a>
  );
}
function FieldSelect({ only, bad, on, kept }: { only?: Field[]; bad: Bad; on: string; kept?: string }) {
  return <>
    <label>Detail
      <select name="field" defaultValue={kept ?? only?.[0]} {...invalid(bad, on, "field")}>{(only ?? FIELDS.filter(f => f !== "unit")).map(f => <option key={f} value={f}>{FIELD[f]}</option>)}</select>
    </label>
    <Problem bad={bad} on={on} name="field" />
  </>;
}
// What a correction changed, said as a value rather than as data.
const shown = (v: unknown) => v && typeof v === "object" && "amount" in v ? quantity(v as Quantity) : typeof v === "string" ? (v in OPERATION ? OPERATION[v as keyof typeof OPERATION] : v) : "nothing";

export default async function Review({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams, wanted = typeof params.item === "string" ? params.item : undefined, raw = readNotice(params, { page: "/review", id: wanted }), notice = raw?.on === "cut" ? undefined : raw;
  const { state: w, version } = await current();
  const { previews } = overview(w), counts = questionCounts(previews);
  const items = queueOrder(w.items, counts), isDone = (i: InboxItem) => i.state === "approved" || i.state === "dismissed";
  const todo = items.filter(i => !isDone(i)), done = items.filter(isDone);
  const it = selected(w, wanted);
  const live = await liveAllowance(), rec = recording(), known = !!await rememberedName();
  // Refresh all does exactly the items counted here: those that need a refresh. Items only quietly
  // checked again against moved supply are neither counted nor refreshed by it.
  const stale = needingRefresh(w).length;
  // A missing name on "Refresh all stale items" is shown beside that form, and the folded queue opens to it.
  const allBad: Bad = notice && !notice.ok && notice.on === "refreshAll" && notice.field === "who" && stale > 0 ? { on: "refreshAll", field: "who", text: notice.text } : undefined;
  return (
    <div className="workspace item-first">
      {it ? <Item it={it} p={previews.get(it.id)!} version={version} notice={notice} cuts={<Conflicts w={w} version={version} known={known} page="/review" id={it.id} params={params} level={2} lotId={w.ledger.events.find(e => e.id === it.eventId)?.lotId} />} sig={String(params.sig)} params={params} known={known} queueFocus={allBad ? fieldId("refreshAll", "who") : undefined} live={live} hasScript={!!rec?.raw[SEED.find(s => s.source.id === it.source.id)?.reply?.id ?? ""] && it.replies.length === 0 && !!SEED.find(s => s.source.id === it.source.id)?.reply} w={w} />
        : <p className="muted">No messages yet.</p>}
      <nav className="queue" id="queue" aria-label="Incoming messages">
        <QueueFold count={todo.length} noun="messages" open={!!allBad}>
          <h2>Incoming</h2>
          {stale > 0 && it && <form action={refreshAllAction} className="form"><Hidden item={it.id} version={version} />
            <NamedSubmit label="Refresh all stale items" known={known} on="refreshAll" bad={allBad} quiet />
            <span className="fine-print"> Supply changed since {stale === 1 ? "one message was" : `${stale} messages were`} read.</span>
          </form>}
          {todo.map(i => <QueueLink key={i.id} i={i} p={previews.get(i.id)} current={i.id === it?.id} />)}
          {todo.length === 0 && <p className="muted small">Nothing left to review.</p>}
          {done.length > 0 && <details className="done-today" open={!!it && isDone(it)}>
            <summary>Done today ({done.length})</summary>
            <div className="queue-list">{done.map(i => <QueueLink key={i.id} i={i} p={previews.get(i.id)} current={i.id === it?.id} />)}</div>
          </details>}
        </QueueFold>
      </nav>
    </div>
  );
}

function Item({ it, p, version, notice, cuts, sig, params, known, queueFocus, live, hasScript, w }: { it: InboxItem; p: Preview; version: number; notice?: Notice; cuts: ReactNode; sig: string; params: Params; known: boolean; queueFocus?: string; live: number; hasScript: boolean; w: Awaited<ReturnType<typeof current>>["state"] }) {
  const closed = it.state === "approved" || it.state === "dismissed";
  const i = it.proposal?.interpretation, lot = w.ledger.snapshot.lots.find(l => l.id === i?.lotId);
  const quotes = (f: Field) => (it.proposal?.clarifications ?? []).filter(c => c.field === f && c.answer).map(c => c.answer!.source.text.slice(c.answer!.span.start, c.answer!.span.end));
  const byField = new Map<Field, string[]>();
  for (const q of p.questions) byField.set(q.field, [...(byField.get(q.field) ?? []), q.question.replace(/^Unanswered: /, "")]);
  // Only questions still waiting: an answered one, or one a reading settled, stays in History.
  const open = (it.proposal?.clarifications ?? []).filter(c => !c.answer && !c.question.startsWith("Coordinator reading") && !c.question.startsWith("Reply corrects"));
  const event = it.eventId ? w.ledger.events.find(e => e.id === it.eventId) : undefined;
  const v = { item: it.id, version };
  // What was typed into a form that was refused comes back as its starting text (lib/kept.ts); a form that failed stays open.
  const failedOn = (on: string) => !!notice && !notice.ok && notice.on === on;
  const kv = (on: KeptForm, name: string) => failedOn(on) ? readKept(params, on, name) : undefined;
  const mine = w.ledger.snapshot.lots.filter(l => l.growerId === it.source.growerId);
  const lotChoices = mine.map(l => ({ value: l.id, label: `${l.product}, ${l.grade}, ${day(l.deliveryOn)}` }));
  const kinds = Object.entries(OPERATION_CHOICE).map(([value, label]) => ({ value, label }));
  const detailChoices = (only?: Field[]) => (only ?? FIELDS.filter(f => f !== "unit")).map(f => ({ value: f, label: FIELD[f] }));
  const openDetails = byField.size ? [...byField.keys()] : undefined;
  // Just approved, or just dismissed (with "No change, dismiss" or Dismiss): the result panel says what comes next.
  const decided = !!notice?.ok && (notice.on === "approve" || ((notice.on === "hold" || notice.on === "dismiss") && it.state === "dismissed"));
  // The one form in view that asks for a name when none is saved: Save these details for a message
  // not read yet, Refresh review, Apply answer while a detail is open, else Approve. The other
  // forms use the remembered name, or are refused and then show their own field.
  const main = !it.proposal ? "hand" : p.needsRefresh ? "refresh" : byField.size > 0 ? "reply" : "approve";
  // Why Approve is off, said beside it.
  const off = p.questions.length > 0 || !p.change;
  const why = byField.size > 0 ? (byField.size === 1 ? "Answer the open detail above to approve." : `Answer the ${byField.size} open details above to approve.`) : "Approve is available once the change can be worked out.";
  // The ask this message answers, by the order's product and buyer.
  const ask = it.requestId ? w.resolutions.find(r => r.id === it.requestId) : undefined, askOrder = ask && w.ledger.snapshot.orders.find(o => o.id === ask.orderId);
  const names = new Map<string, string>([...w.ledger.snapshot.orders.map(o => [o.id, buyer(o.buyerId)] as const), ...w.ledger.snapshot.lots.map(l => [l.id, `${l.product}, ${grower(l.growerId)}`] as const)]);
  const from = grower(it.source.growerId);
  // A problem with a field of a form still on the page (a missing name included) is shown
  // beside that field; anything else at the top of the message.
  const forms = closed ? [] : ["hold", ...(!i || i.operation === "unresolved" ? ["dismiss"] : []), ...(hasScript ? ["script"] : []), ...(live > 0 ? ["read"] : []),
    ...(i ? ["ask", "reply", "correct"] : ["hand"]), ...(it.proposal ? [p.needsRefresh ? "refresh" : "approve"] : [])];
  const bad: Bad = notice && !notice.ok && notice.field && forms.includes(notice.on ?? "") ? { on: notice.on!, field: notice.field, text: notice.text } : undefined;
  const top = notice && !notice.ok && !bad && !queueFocus ? notice : undefined;
  // Where focus goes: the field with the problem, else the result's heading.
  const focus = bad ? fieldId(bad.on, bad.field) : notice?.ok && notice.on === "approve" ? (notice.res && conflicts(w.ledger).some(c => c.lotId === notice.res) ? `cut-${notice.res}-head` : "change") : queueFocus ?? (notice ? "msg" : undefined);
  return <>
    <section className="panel" id="item" tabIndex={-1} aria-labelledby="msg">
      {notice && <Result key={sig} text={notice.ok && notice.on !== "approve" ? notice.text : undefined} focus={focus} />}
      {top && <p className="error" role="alert">{top.text}</p>}
      <div className="section-head">
        <h1 id="msg" tabIndex={-1}>{from}</h1>
        <span className="muted small">{it.source.id.startsWith("call-") ? `${it.decisions[0]?.note ?? "Call note"}, ` : ""}Received {time(it.receivedAt)}</span>
      </div>
      {it.state === "approved" && event && event.effect !== "forecast" && cuts}
      {ask && askOrder && <p className="small">Reply to your ask about {askOrder.product} for {buyer(askOrder.buyerId)}. <a href={`/orders?order=${encodeURIComponent(askOrder.id)}#${ask.id}`}>Open the order</a></p>}
      <p className="message"><Highlighted text={it.source.text} spans={evidence(it.proposal, it.source.id)} /></p>
      {(open.length > 0 || it.replies.length > 0) && (
        <div className="thread" aria-label="Clarification conversation">
          {open.map((c, n) => (
            <div className="turn" key={`q${n}`}><span className="asked small">Question about {FIELD[c.field].toLowerCase()}</span><span>{c.question}</span></div>
          ))}
          {it.replies.map(r => (
            <div className="turn" key={r.id}><span className="asked small">{grower(r.growerId)} replied</span><span><Highlighted text={r.text} spans={evidence(it.proposal, r.id)} /></span></div>
          ))}
        </div>
      )}
      {lot && <p className="lot"><b>Current lot</b><span>{lot.product}</span><span>{lot.grade}</span><span>{day(lot.deliveryOn)}</span><span>{quantity(lot.quantity)} confirmed</span></p>}

      {i ? <>
        <div>
          <h2>What we understood</h2>
          <p className="muted small">{it.interpretedBy === BY_HAND ? "Entered by hand. Check the highlighted words." : "Read automatically. Check the highlighted words."}</p>
        </div>
        <table className="reading"><tbody>
          <tr><td>What changed</td><td><b>{OPERATION[i.operation]}</b></td></tr>
          <tr><td>Lot</td><td>{lot ? `${lot.product}, ${grower(lot.growerId)}` : "not identified"}</td></tr>
          <tr><td>Quantity</td><td>{quantity(i.quantity)}{quotes("pack").length ? <span className="quote"><br />contents from reply: “{quotes("pack").join("”, “")}”</span> : null}</td></tr>
          <tr><td>Grade</td><td>{i.grade ?? "not stated"}</td></tr>
          <tr><td>Delivery day</td><td>{i.deliveryOn ? day(i.deliveryOn) : "not stated"}</td></tr>
        </tbody></table>
      </> : <p className="blocker">This message has not been read yet. {closed ? "" : live > 0 ? "Use Read automatically below, or enter the details yourself." : "Enter the details below."}</p>}

      {byField.size > 0 && !closed && (
        <div className="blocker" role="status" id="open-questions" tabIndex={-1}>
          <b>{byField.size === 1 ? "One detail needs an answer before approval" : `${byField.size} details need answers before approval`}</b>
          <ul>{[...byField].map(([f, qs]) => <li key={f}><b>{FIELD[f]}:</b> {qs[0]}</li>)}</ul>
        </div>
      )}

      {!closed && <div className="form">
        <div className="row">
          {hasScript && <div className="demo" role="group" aria-label="Demo"><span className="demo-tag">Demo</span><form action={scriptedReplyAction} className="form"><Hidden {...v} /><NamedSubmit label="Receive the grower's reply (demo)" known={known} on="script" bad={bad} quiet /></form></div>}
          {(!i || i.operation === "unresolved") && <form action={dismissNoChangeAction} className="form"><Hidden {...v} /><NamedSubmit label="No change, dismiss" known={known} on="dismiss" bad={bad} quiet /></form>}
          {live > 0 && <form action={liveReadAction} className="form"><Hidden {...v} /><NamedSubmit label={i ? "Read again automatically" : "Read automatically"} known={known} on="read" bad={bad} quiet /></form>}
        </div>
        {!i && <HandForm it={it} w={w} v={v} bad={bad} known={known} kv={kv} />}
        {i && <details open={byField.size > 0 || failedOn("reply")}>
          <summary>Add the grower's reply</summary>
          <form action={replyAction} className="form"><Hidden {...v} />
            <label>Reply, exactly as received<textarea name="reply" required maxLength={2000} rows={3} defaultValue={kv("reply", "reply")} {...invalid(bad, "reply", "reply")} /></label>
            <Problem bad={bad} on="reply" name="reply" />
            {openDetails
              ? <AnswerFields on="reply" details={detailChoices(openDetails)} kinds={kinds} lots={lotChoices} bad={bad} known={known} quiet={main !== "reply"}
                  kept={Object.fromEntries(openDetails.map(f => [f, kv("reply", `value-${f}`)]))}
                  quote={<><label>Words in the reply that answer it (optional)<input name="quote" maxLength={500} defaultValue={kv("reply", "quote")} {...invalid(bad, "reply", "quote")} /></label><Problem bad={bad} on="reply" name="quote" /></>}
                  extra={live > 0 ? <button type="submit" formAction={liveReplyAction} formNoValidate>Read the reply automatically</button> : undefined} />
              : <>
                <ValueFields on="reply" details={detailChoices()} kinds={kinds} lots={lotChoices} bad={bad} field={kv("reply", "field")} value={kv("reply", "value")} />
                <label>Words in the reply that answer it (optional)<input name="quote" maxLength={500} defaultValue={kv("reply", "quote")} {...invalid(bad, "reply", "quote")} /></label>
                <Problem bad={bad} on="reply" name="quote" />
                <div className="row"><NamedSubmit label="Apply answer" known={known} on="reply" bad={bad} quiet={main !== "reply"} purpose="this answer" />{live > 0 && <button type="submit" formAction={liveReplyAction} formNoValidate>Read the reply automatically</button>}</div>
              </>}
          </form>
        </details>}
        {i && <details open={failedOn("ask")}>
          <summary>Ask the grower</summary>
          <form action={askAction} className="form"><Hidden {...v} />
            <FieldSelect only={openDetails} bad={bad} on="ask" kept={kv("ask", "field")} />
            <label>Question<input name="question" required maxLength={500} placeholder="How much is in each case?" defaultValue={kv("ask", "question")} {...invalid(bad, "ask", "question")} /></label>
            <Problem bad={bad} on="ask" name="question" />
            <div><NamedSubmit label=<>Record question <span className="sr-only">for {from}</span></> known={known} on="ask" bad={bad} quiet /></div>
          </form>
        </details>}
        {i && <details open={failedOn("correct")}>
          <summary>Correct what was read</summary>
          <form action={correctAction} className="form"><Hidden {...v} />
            <p className="muted small">Use the grower's own words from the message. The change and the quote are kept in the history.</p>
            <ValueFields on="correct" details={detailChoices()} kinds={kinds} lots={lotChoices} bad={bad} field={kv("correct", "field")} value={kv("correct", "value")} />
            <label>Words in the message<input name="quote" required maxLength={500} defaultValue={kv("correct", "quote")} {...invalid(bad, "correct", "quote")} /></label>
            <Problem bad={bad} on="correct" name="quote" />
            <div><NamedSubmit label="Apply correction" known={known} on="correct" bad={bad} quiet /></div>
          </form>
        </details>}
        <details open={failedOn("hold")}>
          <summary>Leave pending, return or dismiss</summary>
          <form className="form"><Hidden {...v} />
            <label>Note or reason<input name="note" required maxLength={500} defaultValue={kv("hold", "note")} {...invalid(bad, "hold", "note")} /></label>
            <Problem bad={bad} on="hold" name="note" />
            <NameField known={known} on="hold" bad={bad} quiet />
            <div className="row">
              <button type="submit" formAction={pendingAction}>Leave pending</button>
              <button type="submit" formAction={returnAction}>Return to grower</button>
              <button type="submit" formAction={dismissAction}>Dismiss</button>
            </div>
          </form>
        </details>
      </div>}

      <div className="history">
        <h2>History</h2>
        <ol>{it.decisions.map((d, n) => (
          // The correction that carries a hand entry is part of that one line, not a second step.
          d.kind === "corrected" && !d.corrections?.length && it.decisions[n - 1]?.kind === "interpreted" && it.decisions[n - 1].note === BY_HAND && it.decisions[n - 1].at === d.at ? null :
          <li key={n}><span className="muted">{time(d.at)}</span> <HistoryLine d={d} it={it} />
            {d.corrections?.map((c, k) => <span key={k} className="worse"><br />Correction: {FIELD[c.field]} from {shown(c.from)} to {shown(c.to)}, quoting “{c.quote}”</span>)}
            {d.eventId && <> <a href={`/events/${d.eventId}`}>View recorded change</a></>}
          </li>
        ))}</ol>
      </div>
    </section>

    <aside className="preview" aria-labelledby="change">
      <h2 id="change" tabIndex={-1}>What changes</h2>
      {notice?.ok && notice.on === "approve" && <Result key={sig} text={notice.text} />}
      <ChangeTag it={it} p={p} event={event} />
      {closed && (decided || (ask && askOrder)) && <NextSteps it={it} w={w} decided={decided} back={ask && askOrder ? askOrder : undefined} />}
      {!closed && <Impact p={p} names={names} />}
      {!closed && it.proposal && p.needsRefresh ? (
        <form action={refreshAction} className="panel"><Hidden {...v} />
          <p>Supply changed since this was read, and checking it again {p.error ? "found a problem" : "raised a new question"}. Refresh it to review it against current supply.</p>
          <div><NamedSubmit label="Refresh review" known={known} on="refresh" bad={bad} purpose="this refresh" /></div>
        </form>
      ) : !closed && it.proposal && (
        <form action={approveAction} className="panel"><Hidden {...v} />
          {p.stale && p.moved && <p className="fine-print" role="status">Supply changed since this was read: was {weight(p.moved.was, p.moved.unit)}, now {weight(p.moved.now, p.moved.unit)}.</p>}
          <input type="hidden" name="hash" value={p.reviewHash ?? ""} />
          <div className="row">
            <NamedSubmit label={p.change?.effect === "forecast" ? "Note this forecast" : "Approve supply change"} className="primary" known={known} on="approve" bad={bad} quiet={main !== "approve"} blocked={off ? (byField.size > 0 ? "open-questions" : "approve-why") : undefined} aria-describedby={off ? "approve-why" : undefined} />
            {off && <span id="approve-why" tabIndex={-1} className="small muted">{why}</span>}
          </div>
          <p className="fine-print">{p.change?.effect === "forecast" ? "Noting a forecast leaves confirmed supply as it is. " : "Approving changes this lot's confirmed supply only. "}It does not approve substitutions, notify buyers, confirm deliveries or record food as rescued.</p>
        </form>
      )}
    </aside>
  </>;
}

// After an approval or a dismissal: the orders an approval made short (each with Resolve), the next
// update to read or, with none left, the way back to Overview, and, for a reply to an ask, the way
// back to that order.
function NextSteps({ it, w, decided, back }: { it: InboxItem; w: Awaited<ReturnType<typeof current>>["state"]; decided: boolean; back?: { id: string; buyerId: string } }) {
  const short = decided && it.state === "approved" ? madeShort(w, it.id) : [], orders = new Map(w.ledger.snapshot.orders.map(o => [o.id, o]));
  const next = queueOrder(w.items, new Map()).find(x => x.id !== it.id && x.state !== "approved" && x.state !== "dismissed");
  // A reply to an ask: what is still short on that order, or that it is covered. An order already listed above is not said twice.
  const gap = back && it.state === "approved" && !short.some(s => s.orderId === back.id) ? planOf(w.ledger).unfilled.find(u => u.orderId === back.id) : undefined;
  return (
    <div className="panel next-steps" aria-label="What to do next">
      {back && it.state === "approved" && !short.some(s => s.orderId === back.id) && (gap
        ? <ul><li className="worse">{buyer(back.buyerId)} is still {weight(gap.amount, gap.unit)} short{" "}
            <a className="button" href={`/orders?order=${encodeURIComponent(back.id)}`}>Resolve<span className="sr-only"> {buyer(back.buyerId)}</span></a></li></ul>
        : <p className="better">{buyer(back.buyerId)} is now covered.</p>)}
      {short.length > 0 && <ul>{short.map(s => { const o = orders.get(s.orderId)!; return (
        <li key={s.orderId} className="worse">{buyer(o.buyerId)} is now {weight(s.short, s.unit)} short{" "}
          <a className="button" href={`/orders?order=${encodeURIComponent(s.orderId)}`}>Resolve<span className="sr-only"> {buyer(o.buyerId)}</span></a></li>
      ); })}</ul>}
      <div className="row">
        {decided && (next ? <a className="button" href={`/review?item=${encodeURIComponent(next.id)}`}>Next update<span className="sr-only"> ({grower(next.source.growerId)})</span></a> : <a className="button" href="/">Back to Overview</a>)}
        {back && <a className="button" href={`/orders?order=${encodeURIComponent(back.id)}`}>Back to {buyer(back.buyerId)}</a>}
      </div>
    </div>
  );
}

// The coordinator's own reading of an unread message, prefilled from the words in it. The
// grower is the message's; the lot is one of theirs. A call note is its own evidence.
const UNIT_NAMES: [string, string][] = [["lb", "lb"], ["kg", "kg"], ["g", "g"], ["each", "each"], ["case", "cases"]];
function HandForm({ it, w, v, bad, known, kv }: { it: InboxItem; w: Awaited<ReturnType<typeof current>>["state"]; v: { item: string; version: number }; bad: Bad; known: boolean; kv: (on: KeptForm, name: string) => string | undefined }) {
  const guess = suggestReading(w, it.id), call = it.source.id.startsWith("call-"), s = w.ledger.snapshot;
  const lots = s.lots.filter(l => l.growerId === it.source.growerId);
  // Starting text: what was typed if the form was refused, else the guess. The words default to the
  // shortest stretch of the message holding the guessed amount, so a late message needs no typing.
  const amount = kv("hand", "amount") ?? (guess.quantity ? String(guess.quantity.amount) : undefined);
  const quote = kv("hand", "quote") ?? (!call && amount ? numberSpan(it.source.text, amount) : undefined);
  const targets = w.ledger.events.filter(e => e.effect !== "forecast" && lots.some(l => l.id === e.lotId));
  return (
    <details open>
      <summary>Enter the details yourself</summary>
      <form action={readByHandAction} className="form"><Hidden {...v} />
        <p className="muted small">{call ? "Your call note is the evidence. Add words from it only to point at one part." : "Copy the grower's own words from the message; they are kept as the evidence."} Then check it and approve as usual.</p>
        <label>What changed
          <select name="operation" defaultValue={kv("hand", "operation") ?? guess.operation ?? ""} required {...invalid(bad, "hand", "operation")}>
            <option value="" disabled>Choose</option>
            {Object.entries(OPERATION_CHOICE).map(([o, label]) => <option key={o} value={o}>{label}</option>)}
          </select></label>
        <Problem bad={bad} on="hand" name="operation" />
        <label>Lot
          <select name="lot" defaultValue={kv("hand", "lot") ?? guess.lotId ?? ""} required {...invalid(bad, "hand", "lot")}>
            <option value="" disabled>Choose</option>
            {lots.map(l => <option key={l.id} value={l.id}>{l.product}, {l.grade}, {day(l.deliveryOn)}</option>)}
          </select></label>
        <Problem bad={bad} on="hand" name="lot" />
        <div className="row">
          <label>Amount<input name="amount" inputMode="numeric" required defaultValue={amount} {...invalid(bad, "hand", "amount")} /></label>
          <label>Unit
            <select name="unit" defaultValue={kv("hand", "unit") ?? guess.quantity?.unit ?? "lb"} {...invalid(bad, "hand", "unit")}>{UNIT_NAMES.map(([u, n]) => <option key={u} value={u}>{n}</option>)}</select></label>
        </div>
        <Problem bad={bad} on="hand" name="amount" />
        <Problem bad={bad} on="hand" name="unit" />
        <label>Grade<input name="grade" required maxLength={80} defaultValue={kv("hand", "grade") ?? guess.grade} {...invalid(bad, "hand", "grade")} /></label>
        <Problem bad={bad} on="hand" name="grade" />
        <label>Delivery day<input name="day" type="date" required defaultValue={kv("hand", "day") ?? guess.deliveryOn} {...invalid(bad, "hand", "day")} /></label>
        <Problem bad={bad} on="hand" name="day" />
        {targets.length > 0 && <label>Earlier update being corrected, if this is a correction
          <select name="target" defaultValue={kv("hand", "target") ?? ""}><option value="">Not a correction</option>
            {targets.map(e => { const l = s.lots.find(x => x.id === e.lotId)!; return <option key={e.id} value={e.id}>{l.product}: {quantity(e.lotBefore)} to {quantity(e.lotAfter)}</option>; })}
          </select></label>}
        <label>{call ? "Words from the note (optional)" : "Words in the message"}<input name="quote" required={!call} maxLength={500} defaultValue={quote} {...invalid(bad, "hand", "quote")} /></label>
        <Problem bad={bad} on="hand" name="quote" />
        <div><NamedSubmit label=<>Save these details <span className="sr-only">for {grower(it.source.growerId)}</span></> known={known} on="hand" bad={bad} purpose="this reading" /></div>
      </form>
    </details>
  );
}

// One history line, said as what a person did: "Alder Creek Farm replied: “6 lb in each”".
// How a message or reply was read automatically (the model, its recording date and prompt
// version) is not said here: it is kept on the event page under "Technical record" and in the export.
function HistoryLine({ d, it }: { d: Decision; it: InboxItem }) {
  const g = grower(it.source.growerId), q = (s?: string) => s ? `: “${s}”` : "";
  const detail = (s: string) => <span className="muted small"> ({s})</span>;
  switch (d.kind) {
    case "received": return it.source.id.startsWith("call-")
      ? <>Call from {g}{d.note?.startsWith("Call note by ") ? `, noted by ${d.note.slice("Call note by ".length)}` : ""}</>
      : <>{g} sent the message</>;
    case "interpreted": return d.note === BY_HAND ? <>{d.actor} entered the reading by hand</> : <>Read automatically</>;
    case "asked": { const [f, ...rest] = (d.note ?? "").split(": "); const known = FIELDS.includes(f as Field);
      return <>{d.actor} asked {g}{q(known ? rest.join(": ") : d.note)}</>; }
    case "replied": {
      // Earlier versions kept the reader inside the note: "text (read by …)".
      const old = !d.by ? d.note?.match(/^([\s\S]*) \(read by (.*)\)$/) : null, text = old ? old[1] : d.note, by = d.by ?? old?.[2];
      return <>{g} replied{q(text)}{by === "coordinator" ? detail(`entered by ${d.actor}`) : by ? detail("read automatically") : null}</>;
    }
    case "corrected": return <>{d.actor} corrected the reading</>;
    case "lot-confirmed": return <>{d.actor} confirmed the lot</>;
    case "left-pending": return <>{d.actor} left it pending{q(d.note)}</>;
    case "returned": return <>{d.actor} returned it to {g}{q(d.note)}</>;
    case "dismissed": return <>{d.actor} dismissed it{q(d.note)}</>;
    case "refreshed": return <>{d.actor} checked it again against current supply</>;
    case "approved": return <>{d.actor} approved the supply change</>;
    default: return <>{d.actor}: {d.kind}</>;
  }
}

function ChangeTag({ it, p, event }: { it: InboxItem; p: Preview; event?: { id: string; effect: string; proposal: { interpretation: { quantity?: Quantity } }; approval: { reviewer: string }; lotBefore: { amount: number; unit: Quantity["unit"] }; lotAfter: { amount: number; unit: Quantity["unit"] } } }) {
  if (event?.effect === "forecast") return (
    <div className="tag done">
      <p className="from">Approved by {event.approval.reviewer}</p>
      <p className="to">Forecast noted{forecastTag({ expected: event.proposal.interpretation.quantity }) ? `: ${forecastTag({ expected: event.proposal.interpretation.quantity })}` : ""}</p>
      <p className="what">Confirmed supply is unchanged. <a href={`/events/${event.id}`}>View recorded change</a></p>
    </div>
  );
  if (event) return (
    <div className="tag done">
      <p className="from">Approved by {event.approval.reviewer}</p>
      <p className="to">{quantity(event.lotAfter)}</p>
      <p className="what">was {quantity(event.lotBefore)}. <a href={`/events/${event.id}`}>View recorded change</a></p>
    </div>
  );
  if (it.state === "dismissed") return <div className="tag"><p className="to">No change</p><p className="what">Dismissed: {it.decisions.at(-1)?.note}</p></div>;
  if (!it.proposal) return (
    <div className="tag blocked">
      <p className="from">Not checked yet</p>
      <p className="to">Waiting on your answer</p>
      <p className="what">The change appears once the message has a reading.</p>
    </div>
  );
  if (p.needsRefresh) return (
    <div className="tag">
      <p className="from">Supply changed</p>
      <p className="to">Check it again</p>
      <p className="what">{p.error ? `Checked against current supply: ${p.error}` : "Checked against current supply, it raises a new question. Refresh to review it."}</p>
    </div>
  );
  if (!p.change) return (
    <div className="tag blocked">
      <p className="from">{p.error ? "Cannot preview" : "Needs an answer"}</p>
      <p className="to">Waiting on your answer</p>
      <p className="what">{p.error ?? "The change can't be worked out until the open details are answered."}</p>
    </div>
  );
  const c = p.change;
  return (
    <div className="tag">
      <p className="from">{c.effect === "forecast" ? "Forecast, kept apart from confirmed supply" : "Confirmed supply, if you approve"}</p>
      {(c.effect !== "forecast" || forecastTag(c)) && <p className="to">{c.effect === "forecast" ? forecastTag(c) : changeLine(c.before, c.after)}</p>}
      <p className="what">{c.effect === "replace-total" ? "New total replaces the old one" : c.effect === "add-quantity" ? "Added to the existing lot" : "Not allocatable until confirmed"}</p>
    </div>
  );
}

function Impact({ p, names }: { p: Preview; names: Map<string, string> }) {
  const changed = p.orders.filter(o => JSON.stringify(o.before) !== JSON.stringify(o.after));
  const extra = p.unallocated.filter(u => u.before !== u.after);
  return (
    <div className="panel impact">
      <h3>Who gets what if you approve</h3>
      {p.orders.map(o => {
        const moved = changed.includes(o);
        return (
          <div key={o.orderId} className="line">
            <span>{names.get(o.orderId) ?? o.orderId}</span>
            <span>{o.after.short > 0 ? <span className={moved && o.after.short > o.before.short ? "worse" : ""}>{weight(o.after.short, o.unit)} short</span> : <span className={moved ? "better" : "muted"}>covered</span>}
              {moved && <span className="muted small"> (was {o.before.short ? `${weight(o.before.short, o.unit)} short` : "covered"})</span>}
              {o.after.substitute > 0 && <span className="muted small"><br />{weight(o.after.substitute, o.unit)} by approved substitute</span>}</span>
          </div>
        );
      })}
      {extra.map(u => <div key={u.lotId} className="line"><span>Not going to anyone yet: {names.get(u.lotId) ?? u.lotId}</span><span>{weight(u.after, u.unit)} <span className="muted small">(was {weight(u.before, u.unit)})</span></span></div>)}
    </div>
  );
}
