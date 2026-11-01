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
