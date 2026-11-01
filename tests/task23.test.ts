import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLedger } from "../src/updates.ts";
import { scenario } from "../evaluation/scenario.ts";
import { seedWorkbench } from "../src/seed.ts";
import { approve, createWorkbench, preview, receive, suggestReading } from "../src/workbench.ts";
import { confirmPlan, markAllStage } from "../src/commitments.ts";
import { CONTACTS } from "../src/demo.ts";
import { logCall, recordBuyerReply, sendMessage } from "../src/resolve.ts";
import { ME as SME, T as ST, morning, notice, pick, start, zucchini } from "./story.ts";
import { CONFIRM_WITHOUT, dayDone, leaveVisible, leavesShort, overview, rowShorts, substituteLine } from "../app/lib/view.ts";
import { answerLine, sentLine } from "../app/lib/result.ts";
import { manyMissing, stillNeeded } from "../app/lib/errors.ts";
import { needsName } from "../app/lib/names.ts";
import { APPLY_THEN, moveLine } from "../app/lib/format.ts";

// Task 23: cleanup of the round 6 minors.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z";
const seed = () => seedWorkbench(JSON.parse(source("data/seed-readings.json")), NOW);
const review = source("app/review/page.tsx"), orders = source("app/orders/page.tsx"), actions = source("app/actions.ts"), page = source("app/page.tsx"), pack = source("app/pack/page.tsx");

test("a logged call that says 'bring 10 more lb of tomato' is read as an addition with its lot and amount", () => {
  let w = createWorkbench(createLedger(scenario()));
  w = logCall(w, "grower-a", "Called Alder, they can bring 10 more lb of tomato Friday.", SME, ST(1));
  const g = suggestReading(w, w.items[0].id);
  assert.equal(g.operation, "add-quantity");
  assert.equal(g.lotId, "lot-a");
  assert.deepEqual(g.quantity, { amount: 10, unit: "lb" });
  // The plain forms still read as before.
  const plain = logCall(createWorkbench(createLedger(scenario())), "grower-a", "We can add 10 lb of tomato.", SME, ST(1));
  assert.deepEqual(suggestReading(plain, plain.items[0].id).quantity, { amount: 10, unit: "lb" });
  // Only an addition word may sit there: "10 big lb" is not a quantity.
  const odd = logCall(createWorkbench(createLedger(scenario())), "grower-a", "10 big lb of tomato", SME, ST(1));
  assert.equal(suggestReading(odd, odd.items[0].id).quantity, undefined);
});

test("leave-short row after hand-off: the update still waits and still previews as leaving a buyer short, so the row itself must stop saying it", async () => {
  const fresh = await seed(), tomato = fresh.items.find(i => i.source.id === "msg-tomato")!;
  let w = confirmPlan(fresh, "A Name", NOW, { shipShort: true });
  assert.equal(dayDone(w), false);
  assert.equal(leavesShort(w, overview(w).previews).length, 1, "reproduced: the unapproved tomato update would leave a buyer short");
  assert.equal(rowShorts(w, overview(w).previews.get(tomato.id)!).length, 1, "before hand-off the row says it");
  w = markAllStage(w, "packed", "A Name", LATER).next;
  assert.equal(dayDone(w), false, "packed is not handed off");
  w = markAllStage(w, "handed-off", "A Name", LATER).next;
  assert.equal(dayDone(w), true);
  const p = overview(w).previews.get(tomato.id)!;
  // The cause: the warning (leaveVisible) was already hidden, but the update row and its text were computed from the preview alone.
  assert.equal(leaveVisible(w), false);
  assert.equal(leavesShort(w, overview(w).previews).length, 1, "the update itself still previews as short");
  assert.deepEqual(rowShorts(w, p), [], "but the row no longer says who it would leave short");
  assert.match(page, /rowShorts\(w, ready\)/);
  assert.match(page, /\{said\.map\(o => <span key=\{o\.orderId\} className="bad">/);
  assert.match(page, /ready && shorts\.length > 0 \?[\s\S]*?Review it/, "its button stays Review it, never a one-tap Approve");
  assert.equal(dayDone(await seed()), false, "no plan, no finished day");
  // Once approved before the hand-off nothing waits.
  const ok = approve(await seed(), tomato.id, "A Name", preview(await seed(), tomato.id).reviewHash!, NOW);
  assert.equal(leavesShort(ok, overview(ok).previews).length, 0);
});

test("Confirm without names the update it leaves out and what it would have done", async () => {
  const w = await seed(), [leave] = leavesShort(w, overview(w).previews);
  assert.equal(leave.product, "tomato");
  assert.equal(CONFIRM_WITHOUT("Alder Creek Farm", leave.product, leave.before, leave.after), "Confirm without Alder Creek Farm's tomato update (120 lb → 60 lb)");
  assert.equal(CONFIRM_WITHOUT("Alder Creek Farm"), "Confirm without Alder Creek Farm's update");
  assert.equal(moveLine({ amount: 120, unit: "lb" }, { amount: 60, unit: "lb" }), "120 lb → 60 lb");
  assert.match(pack, /CONFIRM_WITHOUT\(grower\(leave\.item\.source\.growerId\), leave\.product, leave\.before, leave\.after\)/);
  assert.match(pack, /\{!stale && arrived === 0 && " Print the sheets\."\}/, "no 'Print the sheets.' while Check it is the primary");
});

test("Day details: the garbled label is fixed and the substitute line names what was sent", async () => {
  assert.match(page, /Asks to growers that added supply/);
  assert.doesNotMatch(page, /Grower asks that added supply/);
  assert.equal(substituteLine({ product: "Tomato", substitutes: [{ product: "zucchini", amount: 30 }] }, "lb"), "30 lb of zucchini sent in place of tomato");
  assert.doesNotMatch(page, /by approved substitute/);
  let w = morning();
  w = start(w, pick(w, zucchini), 30);
  w = sendMessage(w, "res-1", CONTACTS, SME, ST(31));
  w = recordBuyerReply(w, "res-1", { channel: "call", text: "OK", accept: true }, SME, ST(40));
  const row = overview(w).rows.find(r => r.substitutedIn > 0)!;
  assert.deepEqual(row.substitutes.map(s => s.product), ["zucchini"]);
  assert.match(substituteLine(row, "lb"), /of zucchini sent in place of (tomato|cucumber)/);
});

test("the -5 message, the empty text reply and the empty follow-up all point at the field that is wrong", () => {
  assert.match(actions, /\/\^-\?\\d\+\$\/\.test\(amount\) && Number\(amount\) <= 0\) throw new FieldError\("Enter an amount above zero\.", "amount"\)/);
  assert.ok(actions.indexOf('"Enter an amount above zero."') < actions.indexOf('"Enter the amount as a whole number."'), "-5 is checked before the whole-number rule");
  assert.match(actions, /if \(!str\(f, "text"\)\) throw new FieldError\("Enter what they wrote\.", "text"\)/);
  assert.match(actions, /"Enter an answer for at least one open detail\.", \[\.\.\.f\.keys\(\)\]\.find\(k => \/\^value-\/\.test\(k\)\)/, "the first value input, not the wrapper");
});

test("an empty form says everything missing at once, in page order, and focuses the first", () => {
  assert.equal(stillNeeded(["who called", "the call note", "your name"]), "Still needed: who called, the call note and your name.");
  assert.equal(stillNeeded(["a"]), "Still needed: a.");
  const e = manyMissing([{ field: "grower", what: "who called" }, { field: "note", what: "the call note" }, { field: "who", what: "your name" }])!;
  assert.equal(e.field, "grower");
  assert.equal(e.message, "Still needed: who called, the call note and your name.");
  assert.equal(manyMissing([{ field: "note", what: "the call note" }]), undefined, "one missing field keeps its own message");
  assert.equal(needsName("", undefined), true);
  assert.equal(needsName("  ", undefined), true);
  assert.equal(needsName("", "Pat"), false, "a remembered name is enough");
  assert.equal(needsName("Coordinator", undefined), false, "a bad name has its own message");
  assert.match(actions, /manyMissing\(all\)/);
  assert.match(actions, /manyMissing\(\[\{ field: "shipShort", what: `a tick for “\$\{SHIP\}”` \}, \{ field: "who", what: "your name" \}\]\)/);
});

test("status lines name the buyer or grower and the amount", () => {
  let w = morning();
  w = start(w, pick(w, notice), 20);
  w = sendMessage(w, "res-1", CONTACTS, SME, ST(21));
  assert.equal(sentLine(w.resolutions[0]), "Sent to Riverbend School Kitchen: short 60 lb.");
  let v = morning();
  v = start(v, pick(v, zucchini), 30);
  v = sendMessage(v, "res-1", CONTACTS, SME, ST(31));
  assert.match(sentLine(v.resolutions[0]), /^Sent to Riverbend School Kitchen: offering zucchini for \d+ lb\.$/);
  v = recordBuyerReply(v, "res-1", { channel: "recorded", text: "", accept: true }, SME, ST(40));
  assert.match(answerLine(v.resolutions[0]), /^Recorded: Riverbend School Kitchen said yes to zucchini, \d+ lb\.$/);
  assert.match(actions, /say: w => sentLine\(resOf\(w, f\)\)/);
  assert.match(actions, /say: w => answerLine\(resOf\(w, f\)\)/);
  assert.match(actions, /step\.done = sentLine\(sent\.resolutions\.at\(-1\)!\)/);
});

test("They said yes with no channel is never in quotation marks; the title says what was done", () => {
  assert.match(orders, /if \(channel === "recorded"\) return `agreed \(recorded by \$\{by\}, no note\)`/);
  assert.match(orders, /\{agreedLine\(src\.record\.evidence\.channel, src\.record\.recordedBy, src\.record\.evidence\.quote\)\}/);
  assert.match(orders, /`\$\{r\.status === "drafted" \? "Ask" : "Asked"\} \$\{r\.facts\.to\.name\} for more`/);
  assert.doesNotMatch(orders, /Ask for more to/);
  assert.match(orders, /Send<span className="sr-only"> to \{opt\.kind === "ask-grower" \? grower\(opt\.contactId\) : buyerName\}<\/span>/);
  assert.doesNotMatch(orders, /Send<span className="sr-only"> \(\{line\}\)/);
});

test("Settle the cut on Orders says what was settled and links to the Next step instead of Orders", () => {
  assert.match(actions, /Settled: \$\{taken\.map/);
  assert.match(actions, /page === "\/orders" \? "See the next step\." : `Find more \$\{product\} on Orders\.`/);
  const c = source("app/conflict.tsx");
  assert.match(c, /<a href="#next-step">See the next step<\/a>/);
});

test("Review: one honest message per state", () => {
  for (const gone of ["The change appears once the message has a reading", "The outcome is shown above the Save and approve button", "The outcome is shown above Apply answers", "shown above the Apply and approve button"]) assert.doesNotMatch(review, new RegExp(gone), gone);
  assert.doesNotMatch(review, /Check the details below, then save and approve\.<\/p>\n/, "not repeated in the aside");
  assert.equal((review.match(/Check the details below, then save and approve\./g) ?? []).length, 1, "said once");
  assert.match(review, /handShown \? "Check the details below, then save and approve\." : start\?\.complete \? "Save these details, then approve\."/, "never 'save and approve' when only Save is offered");
  assert.match(review, /<a href="#preview">/, "the aside links to the preview");
  assert.equal((review.match(/id="preview"/g) ?? []).length, 2);
  assert.equal((review.match(/note=\{CHECKED\}/g) ?? []).length, 2, "the 'will be checked' line only belongs to the editable forms' own gate");
  assert.doesNotMatch(review, /\? [^:]*: CHECKED/);
  assert.match(review, /plain=\{recheck && hasApprove\}/, "the edited-value stop is shown once");
  assert.match(source("app/result.tsx"), /className=\{text && !plain \? "result" : "sr-only"\}/);
  assert.match(source("app/preview-gate.tsx"), /<div id=\{id\}/);
  assert.match(actions, /done: "Call logged as their reply\."/);
});

test("Fresh reply hint, history wording and the approval result panel", () => {
  assert.equal(APPLY_THEN, "Then approve the change it makes, on the next step.");
  assert.match(source("app/value-fields.tsx"), /\{!all && <p className="fine-print">\{APPLY_THEN\}<\/p>\}/);
  assert.match(review, /recorded the call details/);
  assert.match(review, /<>\{HISTORY_RECHECK\}<\/>/);
  assert.equal(source("app/lib/format.ts").match(/HISTORY_RECHECK = "([^"]+)"/)![1], "Checked again against current supply");
  assert.match(review, /Resolve \{buyer\(o\.buyerId\)\}<\/a>/);
  assert.doesNotMatch(review, /is now \{weight\(s\.short, s\.unit\)\} short\{" "\}/, "the panel does not repeat the result");
});
