"use client";
import { useState } from "react";
import { leftToPlace, leftToPlaceSaid } from "./lib/cut.ts";

// The choice on the cut card: one buyer takes it all, or it is split. The split boxes sit in their own fieldset, tied to
// the Split radio: typing in a box selects Split, picking a buyer clears the boxes (so nothing typed is left beside a
// choice that would ignore it), and a line says how much of the total is still to place; a screen reader hears it only
// once all is placed or it overshoots, not on every digit. A blank box counts as 0.
// While a buyer is chosen the split fieldset is hidden by CSS (globals.css), which keeps Settle near the heading and works without script.
// The server still refuses amounts posted with any other choice. Everything here also works as a plain form without script.
type Radio = { id: string; label: string };
type Row = { id: string; label: string; max: number; initial: string };
export function CutChoice({ on, excess, excessText, unit, radios, split, splitLabel, rows, initial }: {
  on: string; excess: number; excessText: string; unit: "g" | "lb" | "each"; radios: Radio[]; split: boolean; splitLabel: string; rows: Row[]; initial?: string;
}) {
  const [choice, setChoice] = useState(initial), [vals, setVals] = useState(() => Object.fromEntries(rows.map(r => [r.id, r.initial])));
  // Amounts set aside when a buyer is picked, so picking Split again brings them back.
  const [aside, setAside] = useState<Record<string, string> | undefined>();
  const blank = Object.fromEntries(rows.map(x => [x.id, ""])), typedAny = Object.values(vals).some(v => v !== "");
  const amounts = rows.map(r => vals[r.id] ?? ""), line = leftToPlace(excess, amounts, unit);
  return <>
    {radios.map(r => (
      <label key={r.id} className="check"><input type="radio" name="choice" value={r.id} checked={choice === r.id} onChange={() => { setChoice(r.id); if (typedAny) setAside(vals); setVals(blank); }} /><span>{r.label}</span></label>
    ))}
    {split && <label className="check"><input type="radio" name="choice" value="split" checked={choice === "split"} onChange={() => { setChoice("split"); if (aside && !typedAny) setVals(aside); }} /><span>{splitLabel}</span></label>}
    {split && <fieldset className="split" aria-describedby={`${on}-total`}>
      <legend>Pounds each buyer gets less</legend>
      <p id={`${on}-total`} className="small muted">The amounts must add up to {excessText}. A blank box counts as 0.</p>
      {rows.map(r => (
        <label key={r.id}>{r.label}
          <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" name={`cut-${r.id}`} value={vals[r.id] ?? ""} onChange={e => { setVals({ ...vals, [r.id]: e.target.value }); setChoice("split"); }} /></label>
      ))}
      <p className="small">{line}</p>
      <p className="sr-only" role="status">{leftToPlaceSaid(line)}</p>
    </fieldset>}
    {split && choice !== "split" && aside && <p className="small muted">The amounts are set aside. Choose Split it to bring them back.</p>}
  </>;
}
