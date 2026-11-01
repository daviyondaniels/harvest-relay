"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Problem, invalid, type Bad } from "./lib/field-error.tsx";
import { NAME_MAX } from "./lib/names.ts";

// The coordinator's name is asked on the first action that records it, in the same form, so
// there is no separate Save: typing it and pressing Enter or the button does both. With a name
// saved (known) nothing extra is shown. A refused name is explained beside its own field, which
// is named by the form (on) like any other field, so the page can move focus there.
type Named = { known: boolean; on?: string; bad?: Bad };
export function NameField({ known, on = "named", bad }: Named) {
  if (known) return null;
  return <>
    <label className="named">Your name
      <input name="who" required maxLength={NAME_MAX} autoComplete="name" {...invalid(bad, on, "who")} />
    </label>
    <Problem bad={bad} on={on} name="who" />
  </>;
}
// A submit button for a form that records a name. A form with several buttons shows NameField once.
export function NamedSubmit({ label, className, known, on, bad, ...button }: Named & { label: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">) {
  return <>
    <NameField known={known} on={on} bad={bad} />
    <button type="submit" className={className} {...button}>{label}</button>
  </>;
}
