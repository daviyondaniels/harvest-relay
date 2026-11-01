"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { splitDescribed } from "./lib/described.ts";

// A field marked invalid stops being marked as soon as the coordinator edits it: the mark and the message
// beside it go, so a message never sits above a field that has been fixed or emptied. The next press of the
// button checks it again on the server. Attributes are removed and the message is hidden (never removed from
// the page), so the page's own rendering is not disturbed.
//
// React does not know about these changes. If the server refuses the same field again, React can keep the very
// same nodes and see no change in their props, so nothing would show the new refusal. Every refusal arrives
// with a new signed notice (the "sig" in the URL); when it changes, what was hidden is shown again if the new
// page still renders that field's message (a node that is still in the page was rendered by the new refusal).

type Cleared = { field: HTMLElement; note: HTMLElement | null; described: string };

export function ClearErrors() {
  const sig = useSearchParams().get("sig");
  const cleared = useRef<Cleared[]>([]);
  const last = useRef(sig);
  useEffect(() => {
    if (last.current === sig) return;
    last.current = sig;
    for (const c of cleared.current) {
      if (!c.field.isConnected || !c.note?.isConnected) continue;
      c.note.hidden = false; c.note.style.removeProperty("display");
      c.field.setAttribute("aria-invalid", "true");
      if (c.described) c.field.setAttribute("aria-describedby", c.described);
    }
    cleared.current = [];
  }, [sig]);
  useEffect(() => {
    const clear = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.getAttribute("aria-invalid") !== "true") return;
      const described = el.getAttribute("aria-describedby") ?? "", { errors, others } = splitDescribed(described);
      el.removeAttribute("aria-invalid");
      for (const id of errors) {
        const note = document.getElementById(id);
        if (note) { note.hidden = true; note.style.display = "none"; cleared.current.push({ field: el, note, described }); }
      }
      if (others.length) el.setAttribute("aria-describedby", others.join(" ")); else el.removeAttribute("aria-describedby");
    };
    document.addEventListener("input", clear); document.addEventListener("change", clear);
    return () => { document.removeEventListener("input", clear); document.removeEventListener("change", clear); };
  }, []);
  return null;
}
