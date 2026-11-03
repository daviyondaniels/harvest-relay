import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmPlan } from "../src/commitments.ts";
import { INJECTION, LATE, RECORDED, SEED, canReceiveInjection, deliverInjection, injectionRefusal, lateMessage, lateText, seedWorkbench } from "../src/seed.ts";
import { dismiss, preview, previewHand, receive, suggestReading, type Workbench } from "../src/workbench.ts";
import { numberSpan } from "../app/lib/quote.ts";
import { PITCH } from "../app/lib/pitch.ts";
import { dismissable, overview, rowAction } from "../app/lib/view.ts";
import { dayRecord } from "../app/lib/record.ts";

// Task 29: the demo story and its numbers.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readings = () => JSON.parse(source("data/seed-readings.json"));
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z", ME = "A Name";
const withLot = (w: Workbench, lb: number): Workbench => { const c = structuredClone(w); c.ledger.snapshot.lots.find(l => l.id === "lot-b")!.quantity.amount = lb; return c; };

test("the late message is built from Birch Hollow's tomato lot: 110 lb reads 100, 80 lb reads 70", async () => {
  const w = await seedWorkbench(readings(), NOW);
  assert.equal(lateMessage(w).source.text, "Tomatoes came in light. We'll only have 70 lb of standard for Friday, not 80.");
  assert.equal(lateMessage(withLot(w, 110)).source.text, "Tomatoes came in light. We'll only have 100 lb of standard for Friday, not 110.");
  assert.equal(lateMessage(w).source.id, LATE.source.id, "the id is kept");
  assert.equal(LATE.source.text, lateMessage(w).source.text, "LATE is the starting-hub text");
});

test("the late message edge: a lot of 10 lb or less reads 0 (the floor), never a negative amount", async () => {
  assert.equal(lateText(15), "Tomatoes came in light. We'll only have 5 lb of standard for Friday, not 15.");
  assert.equal(lateText(10), "Tomatoes came in light. We'll only have 0 lb of standard for Friday, not 10.");
  assert.equal(lateText(4), "Tomatoes came in light. We'll only have 0 lb of standard for Friday, not 4.");
  assert.equal(lateText(20), "Tomatoes came in light. We'll only have 10 lb of standard for Friday, not 20.");
});

test("the suggested reading, quote and preview follow the lot (110 lb path)", async () => {
  let w = withLot(await seedWorkbench(readings(), NOW), 110);
  w = receive(confirmPlan(w, ME, NOW, { shipShort: true }), lateMessage(w).source, LATER);
  const id = w.items.at(-1)!.id, g = suggestReading(w, id);
  assert.equal(g.quantity!.amount, 100, "the guess is the new amount, not the old one");
  const quote = numberSpan(w.items.at(-1)!.source.text, "100");
  assert.match(quote!, /100 lb/);
  const p = previewHand(w, id, { operation: g.operation!, lotId: g.lotId!, quantity: g.quantity!, grade: g.grade!, deliveryOn: g.deliveryOn!, quote }, LATER)!;
  assert.deepEqual(p.change && [p.change.before, p.change.after].map(q => (q as { amount: number }).amount), [110, 100], "110 lb to 100 lb");
});

test("no recorded reading exists for the late message, so none with stale numbers is replayed", () => {
  for (const f of ["data/seed-readings.json", "data/demo-extras.json"]) assert.ok(!source(f).includes("msg-late-tomato"), f);
});

test("the rule-changing message is not in the morning inbox; Demo tools deliver it once, read from its recording", async () => {
  assert.ok(!SEED.some(m => m.source.id === "msg-injection"));
  assert.ok(RECORDED.includes(INJECTION));
  const seeded = await seedWorkbench(readings(), NOW);
  assert.equal(seeded.items.length, 4);
  assert.equal(canReceiveInjection(seeded), true, "it works any time, before any confirm");
  const w = await deliverInjection(seeded, readings(), LATER);
  const it = w.items.at(-1)!;
  assert.equal(it.source.id, "msg-injection");
  assert.equal(it.receivedAt, LATER, "stamped at the moment of delivery");
  assert.ok(it.proposal, "read from its recording");
  assert.equal(injectionRefusal(w), "That message has already arrived");
  await assert.rejects(() => deliverInjection(w, readings(), LATER), /already arrived/);
  assert.equal((await deliverInjection(confirmPlan(seeded, ME, NOW, { shipShort: true }), readings(), LATER)).items.length, 5, "also after a confirm");
});

test("a delivered rule-changing message is refused on its own: Dismiss offered, supply unchanged", async () => {
  const seeded = await seedWorkbench(readings(), NOW), w = await deliverInjection(seeded, readings(), LATER), it = w.items.at(-1)!;
  assert.equal(dismissable(it), true);
  assert.equal(rowAction(w, it, overview(w).previews), "dismiss");
  assert.equal(preview(w, it.id).change, undefined, "it proposes no supply change");
  const done = dismiss(w, it.id, "Not a harvest update", ME, LATER);
  assert.equal(done.items.at(-1)!.state, "dismissed");
  assert.deepEqual(done.ledger.snapshot.lots, seeded.ledger.snapshot.lots, "no supply change");
  assert.equal(done.ledger.events.length, 0);
});

test("the Demo tools offer the message with its label on Pack and Review, and the action is wired", () => {
  const label = "A message that tries to change the rules (demo)";
  for (const f of ["app/pack/page.tsx", "app/review/page.tsx"]) { const s = source(f); assert.ok(s.includes(label), f); assert.match(s, /injectionMessageAction/); assert.match(s, /on="injection"/); }
  assert.match(source("app/actions.ts"), /export async function injectionMessageAction/);
  assert.match(source("app/named-submit.tsx"), /\^injection/, "its missing-name purpose is worded");
});

test("the pitch line is on the Overview, in the page description, and first in the README", () => {
  assert.equal(PITCH, "Grower changes arrive as messages. Each one is read, checked against this week's orders, and nothing changes until you approve.");
  assert.match(source("app/page.tsx"), /<p className="pitch">\{PITCH\}<\/p>/);
  assert.match(source("app/layout.tsx"), /description: PITCH/);
  assert.equal(source("README.md").split("\n").find(l => l.trim() && !l.startsWith("#")), PITCH);
  assert.match(source("app/globals.css"), /\.hero \.pitch \{[^}]*font-size: 1rem; color: var\(--ink\);/, "16 px, body colour");
});

test("the first-message timing is not on the page; the export keeps it, labelled as demo timing", async () => {
  const page = source("app/page.tsx");
  assert.doesNotMatch(page, /First message|minutesToBuyerNotice|Messages to buyers/);
  assert.doesNotMatch(source("app/lib/view.ts"), /firstMessageLine/);
  const w = await seedWorkbench(readings(), NOW), rec = dayRecord(w, 1, NOW);
  assert.ok("minutesToBuyerNotice" in rec.measures);
  assert.match(rec.measuresNote, /demo timing/);
  assert.ok(page.includes("Shipped short, buyer not told") && !page.includes("Orders sent short"));
  assert.match(page, /of ordered weight covered by the plan today/);
});
