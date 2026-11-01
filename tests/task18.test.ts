import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedWorkbench } from "../src/seed.ts";
import { confirmPlan } from "../src/commitments.ts";
import { arrivedLead, confirmLead, duration, leaveSentence, openAllLabel, resolveHint, reviewCoverLink, waitingCover, LEAVE_PROMPT } from "../app/lib/view.ts";
import { keepTyped, readKept } from "../app/lib/kept.ts";

// Task 18: Overview, Pack and layout.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readings = () => JSON.parse(source("data/seed-readings.json"));
const NOW = "2026-10-28T14:00:00.000Z";
const css = source("app/globals.css"), page = source("app/page.tsx"), pack = source("app/pack/page.tsx");

test("Overview and Pack say the same thing about an update that would leave a buyer short; Pack keeps Confirm without it", () => {
  assert.equal(leaveSentence("Alder Creek Farm", "Riverbend School Kitchen", "60 lb"), "Alder Creek Farm's update would leave Riverbend School Kitchen 60 lb short.");
  assert.equal(LEAVE_PROMPT, "Review it before confirming.");
  for (const src of [page, pack]) assert.match(src, /leaveSentence\(/);
  assert.match(pack, /"Confirm without it"/);
  assert.doesNotMatch(page, /Confirm without it/, "the Overview shows the link only");
});

test("a cut open: the Overview's primary is Settle the cut, and Pack shows no second primary until it is settled", () => {
  assert.match(page, /Settle the cut<span className="sr-only"> on/);
  assert.match(page, /href=\{`\/orders#cut-\$\{x\.c\.lotId\}-head`\}/, "the link goes to the cut itself");
  assert.match(page, /Settle the cut first, then confirm again\./);
  assert.match(pack, /c && stale && cutOpen \? <p className="small">Settle the cut first, then confirm again\.<\/p>/);
});

test("the confirmed card leads with a message that arrived since, and the counts sit with the buttons", () => {
  assert.equal(arrivedLead(1), "1 grower message arrived since you confirmed. Check it before packing.");
  assert.equal(arrivedLead(2), "2 grower messages arrived since you confirmed. Check them before packing.");
  const card = page.slice(page.indexOf('aria-label="Plan confirmed"'));
  assert.ok(card.indexOf("arrivedLead(fresh.length)") < card.indexOf("STALE_HEADING"), "the lead comes first");
  assert.ok(card.indexOf('<div className="row">') < card.indexOf('className="counts"'), "the counts are inside the button row");
  assert.match(css, /\.clear \.row p\.counts \{ flex: 0 1 auto/);
});

test("after Tell the all-clear line no longer says nothing is short", () => {
  assert.equal(confirmLead(true, true), "Every short order has been told or settled. You can confirm today's plan.");
  assert.equal(confirmLead(true, false), "Every short order has been told or settled. You can confirm today's plan.");
  assert.equal(confirmLead(false, true), "Nothing is short. You can confirm today's plan.");
  assert.equal(confirmLead(false, false), "Everything is covered. Confirm today's plan");
});

test("update-count wording and the short row", () => {
  assert.equal(openAllLabel(1), "Open the 1 update");
  assert.equal(openAllLabel(3), "Open all 3 updates");
  assert.equal(waitingCover("Alder Creek Farm", 1), "Alder Creek Farm has an update waiting that may cover this.");
  assert.equal(waitingCover("Alder Creek Farm", 2), "Alder Creek Farm has 2 updates waiting that may cover this.");
  assert.equal(reviewCoverLink("Alder Creek Farm", 1), "Review Alder Creek Farm's update");
  assert.doesNotMatch(page, /<PendingCover/, "the grower and the review prompt are said once on the short row");
});

test("Resolve names what it will do, from the recommendation", async () => {
  const w = await seedWorkbench(readings(), NOW), order = w.ledger.snapshot.orders.find(o => o.id.includes("riverbend")) ?? w.ledger.snapshot.orders[0];
  const w2 = confirmPlan(w, "A Name", NOW, { shipShort: true });
  const hint = [w, w2].flatMap(x => x.ledger.snapshot.orders.map(o => resolveHint(x, o.id, "Buyer"))).find(Boolean);
  assert.ok(order);
  assert.match(String(hint), /^(ask .+ for \d+ lb|offer Buyer .+ for \d+ lb|tell Buyer the order is \d+ lb short|read .+ reply)$/);
});

test("the day details say it in plain words", () => {
  assert.equal(duration(106), "1 h 46 min");
  assert.equal(duration(45.4), "45 min");
  assert.equal(duration(120), "2 h");
  assert.match(page, /after the order went short/);
  assert.doesNotMatch(page, /Time to first message to the buyer/);
});

test("fine print is at least 14 px, except chips", () => {
  const small = [...css.matchAll(/font-size: ([\d.]+)rem/g)].map(m => Number(m[1]));
  assert.ok(small.every(n => n >= 0.875 || n === 0.8125 || n === 0.75), "only chips, tab labels and the Demo tag are smaller");
  for (const rule of [".who-line", ".small", "label", ".stat span", ".legend", "th"]) {
    const m = css.match(new RegExp(`^${rule.replace(".", "\\.")} \\{[^}]*font-size: ([\\d.]+)rem`, "m"));
    assert.ok(m && Number(m[1]) >= 0.875, rule);
  }
  assert.match(css, /\.chip \{[^}]*font-size: 0\.8125rem/);
});

test("the zoomed cut card wraps whole words and loses nested padding at 300 px and below", () => {
  assert.match(css, /label\.check > span \{[^}]*overflow-wrap: break-word/);
  assert.doesNotMatch(css, /label\.check > span \{[^}]*overflow-wrap: anywhere/);
  const narrow = css.slice(css.indexOf("@media (max-width: 300px) {\n  .card, .panel"));
  assert.match(narrow, /\.conflict \.split \{ margin-left: 0; \}/);
  assert.match(css, /\.conflict fieldset \{ min-width: 0; \}/);
});

test("targets are 44 px on a phone and the Orders Tell button wraps", () => {
  assert.match(css, /\.hero-sub a, \.needs \.open-all, \.attention \.more, \.locked a\.button \{[^}]*min-height: 44px/);
  assert.match(css, /\.option-card button[^{]*\{[^}]*white-space: normal; max-width: 100%/);
});

test("Pack: pick lists fold, print shows them with a header row, names stay whole", () => {
  assert.match(source("app/pack/print.tsx"), /Pick lists for growers \(\{count\}\)/);
  assert.match(css, /\.pick-fold:not\(\[open\]\)::details-content \{ content-visibility: visible/);
  assert.match(pack, /<table className="picks">\s*<thead className="sheet-cols">/);
  assert.match(css, /\.sheet td\.who \{ white-space: nowrap; \}/);
});

test("the ship-short tick keeps its state from the kept values", () => {
  const f = new FormData(); f.set("shipShort", "yes");
  assert.equal(readKept(keepTyped(f, "lock"), "lock", "shipShort"), "yes");
  assert.match(pack, /defaultChecked=\{kept\}/);
});
