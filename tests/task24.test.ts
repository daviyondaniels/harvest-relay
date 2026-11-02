import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Task 24: phone density. Layout only; the measured heights are in the commit message.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const phone = css.slice(css.lastIndexOf("Task 24, phone density"));

test("tab labels are 14 px on a phone, and the bar stays icon-only at 300 px and below", () => {
  assert.match(phone, /\.tabbar a \{[^}]*font-size: 0\.875rem/);
  assert.match(css, /@media \(max-width: 300px\)[\s\S]*?\.tabbar a span \{ display: none; \}/);
});

test("attention rows use 8 px padding on a phone and drop the icon column", () => {
  assert.match(phone, /\.attention \.item, \.attention \.short-order \{[^}]*padding: 8px/);
  assert.match(phone, /\.attention \.icon \{ display: none; \}/);
});

test("the stat chips stay a 2 x 2 grid and no phone rule sets a target under 44 px", () => {
  assert.match(css, /\.hero \.stats \{ display: grid; grid-template-columns: 1fr 1fr/);
  assert.doesNotMatch(phone, /min-height:\s*(?:[0-9]|[1-3][0-9]|4[0-3])px/);
});

test("the Overview keeps Day details folded and the buyer table as two-line phone rows", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<details className="day-details">/);
  assert.match(css, /table\.buyers td\[data-label="Wants"\][^{]*\{ display: none; \}/);
});
