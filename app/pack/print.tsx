"use client";

// Prints the current sheets; the print styles in globals.css leave only the sheets on paper.
export function PrintButton() {
  return <button type="button" className="primary" onClick={() => window.print()}>Print sheets</button>;
}
