"use client";
import { useEffect, useRef, useState } from "react";

// Prints the current sheets; the print styles in globals.css leave only the sheets on paper.
export function PrintButton({ primary = true }: { primary?: boolean }) {
  return primary
    ? <button type="button" className="primary" onClick={() => window.print()}>Print sheets</button>
    : <button type="button" onClick={() => window.print()}>Print sheets</button>;
}

// Opens the print dialog once when the page is reached from "Print sheets" on the Overview
// (/pack?print=1). It says so in a polite live region first, takes no focus, and drops the
// flag from the address so a reload does not print again.
export function AutoPrint() {
  const done = useRef(false), [said, setSaid] = useState("");
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    setSaid("Opening the print dialog for the sheets.");
    window.history.replaceState(null, "", window.location.pathname);
    const t = window.setTimeout(() => window.print(), 400);
    return () => { window.clearTimeout(t); };
  }, []);
  return <p className="sr-only no-print" role="status" aria-live="polite">{said}</p>;
}

// The pick lists for growers. On a phone they are folded shut under one line with the count; from 601 px they open
// by themselves, and they are always open on paper (the print styles also show them when this script has not run).
export function PickFold({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current, wide = window.matchMedia("(min-width: 601px)");
    if (!el) return;
    if (wide.matches) el.open = true;
    let was = false;
    const before = () => { was = el.open; el.open = true; }, after = () => { el.open = was; };
    window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  return <details ref={ref} className="pick-fold"><summary><h3>Pick lists for growers ({count})</h3></summary>{children}</details>;
}
