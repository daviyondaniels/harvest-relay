import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LATE, seedWorkbench } from "../src/seed.ts";
import { approve, preview, previewHand, readByHandAndApprove, receive, suggestReading } from "../src/workbench.ts";
import { numberSpan } from "../app/lib/quote.ts";
import { confirmPlan, conflicts, decideCut } from "../src/commitments.ts";
import { changedSheets, cutOutcome, leftToPlace, leftToPlaceSaid, splitProblem, splitTotalMessage, staleSheetLine, NEGATIVE_POUNDS, RECONFIRM, SPLIT_WITH_OTHER, TOO_LARGE, WHOLE_POUNDS } from "../app/lib/cut.ts";
import { possessive } from "../app/lib/format.ts";

const NOW = "2026-10-28T14:00:00.000Z", LATER = "2026-10-28T14:05:00.000Z";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const cutState = async () => {
  const w = await seedWorkbench(JSON.parse(source("data/seed-readings.json")), NOW), t = w.items.find(i => i.source.id === "msg-tomato")!;
  return approve(confirmPlan(w, "A Name", NOW, { shipShort: true }), t.id, "A Name", preview(confirmPlan(w, "A Name", NOW, { shipShort: true }), t.id).reviewHash!, LATER);
};

test("possessive: a name ending in s takes only the apostrophe", () => {
  assert.equal(possessive("Birch Hollow Gardens"), "Birch Hollow Gardens'");
  assert.equal(possessive("Alder Creek Farm"), "Alder Creek Farm's");
});

test("split amounts posted with another choice are refused, not dropped", () => {
  assert.equal(splitProblem("order-a", ["4", "6"]), SPLIT_WITH_OTHER);
  assert.equal(SPLIT_WITH_OTHER, "You typed split amounts. Choose Split it, or clear the amounts.");
  assert.equal(splitProblem("order-a", ["", ""]), undefined, "blank boxes beside a buyer are fine");
  assert.equal(splitProblem("", ["0"]), SPLIT_WITH_OTHER);
  assert.equal(splitProblem("split", ["4", "6"]), undefined);
  assert.equal(splitProblem("split", ["", "10"]), undefined, "a blank box counts as 0");
});

test("a negative number and a decimal each get their own message", () => {
  assert.equal(splitProblem("split", ["-5", "15"]), NEGATIVE_POUNDS);
  assert.equal(NEGATIVE_POUNDS, "Enter 0 or more pounds.");
  assert.equal(splitProblem("split", ["2.5", "7.5"]), WHOLE_POUNDS);
  assert.equal(WHOLE_POUNDS, "Enter whole pounds.");
  assert.equal(splitProblem("split", ["-2.5", "1"]), NEGATIVE_POUNDS);
});

test("the live line says what is left, or that it is all placed", () => {
  assert.equal(leftToPlace(10, ["", ""], "lb"), "10 lb left to place");
  assert.equal(leftToPlace(10, ["4", ""], "lb"), "6 lb left to place");
  assert.equal(leftToPlace(10, ["4", "6"], "lb"), "All 10 lb placed.");
  assert.equal(leftToPlace(10, ["8", "6"], "lb"), "4 lb too many");
});

test("a settled cut says who now gets what and who is short", async () => {
  const w = await cutState(), c = conflicts(w.ledger)[0];
  const next = decideCut(w, c.lotId, [{ orderId: c.promises[0].orderId, amount: c.excess }], c.excess, "A Name", LATER);
  const lines = cutOutcome(next.ledger, [c.promises[0].orderId]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^.+ now gets \d+ of \d+ lb \(\d+ short\)\.$/);
  assert.equal(RECONFIRM, "Confirm today's plan again so the sheets match.");
});

test("a sheet that changed since the confirm carries a line that prints", async () => {
  const w = await cutState();
  const next = decideCut(w, conflicts(w.ledger)[0].lotId, [{ orderId: conflicts(w.ledger)[0].promises[0].orderId, amount: conflicts(w.ledger)[0].excess }], conflicts(w.ledger)[0].excess, "A Name", LATER);
  assert.ok(changedSheets(next.ledger).orders.size > 0);
  assert.equal(staleSheetLine("Wed 9:00 AM"), "Changed since the plan was confirmed at Wed 9:00 AM. Confirm again before packing.");
  const pack = source("app/pack/page.tsx");
  assert.match(pack, /changed\.orders\.has\(s\.orderId\) && staleLine/);
  assert.match(pack, /changed\.lots\.has\(x\.lotId\)\) && staleLine/);
  assert.doesNotMatch(source("app/globals.css"), /\.stale-sheet[^{]*\{[^}]*display:\s*none/);
});

test("the cut card: copy, tie between boxes and radio, and the checklist link", () => {
  const card = source("app/conflict.tsx"), choice = source("app/cut-choice.tsx"), actions = source("app/actions.ts"), pack = source("app/pack/page.tsx");
  assert.match(card, /possessive\(who\)/);
  assert.doesNotMatch(card, /takes \{excess\}|dropped \{excess\}\. \{excess\}/);
  assert.match(card, /gets \$\{excess\} less/);
  assert.match(choice, /<legend>Split it: pounds each buyer gets less<\/legend>/);
  assert.match(choice, /The amounts must add up to \{excessText\}\. A blank box counts as 0\./);
  assert.match(choice, /aria-describedby=\{`\$\{on\}-total`\}/);
  assert.match(choice, /role="status">{leftToPlaceSaid\(line\)}/);
  assert.match(choice, /setChoice\("split"\)/);
  assert.match(actions, /splitProblem\(choice/);
  assert.match(pack, /cutOpen \? `#cut-\$\{lot\}-head`/);
});

// Audit D's path: tomato approved (lot-b now promised to Northside 60 and Riverbend 20), plan confirmed, then
// Birch Hollow's late drop from 80 to 70 lb read and approved. That opens a 10 lb cut on a lot with two buyers.
const sharedCut = async () => {
  let w = await seedWorkbench(JSON.parse(source("data/seed-readings.json")), NOW);
  const t = w.items.find(i => i.source.id === "msg-tomato")!;
  w = confirmPlan(approve(w, t.id, "A Name", preview(w, t.id).reviewHash!, NOW), "A Name", NOW, { shipShort: true });
  w = receive(w, LATE.source, LATER);
  const id = w.items.at(-1)!.id, g = suggestReading(w, id);
  const reading = { operation: g.operation!, lotId: g.lotId!, quantity: g.quantity!, grade: g.grade!, deliveryOn: g.deliveryOn!, quote: numberSpan(LATE.source.text, String(g.quantity!.amount)) };
  w = readByHandAndApprove(w, id, reading, "A Name", LATER, previewHand(w, id, reading, LATER)!.reviewHash).next;
  return { w, c: conflicts(w.ledger).find(x => x.lotId === "lot-b")! };
};

test("the result says exactly who now gets what, for the suggested buyer, the other buyer and a split", async () => {
  const { w, c } = await sharedCut();
  assert.equal(c.excess, 10);
  assert.deepEqual(c.promises.map(p => p.orderId).sort(), ["order-a", "order-b"]);
  const settle = (cuts: { orderId: string; amount: number }[]) =>
    cutOutcome(decideCut(w, "lot-b", cuts, 10, "A Name", LATER).ledger, cuts.filter(x => x.amount > 0).map(x => x.orderId));
  assert.deepEqual(settle([{ orderId: "order-b", amount: 10 }]), ["Riverbend School Kitchen now gets 10 of 80 lb (70 short)."]);
  assert.deepEqual(settle([{ orderId: "order-a", amount: 10 }]), ["Northside Grocery Co-op now gets 110 of 120 lb (10 short)."]);
  assert.deepEqual(settle([{ orderId: "order-a", amount: 4 }, { orderId: "order-b", amount: 6 }]),
    ["Northside Grocery Co-op now gets 116 of 120 lb (4 short).", "Riverbend School Kitchen now gets 14 of 80 lb (66 short)."]);
});

test("a split that misses the total says so in the lot's unit; a huge number is called too large", () => {
  assert.equal(splitTotalMessage(6, 10, "lb"), "You entered 6 lb; the cuts must total 10 lb.");
  assert.equal(splitTotalMessage(3, 5, "each"), "You entered 3 each; the cuts must total 5 each.");
  assert.equal(splitProblem("split", ["12345678901", "0"]), TOO_LARGE);
});

test("the screen reader hears the live line only when the split is all placed or overshoots", () => {
  assert.equal(leftToPlaceSaid(leftToPlace(10, ["4", ""], "lb")), "");
  assert.equal(leftToPlaceSaid(leftToPlace(10, ["4", "6"], "lb")), "All 10 lb placed.");
  assert.equal(leftToPlaceSaid(leftToPlace(10, ["8", "6"], "lb")), "4 lb too many");
});
