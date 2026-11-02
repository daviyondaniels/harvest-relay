"use client";
import { useState } from "react";
import { leftToPlace } from "./lib/cut.ts";

// The choice on the cut card: one buyer takes it all, or it is split. The split boxes sit in their own fieldset, tied to
// the Split radio: typing in a box selects Split, picking a buyer clears the boxes (so nothing typed is left beside a
// choice that would ignore it), and a live line says how much of the total is still to place. A blank box counts as 0.
// The server still refuses amounts posted with any other choice. Everything here also works as a plain form without script.
type Radio = { id: string; label: string };
type Row = { id: string; label: string; max: number; initial: string };
export function CutChoice({ on, excess, excessText, unit, radios, split, splitLabel, rows, initial }: {
  on: string; excess: number; excessText: string; unit: "g" | "lb" | "each"; radios: Radio[]; split: boolean; splitLabel: string; rows: Row[]; initial?: string;
}) {
  const [choice, setChoice] = useState(initial), [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.id, r.initial])));
  const amounts = rows.map(r => vals[r.id] ?? "");
  return <>
    {radios.map(r => (
      <label key={r.id} className="check"><input type="radio" name="choice" value={r.id} checked={choice === r.id} onChange={() => { setChoice(r.id); setVals(Object.fromEntries(rows.map(x => [x.id, ""]))); }} /><span>{r.label}</span></label>
    ))}
    {split && <label className="check"><input type="radio" name="choice" value="split" checked={choice === "split"} onChange={() => setChoice("split")} /><span>{splitLabel}</span></label>}
    {split && <fieldset className="split" aria-describedby={`${on}-total`}>
      <legend>Split it: pounds each buyer gets less</legend>
      <p id={`${on}-total`} className="small muted">The amounts must add up to {excessText}. A blank box counts as 0.</p>
      {rows.map(r => (
        <label key={r.id}>{r.label}
          <input type="number" inputMode="numeric" min={0} max={r.max} step={1} name={`cut-${r.id}`} value={vals[r.id] ?? ""} onChange={e => { setVals({ ...vals, [r.id]: e.target.value }); setChoice("split"); }} /></label>
      ))}
      <p className="small" aria-live="polite" role="status">{leftToPlace(excess, amounts, unit)}</p>
    </fieldset>}
  </>;
}
