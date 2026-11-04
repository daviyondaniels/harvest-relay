import type { Metadata } from "next";
import { demoProgress } from "../../src/demo-guide.ts";
import { current, recording } from "../lib/hub.ts";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Demo guide" };
export default async function Guide() {
  const { state: w } = await current(), rec = recording();
  const item = (id: string) => w.items.find(i => i.source.id === id), approved = (id: string) => item(id)?.state === "approved";
  const link = (id: string) => item(id) ? `/review?item=${encodeURIComponent(item(id)!.id)}` : "/review";
  const late = item("msg-late-tomato"), progress = demoProgress(w);
  const steps = [
    { title: "Read the reduction and its buyer impact", done: progress.reduction, href: link("msg-tomato"), action: "Review the tomato update", detail: "Compare the original message with the reading: 60 lb replaces 120 lb. Check which buyer becomes short, then approve under your own name. Approval changes supply; reading alone does not." },
    { title: "Clarify cases before counting them", done: progress.cases, href: link(approved("msg-zucchini") ? "msg-cucumber" : "msg-zucchini"), action: "Review the case quantities", detail: "Open the missing details and record a question. Receive the grower's demo reply, check its words and case contents, then approve. Do this for zucchini and cucumbers; do not infer a case size." },
    { title: "Resolve Riverbend's shortage with recorded consent", done: progress.covered, href: "/orders?order=order-b", action: "Open Riverbend's order", detail: "Use the proposed next step to request supply or offer a substitute. Messages are recorded only. For a substitute, record the buyer's explicit answer before it can enter the plan. You may instead record a shortage notice; that leaves a real shortfall visible." },
    { title: "Confirm a plan you can explain", done: progress.confirmed, href: "/pack", action: "Check and confirm the plan", detail: "Read unresolved shortages and unsettled updates. Confirm the plan to create promises. Shipping short requires a separate explicit decision. Print sheets or export the day record; confirmation is not delivery." },
    { title: "Test a late change before packing", done: progress.late, href: late ? link("msg-late-tomato") : "/pack", action: late ? "Review the late message" : "Open packing demo tools", detail: "Before marking orders packed, open Demo tools on Pack and receive the late grower message. Read and approve it by hand if no recording is available. Decide who takes the cut, check changed sheets and confirm again. Affected orders cannot be packed on the stale plan." }
  ];
  return <>
    <section className="panel" aria-labelledby="guide-title"><p className="eyebrow">A coordinator's review loop</p><h1 id="guide-title">Try a harvest change from message to packing</h1>
      <p>Harvest Relay turns uncertain grower messages into reviewable changes. Muse Spark proposes a reading; evidence checks, allocation rules and your decisions determine what reaches the plan.</p>
      <p className="muted">Synthetic data. No messages are delivered. Reviewer names label decisions and do not authenticate people.</p>
      <p><a className="button primary" href={steps.find(s => !s.done)?.href ?? "/pack"}>Continue the walkthrough</a> <a href="/">Open overview</a></p>
    </section>
    <section className="panel" aria-labelledby="steps-title"><h2 id="steps-title">Your workspace progress</h2><p>{steps.filter(s => s.done).length} of {steps.length} checkpoints currently satisfied. You can choose a different resolution; progress reflects the current state.</p>
      <ol className="guide-steps">{steps.map(s => <li key={s.title}><h3>{s.title} <span className={`chip ${s.done ? "done" : "quiet"}`}>{s.done ? "Satisfied" : "To check"}</span></h3><p>{s.detail}</p><a href={s.href}>{s.action}</a></li>)}</ol>
    </section>
    <section className="panel"><h2>What is running here?</h2>
      {rec ? <p>Initial readings replay stored responses from <b>{rec.model}</b>, prompt {rec.promptVersion}, recorded {rec.recordedAt.slice(0, 10)}. Replays run through the same parsing and evidence checks. This does not demonstrate live inference latency or new-case accuracy.</p> : <p>No initial model recording is installed. Read messages by hand; do not treat that as an automatic model reading.</p>}
      <p>The allocation planner is deterministic. It honors dates, grades, units, substitute permission and recorded promises. Forecasts are kept separate from confirmed supply. Readings, approvals and buyer answers remain in the history and day export.</p>
      <p>Optional: <a href="/orders?order=order-a">adjust an order quantity</a> and preview the effects before confirming. This adds an audit record and can require plan reconfirmation.</p>
      <p><a href="/export">Export my day record</a>. Use the menu to reset this demo's decisions.</p>
    </section>
  </>;
}
