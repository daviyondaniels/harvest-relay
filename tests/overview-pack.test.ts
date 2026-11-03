import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedWorkbench } from "../src/seed.ts";
import { BUYERS } from "../src/demo.ts";
import { BY_HAND, approve, preview, type InboxItem } from "../src/workbench.ts";
import { confirmPlan, conflicts } from "../src/commitments.ts";
import { INSTRUCTION_LABEL, LEAVE_PROMPT, STALE_HEADING, becomesShort, byAttention, cutReason, instructionLike, leavesShort, overview, readyToApprove, staleSentence, staleSinceConfirm, updateKind } from "../app/lib/view.ts";

// Task 13: Overview and Pack, hierarchy and the stale plan.
const readings = () => JSON.parse(readFileSync(new URL("../data/seed-readings.json", import.meta.url), "utf8"));
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const seed = () => seedWorkbench(readings(), NOW);
const by = (w: Awaited<ReturnType<typeof seed>>, id: string) => w.items.find(i => i.source.id === id)!;
const buyerOf = (w: Awaited<ReturnType<typeof seed>>) => (orderId: string) => BUYERS[w.ledger.snapshot.orders.find(o => o.id === orderId)!.buyerId];

test("no Confirm trap: against the seed the waiting tomato update would leave a buyer short, so Confirm is not offered", async () => {
  const w = await seed(), { previews } = overview(w), leaves = leavesShort(w, previews);
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].item.source.id, "msg-tomato");
  assert.equal(buyerOf(w)(leaves[0].order.orderId), "Riverbend School Kitchen");
  assert.equal(leaves[0].order.after.short, 60);
  // The domain gate itself is unchanged: it still lets the plan be confirmed.
  assert.doesNotThrow(() => confirmPlan(w, "A Name", NOW, { shipShort: true }));
  // Once the update is dealt with, nothing waits that leaves a buyer short.
  const done = approve(w, by(w, "msg-tomato").id, "A Name", preview(w, by(w, "msg-tomato").id).reviewHash!, NOW);
  assert.equal(leavesShort(done, overview(done).previews).length, 0);
});

test("one-tap Approve only when no buyer is left short; the forecast update stays one-tap", async () => {
  const w = await seed(), { previews } = overview(w), ok = (id: string) => { const i = by(w, id), p = previews.get(i.id)!; return readyToApprove(i, p) && becomesShort(p).length === 0; };
  assert.equal(ok("msg-tomato"), false, "ready, but it leaves Riverbend short: Review it");
  assert.equal(ok("msg-forecast"), true);
  const page = source("app/page.tsx");
  assert.match(page, /LEAVE_PROMPT/);
  assert.equal(LEAVE_PROMPT, "Review it before confirming.");
});

test("rows are ordered cut, short, not checked yet, ready, answers, dismiss; a late unread message sits above routine approvals", async () => {
  const rows = ["dismiss", "asks", "ready", "unchecked", "short", "cut", "ready"].map((kind, n) => ({ kind: kind as "cut", n }));
  assert.deepEqual(byAttention(rows).map(r => `${r.kind}${r.n}`), ["cut5", "short4", "unchecked3", "ready2", "ready6", "asks1", "dismiss0"]);
  const w = await seed(), t = by(w, "msg-tomato"), kind = (i: InboxItem) => updateKind(i, preview(w, i.id));
  assert.equal(kind({ ...t, proposal: undefined }), "unchecked", "unread");
  assert.equal(kind({ ...t, interpretedBy: BY_HAND }), "unchecked", "read by hand");
  assert.equal(kind(t), "ready");
  assert.equal(kind({ ...by(w, "msg-injection"), interpretedBy: BY_HAND }), "dismiss", "a junk message is still dismissable");
});

test("the stale confirmed card leads with the same sentence as Pack, naming who changed", async () => {
  let w = await seed();
  w = confirmPlan(w, "A Name", NOW, { shipShort: true });
  assert.equal(staleSinceConfirm(w), false);
  w = approve(w, by(w, "msg-tomato").id, "A Name", preview(w, by(w, "msg-tomato").id).reviewHash!, LATER);
  assert.equal(staleSinceConfirm(w), true);
  assert.equal(staleSinceConfirm(await seed()), false, "no plan, nothing stale");
  assert.match(staleSentence(w), /^The plan has changed since you confirmed it\./);
  assert.match(staleSentence(w), /Confirm again to promise the new amounts\.$/);
  assert.match(staleSentence(w), /Sheets printed from the plan confirmed at .* are wrong for: .*Northside Grocery Co-op/, "names who changed");
  const page = source("app/page.tsx"), pack = source("app/pack/page.tsx");
  for (const src of [page, pack]) assert.match(src, /staleSentence\(w/);
  assert.match(page, /STALE_HEADING/);
  assert.equal(STALE_HEADING, "Printed sheets are out of date");
  assert.match(page, /stale && canConfirm && <form action=\{confirmAction\}>[\s\S]*?className="primary"/, "Confirm again is the primary button when stale");
  assert.match(page, /className=\{stale \|\| fresh\.length > 0 \? undefined : "primary"\}/, "Mark all is secondary when stale or a message is unchecked");
  assert.match(pack, /\{stale && confirmForm\}/, "Pack offers Confirm again only when stale");
  assert.match(pack, /<PrintButton primary=\{!stale && arrived === 0\} outOfDate=\{stale\} \/>/);
});

test("the instruction-like message is labelled by the reading plus a word test; a real update with a question is not", async () => {
  const w = await seed();
  assert.equal(INSTRUCTION_LABEL, "Looks like an instruction, not a harvest update");
  assert.equal(instructionLike(by(w, "msg-injection")), true);
  for (const id of ["msg-tomato", "msg-zucchini", "msg-cucumber", "msg-forecast"]) assert.equal(instructionLike(by(w, id)), false, id);
  assert.match(source("app/page.tsx"), /instructionLike\(i\)/);
  assert.match(source("app/review/page.tsx"), /instructionLike\(i\) &&/);
});

test("Riverbend becomes short before the confirm and Northside after: promises are kept, and the preview says why", async () => {
  const w = await seed(), t = by(w, "msg-tomato"), shortNames = (x: typeof w) => becomesShort(preview(x, t.id)).map(o => buyerOf(x)(o.orderId));
  // Before the confirm nothing is promised: the cut falls by priority, on the lower-priority order (Riverbend).
  assert.deepEqual(shortNames(w), ["Riverbend School Kitchen"]);
  assert.equal(cutReason(w, preview(w, t.id), buyerOf(w)), undefined, "no promise explains it, so nothing is claimed");
  // After the confirm each order keeps what it was promised from each lot. The dropped lot is Northside's, so it takes the cut.
  const c = confirmPlan(w, "A Name", NOW, { shipShort: true });
  assert.deepEqual(shortNames(c), ["Northside Grocery Co-op"]);
  const why = cutReason(c, preview(c, t.id), buyerOf(c));
  assert.match(why!, /^Northside Grocery Co-op's order was confirmed against this lot, so it takes the cut first/);
  assert.match(why!, /move the cut to another buyer/);
  // And it is true: approving opens a cut to settle, so the coordinator can still choose who takes it.
  const done = approve(c, t.id, "A Name", preview(c, t.id).reviewHash!, LATER);
  assert.equal(conflicts(done.ledger).length, 1);
  assert.match(source("app/page.tsx"), /cutReason\(/);
  assert.match(source("app/review/page.tsx"), /cutReason\(/);
});

test("Pack: sheets have a column header row and print with top padding; the demo tools sit in one closed fold on both pages", () => {
  const pack = source("app/pack/page.tsx"), review = source("app/review/page.tsx"), css = source("app/globals.css");
  assert.match(pack, /<thead className="sheet-cols">/);
  assert.match(css, /\.sheet \{ display: block; margin: 0; padding-top: 12mm;/);
  for (const page of [pack, review]) assert.match(page, /<details className="demo-tools[^"]*"[^>]*>\s*<summary>Demo tools<\/summary>/);
  assert.ok(pack.indexOf("Late grower message (demo)") > pack.indexOf("<summary>Demo tools</summary>"), "the late message is only inside the fold");
});
