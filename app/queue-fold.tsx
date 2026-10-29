"use client";
import { useEffect, useState, type ReactNode } from "react";

// A workspace list (review messages, buyer orders). On a phone it folds to "N messages" or
// "N orders" below the selected item, so the work comes first; from 761 px it is always open
// beside it.
const WIDE = "(min-width: 761px)";
export function QueueFold({ count, noun, open: initial, children }: { count: number; noun: string; open: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    if (wide.matches) setOpen(true);
    // Folds again when the window narrows (a tablet turned back to portrait).
    const change = (e: MediaQueryListEvent) => setOpen(e.matches);
    wide.addEventListener("change", change);
    return () => wide.removeEventListener("change", change);
  }, []);
  return (
    <details className="queue-fold" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>{`${count} ${noun}`}</summary>
      <div className="queue-list">{children}</div>
    </details>
  );
}
