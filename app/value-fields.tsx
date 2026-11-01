"use client";
import { useState } from "react";
import { Problem, invalid, type Bad } from "./lib/field-error.tsx";

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
