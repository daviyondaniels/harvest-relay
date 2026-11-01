import type { Metadata } from "next";
import type { ReactNode } from "react";
import { conflicts } from "../../src/commitments.ts";
import { normalize, type Quantity } from "../../src/quantity.ts";
import { FIELDS, type Field, type Span } from "../../src/updates.ts";
import { BY_HAND, madeShort, needingRefresh, suggestReading, type Decision, type InboxItem, type Preview } from "../../src/workbench.ts";
import { SEED } from "../../src/seed.ts";
import { approveAction, askAction, confirmLotAction, correctAction, dismissAction, dismissNoChangeAction, liveAllowance, liveReadAction, liveReplyAction, pendingAction, readByHandAction, refreshAction, refreshAllAction, replyAction, returnAction, scriptedReplyAction } from "../actions.ts";
import { FIELD, OPERATION, buyer, forecastTag, day, evidence, grower, quantity, status, time, weight } from "../lib/format.ts";
import { Result } from "../result.tsx";
import { Conflicts } from "../conflict.tsx";
import { Problem, fieldId, invalid, type Bad } from "../lib/field-error.tsx";
import { current, recording } from "../lib/hub.ts";
import { readNotice, type Notice } from "../lib/notice.ts";
import { QueueFold } from "../queue-fold.tsx";
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
function FieldSelect({ only, bad, on }: { only?: Field[]; bad: Bad; on: string }) {
  return <>
    <label>Detail
      <select name="field" defaultValue={only?.[0]} {...invalid(bad, on, "field")}>{(only ?? FIELDS.filter(f => f !== "unit")).map(f => <option key={f} value={f}>{FIELD[f]}</option>)}</select>
    </label>
    <Problem bad={bad} on={on} name="field" />
  </>;
}
// What a correction changed, said as a value rather than as data.
const shown = (v: unknown) => v && typeof v === "object" && "amount" in v ? quantity(v as Quantity) : typeof v === "string" ? v : "nothing";

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
      <nav className="queue" id="queue" aria-label="Incoming messages">
        <QueueFold count={todo.length} noun="messages" open={!!allBad}>
          <h2>Incoming</h2>
          {stale > 0 && it && <form action={refreshAllAction} className="form"><Hidden item={it.id} version={version} />
            <NamedSubmit label="Refresh all stale items" known={known} on="refreshAll" bad={allBad} />
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
      {it ? <Item it={it} p={previews.get(it.id)!} version={version} notice={notice} cuts={<Conflicts w={w} version={version} known={known} page="/review" id={it.id} params={params} level={3} lotId={w.ledger.events.find(e => e.id === it.eventId)?.lotId} />} sig={String(params.sig)} known={known} queueFocus={allBad ? fieldId("refreshAll", "who") : undefined} live={live} hasScript={!!rec?.raw[SEED.find(s => s.source.id === it.source.id)?.reply?.id ?? ""] && it.replies.length === 0 && !!SEED.find(s => s.source.id === it.source.id)?.reply} w={w} />
        : <p className="muted">No messages yet.</p>}
    </div>
  );
}

function Item({ it, p, version, notice, cuts, sig, known, queueFocus, live, hasScript, w }: { it: InboxItem; p: Preview; version: number; notice?: Notice; cuts: ReactNode; sig: string; known: boolean; queueFocus?: string; live: number; hasScript: boolean; w: Awaited<ReturnType<typeof current>>["state"] }) {
  const closed = it.state === "approved" || it.state === "dismissed";
  const i = it.proposal?.interpretation, lot = w.ledger.snapshot.lots.find(l => l.id === i?.lotId);
  const quotes = (f: Field) => (it.proposal?.clarifications ?? []).filter(c => c.field === f && c.answer).map(c => c.answer!.source.text.slice(c.answer!.span.start, c.answer!.span.end));
  const byField = new Map<Field, string[]>();
  for (const q of p.questions) byField.set(q.field, [...(byField.get(q.field) ?? []), q.question.replace(/^Unanswered: /, "")]);
  const asked = (it.proposal?.clarifications ?? []);
  const event = it.eventId ? w.ledger.events.find(e => e.id === it.eventId) : undefined;
  const v = { item: it.id, version };
  // Just approved, or just dismissed (with "No change, dismiss" or Dismiss): the result panel says what comes next.
  const decided = !!notice?.ok && (notice.on === "approve" || (notice.on === "hold" && it.state === "dismissed"));
  // Why Approve is off, said beside it.
  const off = p.questions.length > 0 || !p.change;
  const why = byField.size > 0 ? (byField.size === 1 ? "Answer the open detail above to approve." : `Answer the ${byField.size} open details above to approve.`) : "Approve is available once the change can be worked out.";
  // The ask this message answers, by the order's product and buyer.
  const ask = it.requestId ? w.resolutions.find(r => r.id === it.requestId) : undefined, askOrder = ask && w.ledger.snapshot.orders.find(o => o.id === ask.orderId);
  const names = new Map<string, string>([...w.ledger.snapshot.orders.map(o => [o.id, buyer(o.buyerId)] as const), ...w.ledger.snapshot.lots.map(l => [l.id, `${l.product}, ${grower(l.growerId)}`] as const)]);
  const from = grower(it.source.growerId);
  // A problem with a field of a form still on the page (a missing name included) is shown
  // beside that field; anything else at the top of the message.
  const forms = closed ? [] : ["hold", ...(hasScript ? ["script"] : []), ...(live > 0 ? ["read"] : []),
    ...(i ? ["ask", "reply", "correct", ...(i.lotId ? ["lot"] : [])] : ["hand"]), ...(it.proposal ? [p.needsRefresh ? "refresh" : "approve"] : [])];
  const bad: Bad = notice && !notice.ok && notice.field && forms.includes(notice.on ?? "") ? { on: notice.on!, field: notice.field, text: notice.text } : undefined;
  const top = notice && !notice.ok && !bad && !queueFocus ? notice : undefined;
  // Where focus goes: the field with the problem, else the result's heading.
  const focus = bad ? fieldId(bad.on, bad.field) : notice?.ok && notice.on === "approve" ? (notice.res && conflicts(w.ledger).some(c => c.lotId === notice.res) ? `cut-${notice.res}-head` : "change") : queueFocus ?? (notice ? "msg" : undefined);
  return <>
    <section className="panel" id="item" aria-labelledby="msg">
      {notice && <Result key={sig} text={notice.ok && notice.on !== "approve" ? notice.text : undefined} focus={focus} />}
      {top && <p className="error" role="alert">{top.text}</p>}
      <div className="section-head">
        <h1 id="msg" tabIndex={-1}>{from}</h1>
        <span className="muted small">{it.source.id.startsWith("call-") ? `${it.decisions[0]?.note ?? "Call note"}, ` : ""}Received {time(it.receivedAt)}</span>
      </div>
      {ask && askOrder && <p className="small">Reply to your ask about {askOrder.product} for {buyer(askOrder.buyerId)}. <a href={`/orders?order=${encodeURIComponent(askOrder.id)}#${ask.id}`}>Open the order</a></p>}
      <p className="message"><Highlighted text={it.source.text} spans={evidence(it.proposal, it.source.id)} /></p>
      {(asked.length > 0 || it.replies.length > 0) && (
        <div className="thread" aria-label="Clarification conversation">
          {asked.filter(c => !c.question.startsWith("Coordinator reading") && !c.question.startsWith("Reply corrects")).map((c, n) => (
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
          <h2>Reading</h2>
          <p className="muted small">{it.interpretedBy === BY_HAND ? "Entered by hand. Check the highlighted words." : "Read automatically. Check the highlighted words."}</p>
        </div>
        <table className="reading"><tbody>
          <tr><td>Kind of update</td><td><b>{OPERATION[i.operation]}</b></td></tr>
          <tr><td>Lot</td><td>{lot ? `${lot.product}, ${grower(lot.growerId)}` : "not identified"}</td></tr>
          <tr><td>Quantity</td><td>{quantity(i.quantity)}{quotes("pack").length ? <span className="quote"><br />contents from reply: “{quotes("pack").join("”, “")}”</span> : null}</td></tr>
          <tr><td>Grade</td><td>{i.grade ?? "not stated"}</td></tr>
          <tr><td>Delivery day</td><td>{i.deliveryOn ? day(i.deliveryOn) : "not stated"}</td></tr>
        </tbody></table>
      </> : <p className="blocker">This message has not been read yet. {closed ? "" : live > 0 ? "Use Read automatically below, or enter the reading yourself." : "Enter the reading below."}</p>}

      {byField.size > 0 && !closed && (
        <div className="blocker" role="status">
          <b>{byField.size === 1 ? "One detail needs an answer before approval" : `${byField.size} details need answers before approval`}</b>
          <ul>{[...byField].map(([f, qs]) => <li key={f}><b>{FIELD[f]}:</b> {qs[0]}</li>)}</ul>
        </div>
      )}

      {!closed && <div className="form">
        <div className="row">
          {hasScript && <form action={scriptedReplyAction} className="form"><Hidden {...v} /><NamedSubmit label="Receive the grower's reply (demo)" known={known} on="script" bad={bad} /></form>}
          {(!i || i.operation === "unresolved") && <form action={dismissNoChangeAction} className="form"><Hidden {...v} /><NamedSubmit label="No change, dismiss" known={known} on="hold" bad={bad} /></form>}
          {live > 0 && <form action={liveReadAction} className="form"><Hidden {...v} /><NamedSubmit label={i ? "Read again automatically" : "Read automatically"} known={known} on="read" bad={bad} /></form>}
        </div>
        {!i && <HandForm it={it} w={w} v={v} bad={bad} known={known} />}
        {i?.lotId && <details open={bad?.on === "lot"}>
          <summary>Mark the lot as checked</summary>
          <form action={confirmLotAction} className="form"><Hidden {...v} />
            <p className="muted small">Adds a line to the history that you checked this is the right lot. Approving does not need it.</p>
            <div><NamedSubmit label="Confirm lot" known={known} on="lot" bad={bad} /></div>
          </form>
        </details>}
        {i && <details open={bad?.on === "ask"}>
          <summary>Ask the grower</summary>
          <form action={askAction} className="form"><Hidden {...v} />
            <FieldSelect only={byField.size ? [...byField.keys()] : undefined} bad={bad} on="ask" />
            <label>Question<input name="question" required maxLength={500} placeholder="How much is in each case?" {...invalid(bad, "ask", "question")} /></label>
            <Problem bad={bad} on="ask" name="question" />
            <div><NamedSubmit label=<>Record question <span className="sr-only">for {from}</span></> known={known} on="ask" bad={bad} /></div>
          </form>
        </details>}
        {i && <details open={bad?.on === "reply"}>
          <summary>Add the grower's reply</summary>
          <form action={replyAction} className="form"><Hidden {...v} />
            <label>Reply, exactly as received<textarea name="reply" required maxLength={2000} rows={2} {...invalid(bad, "reply", "reply")} /></label>
            <Problem bad={bad} on="reply" name="reply" />
            <FieldSelect only={byField.size ? [...byField.keys()] : undefined} bad={bad} on="reply" />
            <label>Words in the reply that answer it<input name="quote" required {...invalid(bad, "reply", "quote")} /></label>
            <Problem bad={bad} on="reply" name="quote" />
            <label>Value<input name="value" required placeholder="3 kg" {...invalid(bad, "reply", "value")} /></label>
            <Problem bad={bad} on="reply" name="value" />
            <div className="row"><NamedSubmit label="Apply answer" known={known} on="reply" bad={bad} />{live > 0 && <button type="submit" formAction={liveReplyAction} formNoValidate>Read the reply automatically</button>}</div>
          </form>
        </details>}
        {i && <details open={bad?.on === "correct"}>
          <summary>Correct the reading</summary>
          <form action={correctAction} className="form"><Hidden {...v} />
            <p className="muted small">Use the grower's own words from the message. The change and the quote are kept in the history.</p>
            <FieldSelect bad={bad} on="correct" />
            <label>Words in the message<input name="quote" required {...invalid(bad, "correct", "quote")} /></label>
            <Problem bad={bad} on="correct" name="quote" />
            <label>Value<input name="value" required placeholder="add-quantity, 4 cases, standard or 2026-10-30" {...invalid(bad, "correct", "value")} /></label>
            <Problem bad={bad} on="correct" name="value" />
            <div><NamedSubmit label="Apply correction" known={known} on="correct" bad={bad} /></div>
          </form>
        </details>}
        <details open={bad?.on === "hold"}>
          <summary>Leave pending, return or dismiss</summary>
          <form className="form"><Hidden {...v} />
            <label>Note or reason<input name="note" required maxLength={500} {...invalid(bad, "hold", "note")} /></label>
            <Problem bad={bad} on="hold" name="note" />
            <NameField known={known} on="hold" bad={bad} />
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
      <h2 id="change" tabIndex={-1}>Change preview</h2>
      {notice?.ok && notice.on === "approve" && <Result key={sig} text={notice.text} />}
      <ChangeTag it={it} p={p} event={event} />
      {it.state === "approved" && event && event.effect !== "forecast" && cuts}
      {closed && (decided || (ask && askOrder)) && <NextSteps it={it} w={w} decided={decided} back={ask && askOrder ? askOrder : undefined} />}
      {!closed && <Impact p={p} names={names} />}
      {!closed && it.proposal && p.needsRefresh ? (
        <form action={refreshAction} className="panel"><Hidden {...v} />
          <p>Supply changed since this was read, and checking it again {p.error ? "found a problem" : "raised a new question"}. Refresh it to review it against current supply.</p>
          <div><NamedSubmit label="Refresh review" known={known} on="refresh" bad={bad} /></div>
        </form>
      ) : !closed && it.proposal && (
        <form action={approveAction} className="panel"><Hidden {...v} />
          {p.stale && p.moved && <p className="fine-print" role="status">Supply changed since this was read: was {weight(p.moved.was, p.moved.unit)}, now {weight(p.moved.now, p.moved.unit)}.</p>}
          <input type="hidden" name="hash" value={p.reviewHash ?? ""} />
          <div className="row">
            <NamedSubmit label="Approve supply change" className="primary" known={known} on="approve" bad={bad} disabled={off} aria-describedby={off ? "approve-why" : undefined} />
            {off && <span id="approve-why" className="small muted">{why}</span>}
          </div>
          <p className="fine-print">Approving changes this lot's confirmed supply only. It does not approve substitutions, notify buyers, confirm deliveries or record food as rescued.</p>
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
  return (
    <div className="panel next-steps" aria-label="What to do next">
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
function HandForm({ it, w, v, bad, known }: { it: InboxItem; w: Awaited<ReturnType<typeof current>>["state"]; v: { item: string; version: number }; bad: Bad; known: boolean }) {
  const guess = suggestReading(w, it.id), call = it.source.id.startsWith("call-"), s = w.ledger.snapshot;
  const lots = s.lots.filter(l => l.growerId === it.source.growerId);
  const targets = w.ledger.events.filter(e => e.effect !== "forecast" && lots.some(l => l.id === e.lotId));
  return (
    <details open>
      <summary>Enter the reading yourself</summary>
      <form action={readByHandAction} className="form"><Hidden {...v} />
        <p className="muted small">{call ? "Your call note is the evidence. Add words from it only to point at one part." : "Copy the grower's own words from the message; they are kept as the evidence."} Then check it and approve as usual.</p>
        <label>What changed
          <select name="operation" defaultValue={guess.operation ?? ""} required {...invalid(bad, "hand", "operation")}>
            <option value="" disabled>Choose</option>
            {(["replace-total", "add-quantity", "correction", "forecast"] as const).map(o => <option key={o} value={o}>{OPERATION[o]}</option>)}
          </select></label>
        <Problem bad={bad} on="hand" name="operation" />
        <label>Lot
          <select name="lot" defaultValue={guess.lotId ?? ""} required {...invalid(bad, "hand", "lot")}>
            <option value="" disabled>Choose</option>
            {lots.map(l => <option key={l.id} value={l.id}>{l.product}, {l.grade}, {day(l.deliveryOn)}</option>)}
          </select></label>
        <Problem bad={bad} on="hand" name="lot" />
        <div className="row">
          <label>Amount<input name="amount" inputMode="numeric" required defaultValue={guess.quantity?.amount} {...invalid(bad, "hand", "amount")} /></label>
          <label>Unit
            <select name="unit" defaultValue={guess.quantity?.unit ?? "lb"} {...invalid(bad, "hand", "unit")}>{UNIT_NAMES.map(([u, n]) => <option key={u} value={u}>{n}</option>)}</select></label>
        </div>
        <Problem bad={bad} on="hand" name="amount" />
        <Problem bad={bad} on="hand" name="unit" />
        <label>Grade<input name="grade" required defaultValue={guess.grade} {...invalid(bad, "hand", "grade")} /></label>
        <Problem bad={bad} on="hand" name="grade" />
        <label>Delivery day<input name="day" type="date" required defaultValue={guess.deliveryOn} {...invalid(bad, "hand", "day")} /></label>
        <Problem bad={bad} on="hand" name="day" />
        {targets.length > 0 && <label>Earlier update being corrected, if this is a correction
          <select name="target" defaultValue=""><option value="">Not a correction</option>
            {targets.map(e => { const l = s.lots.find(x => x.id === e.lotId)!; return <option key={e.id} value={e.id}>{l.product}: {quantity(e.lotBefore)} to {quantity(e.lotAfter)}</option>; })}
          </select></label>}
        <label>{call ? "Words from the note (optional)" : "Words in the message"}<input name="quote" required={!call} {...invalid(bad, "hand", "quote")} /></label>
        <Problem bad={bad} on="hand" name="quote" />
        <div><NamedSubmit label=<>Save the reading <span className="sr-only">for {grower(it.source.growerId)}</span></> known={known} on="hand" bad={bad} /></div>
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

function ChangeTag({ it, p, event }: { it: InboxItem; p: Preview; event?: { id: string; approval: { reviewer: string }; lotBefore: { amount: number; unit: Quantity["unit"] }; lotAfter: { amount: number; unit: Quantity["unit"] } } }) {
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
      <p className="from">Not read yet</p>
      <p className="to">Not worked out yet</p>
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
      <p className="from">{p.error ? "Cannot preview" : "Waiting on answers"}</p>
      <p className="to">Not worked out yet</p>
      <p className="what">{p.error ?? "The change can't be worked out until the open details are answered."}</p>
    </div>
  );
  const c = p.change, before = normalize(c.before), after = normalize(c.after), delta = after.amount - before.amount;
  return (
    <div className="tag">
      <p className="from">{c.effect === "forecast" ? "Forecast, kept apart from confirmed supply" : `${weight(before.amount, before.unit)} confirmed now`}</p>
      {(c.effect !== "forecast" || forecastTag(c)) && <p className="to">{c.effect === "forecast" ? forecastTag(c) : <>{delta >= 0 ? "add" : "remove"} <span className="nowrap">{weight(Math.abs(delta), after.unit)}</span> <span className="nowrap">→ {weight(after.amount, after.unit)}</span></>}</p>}
      <p className="what">{c.effect === "replace-total" ? "New total replaces the old one" : c.effect === "add-quantity" ? "Added to the existing lot" : "Not allocatable until confirmed"}</p>
    </div>
  );
}

function Impact({ p, names }: { p: Preview; names: Map<string, string> }) {
  const changed = p.orders.filter(o => JSON.stringify(o.before) !== JSON.stringify(o.after));
  const extra = p.unallocated.filter(u => u.before !== u.after);
  return (
    <div className="panel impact">
      <h3>If approved: proposed allocation</h3>
      <p className="fine-print">A separate proposal; nothing here is reserved or sent.</p>
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
      {extra.map(u => <div key={u.lotId} className="line"><span>Unallocated {names.get(u.lotId) ?? u.lotId}</span><span>{weight(u.after, u.unit)} <span className="muted small">(was {weight(u.before, u.unit)})</span></span></div>)}
    </div>
  );
}
