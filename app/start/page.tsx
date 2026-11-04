import type { Metadata } from "next";
import { loadDemoSession, publicDemo } from "../lib/demo-session.ts";
import { startDemoAction } from "./actions.ts";

export const metadata: Metadata = { title: "Try the demo" };
export const dynamic = "force-dynamic";
export default async function Start({ searchParams }: { searchParams: Promise<{ busy?: string }> }) {
  const { busy } = await searchParams, enabled = publicDemo(), existing = enabled && await loadDemoSession();
  return <section className="card welcome" aria-labelledby="welcome">
    <p className="eyebrow">Harvest Relay · interactive demo</p>
    <h1 id="welcome">A grower's harvest changed. Which buyers are affected?</h1>
    <p>Read the grower's words, resolve missing details, and approve a plan you can explain. Your decisions stay in your own demo workspace.</p>
    <ul><li>Synthetic growers and buyers; no customer records needed.</li><li>Recorded Muse Spark interpretations, with human approval before supply changes.</li><li>No messages are delivered and no paid model calls run in this public demo.</li></ul>
    <p className="muted">Your workspace expires after 12 hours. Keep the day record if you want to save your decisions. A reviewer name is a label, not a sign-in.</p>
    {busy === "1" && <p className="error" role="alert">We could not start a workspace. The demo may be busy; please try again later.</p>}
    {enabled ? <div className="row">{existing && <a className="button" href="/">Resume my demo</a>}<form action={startDemoAction}><button className="primary">{existing ? "Start another demo" : "Start my demo"}</button></form></div> : <a className="button primary" href="/">Open the coordinator workspace</a>}
  </section>;
}
