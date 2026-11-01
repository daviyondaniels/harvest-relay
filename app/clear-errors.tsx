"use client";
import { useEffect } from "react";

// A field marked invalid stops being marked as soon as the coordinator edits it: the mark and the message
// beside it go, so a message never sits above a field that has been fixed or emptied. The next press of the
// button checks it again on the server. Attributes are removed and the message is hidden (never removed from
// the page), so the page's own rendering is not disturbed.
export function ClearErrors() {
  useEffect(() => {
    const clear = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.getAttribute("aria-invalid") !== "true") return;
      el.removeAttribute("aria-invalid");
      for (const id of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(x => x.endsWith("-error"))) {
        const note = document.getElementById(id);
        if (note) { note.hidden = true; note.style.display = "none"; }
      }
      el.removeAttribute("aria-describedby");
    };
    document.addEventListener("input", clear); document.addEventListener("change", clear);
    return () => { document.removeEventListener("input", clear); document.removeEventListener("change", clear); };
  }, []);
  return null;
}
