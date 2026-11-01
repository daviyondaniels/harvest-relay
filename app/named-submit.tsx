"use client";
import { useSearchParams } from "next/navigation";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { Problem, invalid, type Bad } from "./lib/field-error.tsx";
import { NAME_MAX } from "./lib/names.ts";
import { keptWho } from "./lib/kept.ts";

// The coordinator's name is asked on the first action that records it, in the same form, so
// there is no separate Save: typing it and pressing Enter or the button does both. With a name
// saved (known) nothing extra is shown. A refused name is explained beside its own field, which
// is named by the form (on) like any other field, so the page can move focus there.
// The visible label is "Your name"; a screen reader also hears what it is for ("Your name, for
// this approval"), taken from the form (on) unless the caller says (purpose). That is the input's own
// accessible name (aria-label), one string, so no stray space comes between the name and the comma.
// A name typed into a refused form comes back as its starting text (the kept value, lib/kept.ts).
// quiet: a secondary form on a page with a primary one shows no name field of its own. It uses
// the remembered name; with none, it is refused and the field then appears beside it.
type Named = { known: boolean; on?: string; bad?: Bad; purpose?: string; quiet?: boolean };
const PURPOSE: [RegExp, string][] = [
  [/approve|note-forecast/, "this approval"], [/^lock/, "confirming today's plan"], [/^stage/, "this packing step"], [/^call/, "logging this call"], [/^cut-/, "settling this cut"],
  [/hold|dismiss/, "this decision"], [/reply|buyer/, "recording this reply"], [/^ask/, "recording this question"], [/^correct/, "this correction"],
  [/^hand/, "this reading"], [/refresh/, "checking this again"], [/send|draft|confirm|edit|discard|redraft/, "this message"], [/^late|^script/, "this demo step"]
];
const purposeOf = (on: string) => PURPOSE.find(([re]) => re.test(on))?.[1] ?? "this change";
export function NameField({ known, on = "named", bad, purpose, quiet }: Named) {
  const kept = keptWho(useSearchParams(), on);
  if (known) return null;
  const refused = bad?.on === on && bad.field === "who";
  if (quiet && !refused) return null;
  return <>
    <input type="hidden" name="who_on" value={on} />
    <label className="named"><span>Your name</span>
      <input name="who" aria-required="true" defaultValue={kept} aria-label={`Your name, for ${purpose ?? purposeOf(on)}`} maxLength={NAME_MAX} autoComplete="name" {...invalid(bad, on, "who")} />
    </label>
    <Problem bad={bad} on={on} name="who" />
  </>;
}
// A submit button for a form that records a name. A form with several buttons shows NameField once.
// blocked: the id of what to read first. The button then stays focusable (aria-disabled, not
// disabled) and pressing it does not submit but moves focus there.
export function NamedSubmit({ label, className, known, on, bad, purpose, quiet, blocked, ...button }: Named & { label: ReactNode; blocked?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">) {
  const stop = (e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); document.getElementById(blocked!)?.focus(); };
  return <>
    <NameField known={known} on={on} bad={bad} purpose={purpose} quiet={quiet} />
    <button type="submit" className={className} {...button} {...(blocked ? { "aria-disabled": true, onClick: stop } : {})}>{label}</button>
  </>;
}
