import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FIELD, OPERATION, grower, quantity, time } from "../../lib/format.ts";
import { current } from "../../lib/hub.ts";

export const dynamic = "force-dynamic";
// A change that no longer exists (after Reset demo) is a 404, and the tab says so.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await current()).state.ledger.events.some(x => x.id === id) ? "Recorded change" : "Not found" };
}

// The recorded change, said as a sentence: what was approved, by whom, from which words. The
// model, source IDs, revisions and inventory hashes kept in the ledger's append-only history
// sit under "Technical record".
export default async function Event({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { state: w } = await current();
  const e = w.ledger.events.find(x => x.id === id);
  if (!e) notFound();
  const item = w.items.find(i => i.eventId === e.id), p = e.proposal, i = p.interpretation;
  const approvedAt = item?.decisions.find(d => d.kind === "approved")?.at;
  // The model, recording date and prompt version behind each automatic reading: kept here and
  // in the history and the export, not on the review screen.
  const reads = (item?.decisions ?? []).flatMap(d => d.kind === "interpreted" && d.note ? [`Message read automatically: ${d.note}`]
    : d.kind === "replied" && d.by && d.by !== "coordinator" ? [`Reply read automatically: ${d.by}`] : []);
  const lot = w.ledger.snapshot.lots.find(l => l.id === e.lotId), where = lot ? `${lot.product}, ${grower(lot.growerId)}` : "Recorded change";
  const what = e.effect === "forecast" ? `forecast noted (${OPERATION[i.operation].toLowerCase()})` : `${quantity(e.lotBefore)} → ${quantity(e.lotAfter)}`;
  return (
    <article className="panel" style={{ maxWidth: 760 }}>
      <h1>{where}: {what}, approved by {e.approval.reviewer}</h1>
      <p className="muted">{OPERATION[i.operation]}{approvedAt ? `, approved ${time(approvedAt)}` : ""}.</p>
      <div>
        <h2>Message</h2>
        <p className="message">“{p.source.text}”</p>
        <p className="muted small">From {grower(p.source.growerId)}</p>
      </div>
      {p.clarifications.some(c => c.answer) && <div>
        <h2>Answers used</h2>
        <ul>{p.clarifications.filter(c => c.answer).map((c, n) => <li key={n}>{FIELD[c.field]}: “{c.answer!.source.text.slice(c.answer!.span.start, c.answer!.span.end)}”</li>)}</ul>
      </div>}
      <details>
        <summary>Technical record</summary>
        {reads.length > 0 && <>
          <h2>How it was read</h2>
          <ul>{reads.map((r, n) => <li key={n}>{r}</li>)}</ul>
        </>}
        <table><tbody>
          <tr><td>Change</td><td><code>{e.id}</code></td></tr>
          <tr><td>Message</td><td><code>{p.source.id}</code>, revision {p.source.revision}</td></tr>
          {p.clarifications.filter(c => c.answer).map((c, n) => <tr key={n}><td>Answer for {FIELD[c.field].toLowerCase()}</td><td><code>{c.answer!.source.id}</code></td></tr>)}
          <tr><td>Review hash approved</td><td><code>{e.approval.reviewHash}</code></td></tr>
          <tr><td>Inventory before</td><td><code>{e.beforeHash}</code></td></tr>
          <tr><td>Inventory after</td><td><code>{e.afterHash}</code></td></tr>
        </tbody></table>
      </details>
      <p><a href="/">Back to overview</a>{item && <> · <a href={`/review?item=${item.id}`}>Back to the message</a></>}</p>
    </article>
  );
}
