"use client";
import { useEffect, useState } from "react";

// After an action, the page comes back with its result or the problem. This moves focus to
// where the coordinator continues: the heading of the result (rendered with tabIndex -1), or
// the field with the problem. A result is also said in a polite live region, filled just
// after it mounts so screen readers announce it. Pages render it keyed by the notice's
// signature, so each action mounts it afresh. Focus follows any #fragment scroll, so the
// fragment and the focused heading agree.
// plain: the words are said to a screen reader but not shown here, because the page shows them once, beside the control they are about.
export function Result({ text, focus, plain }: { text?: string; focus?: string; plain?: boolean }) {
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (focus) document.getElementById(focus)?.focus();
    const t = window.setTimeout(() => setSaid(text ?? ""), 150);
    return () => window.clearTimeout(t);
  }, [text, focus]);
  return <p className={text && !plain ? "result" : "sr-only"} role="status" aria-live="polite">{said}</p>;
}
