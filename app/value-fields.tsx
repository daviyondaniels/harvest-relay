"use client";
import { useState, type ReactNode } from "react";
import { Problem, fieldId, invalid, type Bad } from "./lib/field-error.tsx";
import { NamedSubmit } from "./named-submit.tsx";

// The detail being answered and its value. The value's control fits the detail: a choice of
// what changed, a date picker for the delivery day, a lot to pick, otherwise a box with an
// example of how to write it. Sent as plain form fields "field" and "value".
export type Choice = { value: string; label: string };
const EXAMPLE: Record<string, string> = { quantity: "10 lb", unit: "10 lb", pack: "6 lb", grade: "standard", "correction-target": "" };
export function ValueFields({ on, details, kinds, lots, bad, field, value }: {
  on: string; details: Choice[]; kinds: Choice[]; lots: Choice[]; bad: Bad; field?: string; value?: string;
}) {
  const [now, setNow] = useState(details.some(d => d.value === field) ? field! : details[0]?.value);
  const mine = field === now ? value : undefined;
  return <>
    <label>Detail
      <select name="field" value={now} onChange={e => setNow(e.target.value)} {...invalid(bad, on, "field")}>{details.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}</select>
    </label>
    <Problem bad={bad} on={on} name="field" />
    {now === "operation" || now === "lot" ? (
      <label>Value
        <select key={now} name="value" required defaultValue={mine ?? ""} {...invalid(bad, on, "value")}>
          <option value="" disabled>Choose</option>
          {(now === "operation" ? kinds : lots).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select></label>
    ) : (
      <label>Value
        <input key={now} name="value" required type={now === "date" ? "date" : "text"} defaultValue={mine} placeholder={EXAMPLE[now ?? ""] || undefined} {...invalid(bad, on, "value")} /></label>
    )}
    <Problem bad={bad} on={on} name="value" />
  </>;
}

// One reply, one value for each open detail: every open question is answered from the same pasted reply.
// Sent as "value-<detail>" fields. When every open detail has a value, the answers close the last question and the
// button is "Apply and approve" (it sends andApprove=1); otherwise it is "Apply answers". Without scripts the
// button is "Apply answers", which never approves.
export function AnswerFields({ on, details, kinds, lots, bad, kept, known, quiet, quote, extra }: {
  on: string; details: Choice[]; kinds: Choice[]; lots: Choice[]; bad: Bad; kept: Record<string, string | undefined>; known: boolean; quiet: boolean; quote: ReactNode; extra?: ReactNode;
}) {
  const [typed, setTyped] = useState<Record<string, string>>(() => Object.fromEntries(details.map(d => [d.value, kept[d.value] ?? ""])));
  const set = (k: string) => (e: { target: { value: string } }) => setTyped(t => ({ ...t, [k]: e.target.value }));
  const all = details.every(d => typed[d.value]?.trim()), name = (k: string) => `value-${k}`;
  return <>
    {details.map(d => {
      const k = d.value, shared = { name: name(k), value: typed[k] ?? "", onChange: set(k), required: details.length === 1, ...invalid(bad, on, name(k)) };
      return <div key={k}>
        <label>{d.label}
          {k === "operation" || k === "lot"
            ? <select {...shared}><option value="">Choose</option>{(k === "operation" ? kinds : lots).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            : <input {...shared} type={k === "date" ? "date" : "text"} placeholder={EXAMPLE[k] || undefined} />}
        </label>
        <Problem bad={bad} on={on} name={name(k)} />
      </div>;
    })}
    {bad?.on === on && bad.field === "value" && <div id={fieldId(on, "value")} tabIndex={-1}><Problem bad={bad} on={on} name="value" /></div>}
    {quote}
    <div className="row">
      <NamedSubmit label={all ? "Apply and approve" : "Apply answers"} {...(all ? { name: "andApprove", value: "1" } : {})} className={all ? "primary" : undefined} known={known} on={on} bad={bad} quiet={quiet} purpose={all ? "this approval" : "this answer"} />
      {extra}
    </div>
    {all && <p className="fine-print">Applies these answers, then approves the change shown, in one step.</p>}
  </>;
}
