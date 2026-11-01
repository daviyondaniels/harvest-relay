import type { Metadata } from "next";
import { CONTACTS } from "../../src/demo.ts";
import { logCallAction } from "../actions.ts";
import { Problem, fieldId, invalid, type Bad } from "../lib/field-error.tsx";
import { current } from "../lib/hub.ts";
import { rememberedName } from "../lib/name.ts";
import { NamedSubmit } from "../named-submit.tsx";
import { readNotice } from "../lib/notice.ts";
import { Result } from "../result.tsx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Log a call" };

// A grower's phone call, written down by the coordinator. It becomes an inbox message
// and is read and reviewed like any text; the note is the evidence.
export default async function Call({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams, grower = typeof params.grower === "string" ? params.grower : undefined;
  const notice = readNotice(params, { page: "/call", id: grower }), note = typeof params.note === "string" ? params.note : undefined;
  const { version } = await current(), known = !!await rememberedName();
  // A problem with a field is shown beside it, and focus moves there.
  const bad: Bad = notice?.on === "call" && (notice.field === "grower" || notice.field === "note" || notice.field === "who") ? { on: "call", field: notice.field, text: notice.text } : undefined;
  return (
    <section className="panel call" aria-labelledby="call">
      {notice && <Result key={String(params.sig)} focus={bad ? fieldId(bad.on, bad.field) : "call"} />}
      {notice && !bad && <p className="error" role="alert">{notice.text}</p>}
      <h1 id="call" tabIndex={-1}>Log a call</h1>
      <p className="muted small">Write what the grower said, in their terms. The note goes to Review updates as a message and changes nothing until it is reviewed and approved.</p>
      <form action={logCallAction} className="form">
        <input type="hidden" name="version" value={version} />
        <label>Who called
          <select name="grower" required defaultValue={CONTACTS.some(c => c.id === grower) ? grower : ""} {...invalid(bad, "call", "grower")}>
            <option value="" disabled>Choose</option>
            {CONTACTS.map(c => <option key={c.id} value={c.id}>{c.name}{c.kind === "outside" ? " (outside source)" : ""}</option>)}
          </select>
        </label>
        <Problem bad={bad} on="call" name="grower" />
        <label>Call note<textarea name="note" required maxLength={480} rows={4} defaultValue={note?.slice(0, 480)} placeholder="Said they can bring 20 lb of standard tomatoes Friday." {...invalid(bad, "call", "note")} /></label>
        <Problem bad={bad} on="call" name="note" />
        <div><NamedSubmit label="Log call and review it" className="primary" known={known} on="call" bad={bad} /></div>
      </form>
    </section>
  );
}
