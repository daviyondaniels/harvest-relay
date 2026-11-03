import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitTotalMessage } from "../app/lib/cut.ts";

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
  assert.match(source("app/globals.css"), /\.conflict:has\(input\[name=choice\]\[value=split\]:not\(:checked\)\) fieldset\.split \{ display: none; \}/);
  const s = source("app/cut-choice.tsx"), note = s.indexOf("The amounts are set aside"), close = s.indexOf("</fieldset>");
  assert.ok(note > close, "the note follows the fieldset");
});

test("the Print button says when the sheets are out of date", () => {
  const p = source("app/pack/print.tsx");
  assert.match(p, /outOfDate \? "Print anyway \(out of date\)" : "Print sheets"/);
  assert.match(source("app/pack/page.tsx"), /outOfDate=\{stale\}/);
});
