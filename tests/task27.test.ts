import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPLIT_WITH_OTHER, splitProblem, splitTotalMessage } from "../app/lib/cut.ts";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a missed total says what to do, in the lot's unit", () => {
  assert.equal(splitTotalMessage(6, 10, "lb"), "You entered 6 lb; the cuts must total 10 lb. Place 4 lb more.");
  assert.equal(splitTotalMessage(12, 10, "lb"), "You entered 12 lb; the cuts must total 10 lb. Take off 2 lb.");
  assert.equal(splitTotalMessage(0, 5, "each"), "You entered 0 each; the cuts must total 5 each. Place 5 each more.");
});

test("the split boxes are text boxes the wheel and arrow keys cannot change", () => {
  const s = source("app/cut-choice.tsx");
  assert.match(s, /type="text" inputMode="numeric" pattern="\[0-9\]\*" autoComplete="off"/);
  assert.doesNotMatch(s, /type="number"/);
});

test("the split fieldset is hidden by CSS while a buyer is chosen, and the set-aside note stays outside it", () => {
  assert.match(source("app/globals.css"), /\.conflict:not\(\[data-kept\]\):has\(input\[name=choice\]\[value=split\]:not\(:checked\)\) fieldset\.split \{ display: none; \}/);
  const s = source("app/cut-choice.tsx"), note = s.indexOf("The amounts are set aside"), close = s.indexOf("</fieldset>");
  assert.ok(note > close, "the note follows the fieldset");
});

test("the Print button says when the sheets are out of date", () => {
  const p = source("app/pack/print.tsx");
  assert.match(p, /outOfDate \? "Print anyway \(out of date\)" : "Print sheets"/);
  assert.match(source("app/pack/page.tsx"), /outOfDate=\{stale\}/);
});

test("without script, a suggested split left as shown is ignored beside a buyer choice; anything else typed is refused", () => {
  assert.equal(splitProblem("order-b", ["4", "6"], ["4", "6"]), undefined, "the untouched suggestion was not typed");
  assert.equal(splitProblem("order-b", ["5", "6"], ["4", "6"]), SPLIT_WITH_OTHER, "a changed amount is never dropped");
  assert.equal(splitProblem("order-b", ["4", "6"]), SPLIT_WITH_OTHER, "with no suggestion shown, amounts are typed");
  assert.equal(splitProblem("order-b", ["", ""], ["4", "6"]), undefined, "cleared boxes are fine");
  assert.equal(splitProblem("split", ["4", "6"], ["4", "6"]), undefined);
  const card = readFileSync(new URL("../app/conflict.tsx", import.meta.url), "utf8"), css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(card, /name=\{`shown-\$\{p\.orderId\}`\}/, "the card posts what it filled in");
  assert.match(card, /"data-kept": ""/, "a refusal that kept amounts marks the card");
  assert.match(css, /\.conflict:not\(\[data-kept\]\):has\(input\[name=choice\]\[value=split\]:not\(:checked\)\) fieldset\.split \{ display: none; \}/, "kept amounts stay visible");
  assert.match(readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8"), /str\(f, `shown-\$\{orderId\}`\)/);
});
