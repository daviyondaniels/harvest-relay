import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { ratio, rule, themes } from "./contrast.ts";

// Task 9: layout, accessibility and visual design, checked on the sources and the CSS tokens.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = source("app/globals.css");

test("the contrast helper computes known WCAG ratios", () => {
  assert.equal(ratio("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48");
});

test("contrast: soft text and the done chip reach 5:1 in light, link text 5.5:1 on cards in dark", () => {
  const { light, dark } = themes(css);
  for (const bg of ["--paper", "--surface", "--surface-2", "--leaf-wash"]) assert.ok(ratio(light["--ink-soft"], light[bg]) >= 5, `soft text on ${bg}: ${ratio(light["--ink-soft"], light[bg]).toFixed(2)}`);
  assert.ok(ratio(light["--leaf"], light["--done-wash"]) >= 5, "done chip text");
  for (const [fg, bg] of [["--leaf", "--leaf-wash"], ["--sun-ink", "--sun-wash"], ["--beet", "--beet-wash"], ["--ink-soft", "--surface-2"]]) assert.ok(ratio(light[fg], light[bg]) >= 4.5, `${fg} on ${bg}`);
  for (const bg of ["--surface", "--surface-2"]) assert.ok(ratio(dark["--link"], dark[bg]) >= 5.5, `dark link on ${bg}: ${ratio(dark["--link"], dark[bg]).toFixed(2)}`);
  for (const [fg, bg] of [["--leaf", "--done-wash"], ["--sun-ink", "--sun-wash"], ["--beet", "--beet-wash"], ["--ink-soft", "--paper"]]) assert.ok(ratio(dark[fg], dark[bg]) >= 4.5, `dark ${fg} on ${bg}`);
  // The auto-dark block repeats the explicit dark tokens.
  const auto = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf(':root[data-theme="dark"]'));
  assert.match(auto, new RegExp(`--link: ${dark["--link"]}`));
});

test("chip text is at least 13 px", () => {
  const size = rule(css, ".chip").match(/font-size: ([\d.]+)rem/)![1];
  assert.ok(Number(size) * 16 >= 13, `chip is ${Number(size) * 16}px`);
});

test(".sr-only is absolutely positioned and no rule in a clipping box overrides it", () => {
  assert.match(rule(css, ".sr-only"), /position: absolute;/);
  assert.match(rule(css, ".sr-only"), /overflow: hidden;/);
  // A span rule in the Overview rows must skip the hidden spans, or they escape their box.
  for (const m of css.matchAll(/(^|\n)([^{}\n@][^{}\n]*\bspan\b[^{}\n]*) \{([^}]*)\}/g)) {
    const [, , sel, body] = m;
    if (/\.attention/.test(sel) && /(overflow|white-space|display)\s*:/.test(body)) assert.match(sel, /:not\(\.sr-only\)/, sel);
  }
  // Nothing sets `position` back on it.
  assert.doesNotMatch(css, /\.sr-only[^{]*\{[^}]*position: (static|relative)/);
});

test("the spacing scale is 4, 8, 12, 16, 24 and 32 px in padding, margin and gap", () => {
  const bad: string[] = [];
  for (const m of css.matchAll(/\b((?:padding|margin|gap|column-gap|row-gap)(?:-(?:top|bottom|left|right))?):([^;}]*)/g)) {
    for (const px of m[2].matchAll(/(?<![\w.#])-?(\d+)px/g)) if (![0, 4, 8, 12, 16, 24, 32].includes(Number(px[1]))) bad.push(`${m[1]}:${m[2]}`);
  }
  assert.deepEqual(bad, []);
});

test("the Day details summary shows a marker and reads as a control", () => {
  assert.match(css, /details > summary::before \{ content: "\\25B8"/);
  assert.match(css, /details\[open\] > summary::before \{ content: "\\25BE"/);
  assert.match(rule(css, ".day-details > summary"), /border: 1px solid/);
});

test("phone: a fixed bottom tab bar marks its page, the page is padded below it, and targets are 44 px", () => {
  const nav = source("app/nav.tsx");
  assert.match(nav, /<nav className="tabbar" aria-label="Pages">/);
  assert.match(nav, /<a key=\{href\} href=\{href\} aria-label=\{full\} aria-current=\{here\(href\) \? "page" : undefined\}><Icon \/><span>\{label\}<\/span><\/a>/);
  const tabs = nav.match(/const TABS = \[(.*?)\] as const;/)![1];
  assert.deepEqual([...tabs.matchAll(/\["(\/[^"]*)"/g)].map(m => m[1]), ["/", "/review", "/orders", "/pack", "/call"]);
  const phone = css.slice(css.indexOf("/* Phone, up to 600 px: a fixed bottom tab bar"));
  assert.match(phone, /\.tabbar \{ position: fixed; left: 0; right: 0; bottom: 0;/);
  assert.match(phone, /body \{ padding-bottom: calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\)\); \}/);
  assert.match(phone, /\.tabbar a \{[^}]*min-height: 56px/);
  assert.match(css, /--tabbar-h: 72px;/);
  assert.match(phone, /\.menu-nav \{ display: none; \}/);
  assert.match(css, /\.top, \.tabbar, \.no-print \{ display: none !important; \}/, "never printed");
  assert.match(phone, /\.brand \{ min-height: 44px;/);
  assert.match(phone, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="hidden"\]\), select, textarea \{ min-height: 44px; \}/);
  assert.match(phone, /details > summary \{ min-height: 44px; \}/);
  assert.match(phone, /p a, li a:not\(\.button\) \{ display: inline-flex; align-items: center; min-height: 44px; \}/);
});

test("the skip link lands on the message or order panel, and the queue follows the panel in the page order", () => {
  const nav = source("app/nav.tsx");
  assert.match(nav, /SKIP: Record<string, string> = \{ "\/review": "#item", "\/orders": "#order" \}/);
  assert.match(source("app/review/page.tsx"), /id="item" tabIndex=\{-1\}/);
  assert.match(source("app/orders/page.tsx"), /<h1 id="order" tabIndex=\{-1\}>/);
});

test("name fields: a name for what it is for, shown once on Review, never twice with the same id", () => {
  const field = source("app/named-submit.tsx");
  assert.match(field, /Your name<span className="sr-only">, for \{purpose \?\? purposeOf\(on\)\}<\/span>/);
  assert.match(field, /"this approval"/);
  // Secondary forms on Review are quiet; only the primary one asks.
  const review = source("app/review/page.tsx");
  for (const on of ["refreshAll", "script", "dismiss", "read", "ask", "correct"]) assert.match(review, new RegExp(`on="${on}" bad=\\{\\w+\\} quiet`), on);
  assert.match(review, /quiet=\{main !== "approve"\}/);
  assert.match(review, /quiet=\{main !== "reply"\}/);
  assert.match(review, /<NameField known=\{known\} on="hold" bad=\{bad\} quiet \/>/);
});

test("every form `on` in a page's source is unique", () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(new URL(`../${dir}`, import.meta.url))) { const p = `${dir}/${f}`; if (statSync(new URL(`../${p}`, import.meta.url)).isDirectory()) walk(p); else if (/page\.tsx$/.test(f)) files.push(p); } };
  walk("app");
  assert.ok(files.length >= 5);
  for (const file of files) {
    const ons = [...source(file).matchAll(/(?:NamedSubmit|NameField)\b[^\n]*?\bon="([\w-]+)"/g)].map(m => m[1]);
    // Each literal `on` is a form of its own; `hold` is the one note form (several buttons), named once.
    assert.deepEqual(ons.filter((o, n) => ons.indexOf(o) !== n), [], `${file} repeats a form id`);
  }
});

test("Approve while blocked stays focusable (aria-disabled) and moves focus to the open question", () => {
  const review = source("app/review/page.tsx"), field = source("app/named-submit.tsx");
  assert.doesNotMatch(review, /disabled=\{off\}/);
  assert.match(review, /blocked=\{off \? \(byField\.size > 0 \? "open-questions" : "approve-why"\) : undefined\}/);
  assert.match(review, /id="open-questions" tabIndex=\{-1\}/);
  assert.match(field, /"aria-disabled": true, onClick: stop/);
  assert.match(field, /e\.preventDefault\(\); document\.getElementById\(blocked!\)\?\.focus\(\)/);
  assert.match(css, /button\[aria-disabled="true"\]/);
});

test("split the cut: the form does its own checking and shows the app's message beside the fieldset", () => {
  const conflict = source("app/conflict.tsx");
  assert.match(conflict, /<form action=\{decideCutAction\} className="form" noValidate>/);
  assert.match(conflict, /<Problem bad=\{bad\} on=\{on\} name="cut" \/>/);
  assert.match(source("app/actions.ts"), /Enter whole numbers of pounds for the split\./);
});

test("the change line wraps; no .nowrap on it", () => {
  assert.doesNotMatch(source("app/review/page.tsx"), /className="nowrap"/);
  assert.match(css, /\.tag \.to \{ overflow-wrap: anywhere;/);
});

test("the header lets 'not you?' wrap and keeps the Menu clear of the page name", () => {
  assert.match(rule(css, ".who-line"), /flex-wrap: wrap;/);
  assert.doesNotMatch(rule(css, ".page-name"), /white-space: nowrap/);
  assert.match(css, /@media \(max-width: 300px\) \{[\s\S]*?grid-template-areas: "brand menu" "name name" "who who"/);
});

// Task 15: phone chrome and small layout.
test("the phone tab bar follows <main> in the DOM, and the fixed bar is not inside the header", () => {
  const layout = source("app/layout.tsx"), nav = source("app/nav.tsx");
  assert.ok(layout.indexOf("</main>") < layout.indexOf("<TabBar />"), "TabBar after main");
  assert.ok(layout.indexOf("<TabBar />") > layout.indexOf("</header>"), "TabBar outside header");
  const header = nav.slice(nav.indexOf("export function Header"));
  assert.doesNotMatch(header, /className="tabbar"/);
  assert.match(nav, /aria-label="Pages"/);
  assert.match(nav, /aria-current/);
});

test("at 300 px and below the tab links are at least 44 px wide and the body padding follows --tabbar-h", () => {
  const narrow = css.slice(css.indexOf("@media (max-width: 300px)"));
  assert.match(narrow, /grid-template-columns: repeat\(3, minmax\(44px, 1fr\)\)/);
  assert.match(narrow, /--tabbar-h: (\d+)px/);
  assert.match(css, /padding-bottom: calc\(var\(--tabbar-h\)/);
});

test("radio labels wrap long text, the understood labels never break mid-word, fine print is 14 px", () => {
  assert.match(css, /label\.check > span \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
  assert.match(css, /table\.reading td:last-child \{ overflow-wrap: anywhere; \}/);
  assert.match(css, /table\.reading td:first-child \{ overflow-wrap: normal;/);
  const size = rule(css, ".fine-print").match(/font-size: ([\d.]+)rem/)![1];
  assert.ok(Number(size) * 16 >= 14, `fine print is ${Number(size) * 16}px`);
});
