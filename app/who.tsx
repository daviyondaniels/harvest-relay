"use client";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { setNameAction, type NameState } from "./actions.ts";
import { useDismiss } from "./dismiss.ts";
import { NAME_MAX } from "./lib/names.ts";
import { ASK_NAME } from "./name-event.ts";

// Who is recording, said once in the header. "not you?" opens a field for another name. With
// With no remembered name it says "Name not set", with a small "set name" toggle: the name
// is asked on the first action that records it (named-submit.tsx), so the header never demands
// one. Only the name is cut short on a narrow screen, never the toggle. The server checks the
// name by the same rules as any typed name, and a problem is shown beside the field and
// announced. The menu's "Change name" opens this field (name-event.ts).
export function Who({ name }: { name?: string }) {
  const [state, act, pending] = useActionState<NameState, FormData>(setNameAction, {});
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(0);
  const area = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), field = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, area, button);
  useEffect(() => {
    const ask = () => { setAsked(n => n + 1); setOpen(true); };
    window.addEventListener(ASK_NAME, ask);
    return () => window.removeEventListener(ASK_NAME, ask);
  }, []);
  // A saved name closes the field and returns focus to the line that now names them.
  useEffect(() => { if (state.saved) { setOpen(false); button.current?.focus(); } }, [state.saved, name]);
  // A problem keeps the field open; opening or asking puts the cursor in it.
  useEffect(() => { if (state.error) { setOpen(true); field.current?.focus(); } }, [state]);
  useEffect(() => { if (open) field.current?.focus(); }, [open, asked]);
  const error = state.error;
  return (
    <div className="who" ref={area}>
      <p className="who-line">
        {name ? <><span>Recording as</span><b className="who-name" title={name}>{name}</b><span aria-hidden="true">·</span></> : <span>Name not set</span>}
        <button type="button" className="link" ref={button} aria-expanded={open} aria-controls="who-form" onClick={() => setOpen(o => !o)}>{name ? "not you?" : "set name"}</button>
      </p>
      <form id="who-form" className="who-form" noValidate action={act} hidden={!open}>
        <label><span className="who-label">{name ? "Your name instead" : "Your name"}</span>
          <input name="who" required maxLength={NAME_MAX} autoComplete="name" ref={field}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "who-error" : undefined} /></label>
        <button type="submit" className="primary" disabled={pending}>Save</button>
        {error && <p id="who-error" className="field-error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
