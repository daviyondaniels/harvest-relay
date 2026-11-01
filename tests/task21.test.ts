import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedWorkbench } from "../src/seed.ts";
import { approve, preview } from "../src/workbench.ts";
import { confirmPlan, conflicts, lockGate, markAllStage } from "../src/commitments.ts";
import { shortages } from "../src/orders.ts";
import { CHECK_IT, CONFIRM_WITHOUT, OTHER_UNSETTLED, SETTLE_FIRST, SHIP_SHORT, leaveVisible, reallyShort, unsettledFor } from "../app/lib/view.ts";

// Task 21: Overview and Pack, comprehension.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z";
const seed = () => seedWorkbench(JSON.parse(source("data/seed-readings.json")), NOW);
const page = source("app/page.tsx"), pack = source("app/pack/page.tsx"), css = source("app/globals.css");

test("against the seed after a late drop, the checklist count is the orders the ledger finds short", async () => {
  const w = await seed(), t = w.items.find(i => i.source.id === "msg-tomato")!;
  const c = confirmPlan(w, "A Name", NOW, { shipShort: true });
  const d = approve(c, t.id, "A Name", preview(c, t.id).reviewHash!, LATER);
  assert.equal(conflicts(d.ledger).length, 1, "the drop opens a cut");
  const gaps = new Set(shortages(d.ledger).map(s => s.orderId)), { blocking } = lockGate(d);
  assert.deepEqual(reallyShort(blocking, gaps), blocking.filter(id => gaps.has(id)));
  assert.deepEqual(reallyShort(blocking, gaps).sort(), [...gaps].sort(), "every short order is counted and nothing else");
});

test("the checklist counts only buyers who are actually short", () => {
  assert.deepEqual(reallyShort(["a", "b", "c"], new Set(["b"])), ["b"]);
  assert.match(pack, /shortNow\.length \? `\$\{shortNow\.length\}/);
  assert.match(pack, /return !g \? \(\s*<li key=\{id\} className="warn">/, "a covered buyer on a cut lot is not a red cross with Resolve");
});

test("Pack names the update it confirms without, and one phrase is used for Ship short", () => {
  assert.equal(CONFIRM_WITHOUT("Alder Creek Farm"), "Confirm without Alder Creek Farm's update");
  assert.equal(CONFIRM_WITHOUT("Alder Creek Farm", "tomato", { amount: 120, unit: "lb" }, { amount: 60, unit: "lb" }), "Confirm without Alder Creek Farm's tomato update (120 lb → 60 lb)");
  assert.equal(SHIP_SHORT, "Ship these orders short");
  assert.match(pack, /CONFIRM_WITHOUT\(grower\(leave\.item\.source\.growerId\), leave\.product, leave\.before, leave\.after\)/);
  assert.match(pack, /needs “\{SHIP_SHORT\}”/);
});

test("the not-settled line does not contradict the leave-a-buyer-short warning", async () => {
  const w = await seed();
  assert.match(unsettledFor(["a", "b"])!, /does not block confirming/);
  assert.equal(unsettledFor(["a", "b"], "a"), OTHER_UNSETTLED);
  assert.equal(OTHER_UNSETTLED, "Other grower updates are not settled. They don't change what is promised.");
  assert.equal(unsettledFor(["a"], "a"), undefined);
  assert.equal(leaveVisible(w), true, "before confirming");
});

test("the leave warning shows before confirming or while stale, never once everything is handed off", async () => {
  const fresh = await seed(), tomato = fresh.items.find(i => i.source.id === "msg-tomato")!;
  assert.equal(leaveVisible(confirmPlan(fresh, "A Name", NOW, { shipShort: true })), false, "confirmed and current");
  const w = approve(confirmPlan(fresh, "A Name", NOW, { shipShort: true }), tomato.id, "A Name", preview(fresh, tomato.id).reviewHash!, LATER);
  assert.equal(leaveVisible(w), true, "stale, not handed off");
  let done = confirmPlan(await seed(), "A Name", NOW, { shipShort: true });
  done = markAllStage(done, "packed", "A Name", LATER).next;
  done = markAllStage(done, "handed-off", "A Name", LATER).next;
  assert.equal(leaveVisible(done), false, "everything handed off");
  assert.match(page, /leaveVisible\(w\) \? leaves\[0\] : undefined/);
  assert.match(pack, /leaveVisible\(w\) \? leavesShort/);
});

test("the Overview stale box: the cut sentence, a Confirm again button, and Check it as the one primary", () => {
  assert.equal(SETTLE_FIRST, "Settle the cut first, then confirm again.");
  assert.match(page, /staleSentence\(w, settle > 0\)/);
  assert.match(page, /stale && !canConfirm && settle === 0 && <>[\s\S]*?<a className="button" href="\/pack">Confirm again on Pack<\/a>/, "a button, not text alone");
  assert.match(page, /let primaryTaken = fresh\.length > 0 && !!c;/, "no primary in the attention card while a message is unchecked");
  assert.match(page, /<a className="button primary" href=\{`\/review\?item=\$\{encodeURIComponent\(fresh\[0\]\.id\)\}`\}>\{CHECK_IT\(fresh\.length\)\}/);
  assert.match(page, /className=\{stale \|\| fresh\.length > 0 \? undefined : "primary"\}/, "Mark all packed is secondary while a message is unchecked");
  assert.equal(CHECK_IT(1), "Check it");
});

test("Mark all packed and handed off are on Pack above the sheets", () => {
  assert.match(pack, /stageAllAction/);
  assert.match(pack, /"Mark all packed" : "Mark all handed off"/);
});

test("Overview: the ready-to-confirm heading, one name field after a refusal, and plain Day details", () => {
  assert.match(page, /<h2 id="ready" tabIndex=\{-1\}>Ready to confirm<\/h2>/);
  assert.match(page, /if \(bad\?\.field === "who"\) return on !== bad\.on;/);
  assert.doesNotMatch(page, /quiet\(\)/);
  for (const t of ["Short orders found today", "Orders sent short", "firstMessageLine("]) assert.ok(page.includes(t), t);
  assert.doesNotMatch(page, /Measured in this demo session/);
  assert.match(css, /\.result \{[^}]*background: var\(--surface\); border: 1px solid var\(--forest\)/, "the result banner is visible");
});
