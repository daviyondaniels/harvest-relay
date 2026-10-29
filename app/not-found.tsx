import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

// Shown for any unknown address, and for a recorded change that no longer exists (after
// Reset demo, old event links lead here), with a way back to the work.
export default function NotFound() {
  return (
    <section className="panel call" aria-labelledby="missing">
      <h1 id="missing">Page not found</h1>
      <p>This page doesn't exist, or it was cleared when the demo was reset.</p>
      <p><a className="button primary" href="/">Back to Overview</a></p>
    </section>
  );
}
