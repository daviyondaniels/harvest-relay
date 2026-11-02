import test from "node:test";
import { SHIP_SHORT } from "../app/lib/view.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { OPERATION, OPERATION_CHOICE, FIELD, changeLine, forecastTag } from "../app/lib/format.ts";

// The app's own words, checked where a unit test cannot render the page.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("I2: the measures card says what was counted, not that each count resolved an order", () => {
  const page = source("app/page.tsx");
  assert.doesNotMatch(page, /covered by a grower|"buyers? told"/, "a corrected notice to one buyer would read as two buyers told");
  for (const label of ["Short orders found today", "Asks to growers that added supply", "Substitutes agreed", "Buyers told they'd be short", "Orders sent short"]) assert.ok(page.includes(label), label);
  assert.doesNotMatch(page, /Counts of actions, not of orders/);
});

test("I1: the Orders page takes the open rule from the domain", () => {
  const page = source("app/orders/page.tsx");
  assert.match(page, /openFor\(w, orderId, x\.opt\)/);
  assert.doesNotMatch(page, /status === "drafted" \|\| r\.status === "sent"/);
});

test("M6: the supply amount field takes whole numbers and the action says so", () => {
  assert.match(source("app/orders/page.tsx"), /name="amount" type="number" min="1" step="1"/);
  assert.match(source("app/actions.ts"), /Number\.isSafeInteger\(amount\)/);
});

test("M8: the Orders fine print says nothing is delivered", () => {
  const page = source("app/orders/page.tsx");
  assert.doesNotMatch(page, /Nothing is reserved, sent to buyers/);
  assert.match(page, /Who gets what: direct orders first, by priority, then substitutes the buyer has agreed to\./);
  assert.equal(page.match(/Recorded only; nothing is delivered\./g)?.length, 1, "said once, in the page intro, not on every form");
  assert.doesNotMatch(page, /Allocation rule/);
});

test("Ease task 7: banned words never come back as on-screen text anywhere in app/", async () => {
  const { readdirSync } = await import("node:fs");
  const files = (readdirSync(new URL("../app", import.meta.url), { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f));
  assert.ok(files.length > 5);
  // Comment and import lines are skipped; the rest is searched for the banned phrases.
  const banned = [/Kind of update/, /Change preview/, /proposed allocation/i, /Not worked out yet/, /Invalid operation answer/, /Pack amount must be positive/, /Allocation rule/, />\s*Reading\s*</, /"Reading"/];
  for (const f of files) {
    const text = source(`app/${f}`).split("\n").filter(l => !/^\s*(\/\/|\*|import )/.test(l)).join("\n");
    for (const b of banned) assert.doesNotMatch(text, b, `${f}: ${b}`);
  }
  // Raw tokens may appear only as code values, never in a user-facing sentence.
  const shown = [/>[^<{]*\b(replace-total|add-quantity)\b[^<{]*</, /(error|Error|FieldError)\([^)]*\b(replace-total|add-quantity)\b/];
  for (const f of files) for (const b of shown) assert.doesNotMatch(source(`app/${f}`), b, `${f}: ${b}`);
});

test("Task 17: the approver name is asked for beside its field and remembered in a strict, HttpOnly cookie", () => {
  const actions = source("app/actions.ts"), name = source("app/lib/name.ts");
  assert.match(source("app/lib/names.ts"), /"Enter your name to continue\."/, "the name is asked beside the form's own name field");
  assert.match(name, /NAME_COOKIE = "hr_name"/);
  assert.match(source("src/hub.ts"), /NAME_MAX = 80/, "the same limit as the name field");
  assert.match(source("app/lib/names.ts"), /import \{ NAME_MAX \} from "..\/..\/src\/hub.ts"/, "one limit for the field and every recorded name");
  for (const f of ["src/workbench.ts", "src/resolve.ts", "src/commitments.ts", "src/orders.ts", "src/updates.ts"]) assert.match(source(f), /NAME_MAX/, f);
  assert.match(name, /httpOnly: true, sameSite: "strict", path: "\/"/);
  assert.match(name, /maxAge: 12 \* 60 \* 60/, "one working day");
  assert.match(name, /HARVEST_SECURE_COOKIES === "1"/);
  assert.doesNotMatch(name + actions, /x-forwarded-proto/);
  assert.match(name, /delete\("reviewer"\)/, "the old cookie is removed");
  // Task 18: the name field, its error and "Recording as … · not you?" live in the header (app/who.tsx).
});

test("Ease task 2: the name is asked on the first action, in the same form, and every recording action takes it", () => {
  const actions = source("app/actions.ts"), orders = source("app/orders/page.tsx"), pack = source("app/pack/page.tsx"), review = source("app/review/page.tsx");
  assert.doesNotMatch(actions, /actor\(\)|RESERVED_NAME|NameNeeded|NAME_AT_TOP/, "no action records the reserved label or points at the header");
  assert.match(actions, /async function asNamed<T>\(f: FormData, fn: \(who: string\) => Promise<T>\): Promise<T> \{[\s\S]*?runAs\(f\.get\("who"\), await rememberedName\(\), rememberName, fn\)/);
  assert.match(source("app/lib/names.ts"), /export async function runAs[\s\S]*?checkName\(typed\)[\s\S]*?new FieldError\(NAME_NEEDED, "who"\)[\s\S]*?const done = await fn\(who\);[\s\S]*?await remember\(c\.name\)/, "the name is remembered only after the action worked");
  // Every exported action that changes records through act( also asks named(.
  const exported = actions.split(/\nexport async function /).slice(1).map(b => ({ name: b.slice(0, b.indexOf("(")), body: b.split(/\n(?:export |\/\/ )/)[0] }));
  const acting = exported.filter(x => /\bact\(/.test(x.body));
  assert.ok(acting.length >= 6, "the actions that call act( directly");
  for (const x of acting) assert.match(x.body, /asNamed\(f/, `${x.name} records a person's name`);
  // The ones that go through run( or onOrder( do so by their step, which names unless it is the scripted arrival.
  assert.equal(actions.match(/step\.anon \? go\(""\) : asNamed\(f, go\)/g)?.length, 2, "run( and onOrder( both name, unless it is the scripted arrival");
  assert.doesNotMatch(actions, /\bnamed\(f\)/, "no action reads the name outside asNamed");
  assert.equal(actions.match(/anon: true/g)?.length, 1, "only the demo's scripted arrival of a reply is not the coordinator's");
  for (const page of [review, orders, pack, source("app/call/page.tsx"), source("app/conflict.tsx")]) assert.doesNotMatch(page, /NameNeeded|name-needed/, "no redirect to the header");
  assert.equal(existsSync(new URL("../app/name-needed.tsx", import.meta.url)), false, "NameNeeded is gone");
  // A refusal for want of a name is shown beside the form's own name field, which takes focus.
  assert.match(actions, /resId && !notice\.field/);
  assert.match(pack, /field === "who"/);
  assert.match(orders, /optBad/);
});

test("Ease task 2: NamedSubmit shows the name input only when no name is known, and every recording submit uses it", () => {
  const ns = source("app/named-submit.tsx");
  assert.match(ns, /^"use client";/);
  assert.match(ns, /if \(known\) return null;/, "a known name shows nothing extra");
  assert.match(ns, /<input name="who" aria-required="true" defaultValue=\{kept\} aria-label=\{`Your name, for \$\{purpose \?\? purposeOf\(on\)\}`\} maxLength=\{NAME_MAX\} autoComplete="name"/);
  assert.match(ns, /<Problem bad=\{bad\} on=\{on\} name="who" \/>/, "a refused name is explained beside the input");
  assert.match(ns, /<NameField known=\{known\}[^>]*\/>\s*<button type="submit"/, "the input comes directly before the button, in the same form");
  assert.doesNotMatch(ns, />\s*Save\s*</, "no separate Save button");
  // Every form that records a name has the field: none of these actions is posted by a bare button.
  const plain = /<form[^>]*action=\{(?:approve|ask|reply|correct|readByHand|confirmLot|dismissNoChange|refresh|refreshAll|scriptedReply|liveRead|decideCut|logCall|confirm|lateMessage|stage|startResolution|sendNow|confirmDraft|editDraft|museDraft|send|discardDraft|requestedCall|buyerReply|supplyReply)Action\}[^>]*>[^]*?<\/form>/g;
  let seen = 0;
  for (const path of ["app/review/page.tsx", "app/orders/page.tsx", "app/pack/page.tsx", "app/call/page.tsx", "app/conflict.tsx"]) {
    for (const form of source(path).match(plain) ?? []) {
      seen += 1;
      assert.match(form, /NamedSubmit|NameField/, `${path}: ${form.slice(0, 90)}`);
    }
  }
  assert.ok(seen >= 25, `${seen} forms checked`);
});

test("Fix round 1: no page renders error text taken straight from the URL", () => {
  for (const page of ["app/review/page.tsx", "app/orders/page.tsx", "app/call/page.tsx", "app/pack/page.tsx"]) {
    const src = source(page);
    assert.match(src, /readNotice\(/, page);
    assert.doesNotMatch(src, /\{ error \} = await searchParams|error\?: string \}> \}\) \{\n  const \{[^}]*\berror\b/, page);
  }
});

test("Task 17: stale items refresh with replies, and the queue can refresh them all", () => {
  const review = source("app/review/page.tsx");
  assert.match(review, /Refresh all stale items/);
  assert.doesNotMatch(review, /checked again\./, "a quiet re-check says nothing");
  assert.match(review, /p\.stale && p\.moved && .*Supply changed since this was read: was \{weight\(p\.moved\.was, p\.moved\.unit\)\}, now \{weight\(p\.moved\.now, p\.moved\.unit\)\}\./, "the note only when the supply moved, as was X, now Y");
  assert.match(review, /needingRefresh\(w\)/, "Refresh all counts only items that need a refresh");
  assert.match(source("app/lib/format.ts"), /needsRefresh/);
});

test("Task 17: replies link to their ask and back, and the ask card no longer says it is in review once reviewed", () => {
  assert.match(source("app/review/page.tsx"), /Reply to your ask about/);
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /Their reply was reviewed\./);
});

test("Task 17: Orders confirms and discards drafts, and both pages show a capped substitute", () => {
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /Confirm these words/);
  assert.match(orders, /Discard draft/);
  assert.match(orders, /disabled=\{/, "Send waits for confirmation");
  for (const page of [orders, source("app/page.tsx")]) assert.match(page, /up to \$\{/);
});

test("Task 18: a skip link, a main target and a title for every page", () => {
  const layout = source("app/layout.tsx");
  // The skip link sits in the header (it knows the page) and lands on the message or order panel (Task 9).
  assert.match(source("app/nav.tsx"), /className="skip" href=\{SKIP\[path\] \?\? "#main"\}/);
  assert.match(layout, /<main id="main"/);
  assert.match(layout, /template: "%s · Harvest Relay"/);
  assert.match(source("app/page.tsx"), /title: \{ absolute: "Overview · Harvest Relay" \}/);
  for (const [page, title] of [["app/orders/page.tsx", "Orders"], ["app/pack/page.tsx", "Pack"], ["app/call/page.tsx", "Log a call"]])
    assert.match(source(page), new RegExp(`metadata[^=]*= \\{ title: "${title}" \\}`), page);
  assert.match(source("app/events/[id]/page.tsx"), /"Recorded change" : "Not found"/, "a missing change is titled Not found");
});

test("Task 18: the header menu is a disclosure that closes on Escape and returns focus; Reset demo asks first and sits apart from Log a call", () => {
  const nav = source("app/nav.tsx");
  for (const s of [/aria-expanded=\{open\}/, /aria-controls="site-menu"/, /useDismiss\(open, close, area, button\)/, />Menu</]) assert.match(nav, s);
  const dismiss = source("app/dismiss.ts");
  assert.match(dismiss, /e\.key !== "Escape"/);
  assert.match(dismiss, /button\.current\?\.focus\(\)/);
  assert.match(nav, /Reset the demo\?/);
  assert.match(nav, /This clears today's decisions and the remembered name\./);
  assert.match(nav, /showModal\(\)/);
  const menu = nav.slice(nav.indexOf('id="site-menu"'));
  assert.ok(menu.indexOf("{links}") < menu.indexOf("<ThemeToggle") && menu.indexOf("<ThemeToggle") < menu.indexOf("Reset demo"), "Reset demo is last in the menu, after the theme");
  assert.doesNotMatch(source("app/layout.tsx"), /Reset demo/, "no Reset demo button in the header row");
});

test("Task 18: the header says who is recording, once, and the name can be changed there", () => {
  const who = source("app/who.tsx"), actions = source("app/actions.ts");
  for (const s of [/Recording as/, /not you\?/, /Not signed in/, /set name/, /aria-invalid/, /aria-describedby/, /role="alert"/]) assert.match(who, s);
  assert.match(actions, /export async function setNameAction\([^)]*\)[^{]*\{[\s\S]*?checkName\([\s\S]*?rememberName\(/);
  // Fix round 3 (N1): only the name is cut short; "not you?" is its own flex item, at least 24 px.
  const css = source("app/globals.css");
  assert.match(css, /\.who-line \{ display: flex;/);
  assert.match(css, /\.who-line \.link \{ flex: none; min-height: 24px; min-width: 24px;/);
  assert.match(css, /\.who-name \{[^}]*text-overflow: ellipsis;/);
});

test("Task 18: on a phone the selected message comes before the queue, which folds to N messages; actions return to their result", () => {
  const review = source("app/review/page.tsx");
  assert.match(review, /className="panel" id="item"/);
  // Task 9: the panel comes first in the page order and the queue after it; the grid draws the queue beside it.
  assert.ok(review.indexOf('<nav className="queue"') > review.indexOf("{it ? <Item"), "queue after the panel in the page order");
  assert.match(source("app/globals.css"), /\.workspace\.item-first \{ grid-template-areas: "item" "preview" "queue"; \}/);
  assert.match(source("app/queue-fold.tsx"), /setOpen\(e\.matches\)/, "folds again when narrowed (N6)");
  assert.match(review, /<QueueFold count=\{todo\.length\}/);
  assert.match(review, /<QueueFold count=\{todo\.length\} noun="messages"/);
  assert.match(source("app/queue-fold.tsx"), /`\$\{count\} \$\{noun\}`/);
  const actions = source("app/actions.ts");
  assert.match(actions, /redirect\(`\/review\?\$\{[^`]*\}\$\{anchor\}`\)/);
  assert.match(actions, /const anchor = notice\.field \? "" :/, "no fragment for a name or field problem, so focus can go to the field");
  assert.match(actions, /redirect\(`\/review\?\$\{new URLSearchParams\(\{ item, \.\.\.signNotice\(\{ text: "Call logged\. Review it below\.", ok: true, on: "call" \}[^`]*\}#item`\)/, "a logged call lands on its message");
  const css = source("app/globals.css");
  assert.match(css, /\.overview \.needs, \.overview \.notice-slot, \.overview \.confirmed-card \{ order: -1; \}/, "the confirmed card and the attention card follow the heading (R13)");
  assert.match(css, /\.overview \.hero \{ order: -2; \}/, "the page heading stays above the attention card (N5)");
});

test("Task 18 round 2: the header stays one row on tablets, with the phone layout up to 1023 px", () => {
  const css = source("app/globals.css");
  assert.match(css, /@media \(min-width: 1024px\) \{\n  \.top \{ display: flex; flex-wrap: nowrap;/);
  assert.doesNotMatch(css.slice(css.indexOf("/* Frame"), css.indexOf(".page {")), /min-width: 761px/, "no header rule switches at 761 px");
});

test("Task 18 round 2: Orders puts the selected order first on phones and folds the list", () => {
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /className="workspace item-first"/);
  assert.ok(orders.indexOf('<nav className="queue"') > orders.indexOf("{o ? <Order"), "the order first in the page order, the list after it");
  assert.match(orders, /<QueueFold count=\{orders\.length\} noun="orders"/);
  assert.match(source("app/review/page.tsx"), /className="workspace item-first"/);
});

test("Task 18 fix round 3: the menu shows the full name with Change name, closes when focus leaves, and the logo is always named", () => {
  const nav = source("app/nav.tsx");
  assert.match(nav, /className="menu-who"/);
  assert.match(nav, />Change name</);
  assert.match(nav, /askName\(\)/);
  assert.match(source("app/dismiss.ts"), /addEventListener\("focusout", leave\)/);
  const css = source("app/globals.css"), wide = css.slice(css.indexOf("@media (min-width: 1024px) and (max-width: 1180px)"));
  assert.match(wide.slice(0, wide.indexOf("}\n}")), /\.brand-text \{ position: absolute; width: 1px;/, "visually hidden, still the link's name");
});

test("H2: the forecast tag shows the forecast amount, not the lot total", () => {
  const lb = (amount: number) => ({ amount, unit: "lb" as const });
  assert.equal(forecastTag({ expected: lb(20) }), "+20 lb expected");
  assert.equal(forecastTag({}), undefined, "no expected amount, no tag, never +0");
  assert.match(source("app/review/page.tsx"), /forecastTag\(c\)/);
  assert.match(source("app/pack/page.tsx"), /!\(g && orderStatus\(w, id\) === "short"\)/, "no Short chip beside \"X short\"");
});

// WCAG 2.x relative luminance and contrast ratio of two #rrggbb colours.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// The colour tokens of each theme, from the CSS custom properties: the light :root block, and
// the dark block (the explicit choice, which must match the device-following one).
function themes(css: string): Record<"light" | "dark", Map<string, string>> {
  const tokens = (block: string) => new Map([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1], m[2].toLowerCase()]));
  const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {"))));
  const block = (start: number) => css.slice(start, css.indexOf("}", start));
  const explicit = tokens(block(css.indexOf(':root[data-theme="dark"] {'))), device = tokens(block(css.indexOf(':root:not([data-theme="light"]) {')));
  assert.deepEqual(explicit, device, "both dark blocks set the same tokens");
  return { light, dark: new Map([...light, ...explicit]) };
}
// The token a rule's property reads, as var(--token).
function uses(css: string, selector: string, property: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  const rule = css.slice(at, css.indexOf("}", at)), m = rule.match(new RegExp(`(?:^|[;{ ])${property}:[^;]*var\\((--[\\w-]+)\\)`));
  assert.ok(m, `${selector} ${property}`);
  return m[1];
}

test("R14: field borders, the ready chip and the done chip pass contrast in both themes", () => {
  const css = source("app/globals.css"), t = themes(css);
  const border = uses(css, "input, select, textarea", "border"), fieldBg = uses(css, "input, select, textarea", "background");
  const ready = { fg: uses(css, ".chip.ready", "color"), bg: uses(css, ".chip.ready", "background") };
  const done = { fg: uses(css, ".chip.done", "color"), bg: uses(css, ".chip.done", "background") };
  for (const [name, c] of Object.entries(t)) {
    const v = (k: string) => { assert.ok(c.get(k), `${name} ${k}`); return c.get(k)!; };
    assert.ok(contrast(v(border), v(fieldBg)) >= 3, `${name}: field border ${contrast(v(border), v(fieldBg)).toFixed(2)}:1 on the field`);
    assert.ok(contrast(v(border), v("--surface")) >= 3, `${name}: field border on the panel`);
    assert.ok(contrast(v(ready.fg), v(ready.bg)) >= 4.5, `${name}: ready chip ${contrast(v(ready.fg), v(ready.bg)).toFixed(2)}:1`);
    assert.ok(contrast(v(done.fg), v(done.bg)) >= 4.5, `${name}: done chip ${contrast(v(done.fg), v(done.bg)).toFixed(2)}:1`);
    for (const other of ["--surface", "--surface-2", "--leaf-wash"]) assert.notEqual(v(done.bg), v(other), `${name}: the done chip has its own background, not ${other}`);
  }
});

test("Task 19: the Review tab names the grower whose message is open", () => {
  const review = source("app/review/page.tsx");
  assert.match(review, /export async function generateMetadata\(/);
  assert.match(review, /title: it \? `Review: \$\{grower\(it\.source\.growerId\)\}` : "Review updates"/);
  assert.doesNotMatch(review, /export const metadata/);
});

test("Task 19 (R5): the model's name and reading details stay off the main path, in the history, event page and export", () => {
  const review = source("app/review/page.tsx"), orders = source("app/orders/page.tsx");
  assert.match(review, /Read automatically\. Check the highlighted words\./);
  assert.doesNotMatch(review, /\{it\.interpretedBy\}/, "the reading label is not shown above the reading");
  assert.match(orders, />Suggest other wording</);
  for (const page of [review, orders]) assert.doesNotMatch(page.replace(/\/\/.*$/gm, ""), /Muse Spark|with Meta|Meta \(live\)|A recorded draft is available|No recorded draft/);
  assert.match(orders, /"Edited by you"/);
  assert.doesNotMatch(orders, /"Template"[^)]*chip|AUTHOR\[/, "no Template or model chip");
  assert.match(review, /function HistoryLine/);
  assert.match(review, /\{g\} replied\{q\(text\)\}/, "history reads as people's actions");
  assert.match(review, /<>Read automatically<\/>/, "history says only that it was read automatically");
  assert.match(review, /detail\("read automatically"\)/, "a reply too");
  assert.doesNotMatch(review.slice(review.indexOf("function HistoryLine")), /detail\(d\.note\)|read automatically: /, "no model, date or prompt version in the history");
  assert.match(orders, /No other wording passed the check\. The template stands\./);
  assert.doesNotMatch(orders, /Kept the template: \{r\.fallback\}/, "the reason is for the thread only");
  assert.doesNotMatch(orders.slice(orders.indexOf("function ReplyForm")), /who === "buyer"|decide=|prefill/, "ReplyForm has no buyer branches");
  assert.match(source("app/events/[id]/page.tsx"), /How it was read/);
  assert.match(source("app/lib/record.ts"), /inbox: w\.items/, "the export keeps each item's reading label and history");
  assert.match(source("src/seed.ts"), /`Muse Spark, recorded \$\{r\.recordedAt\.slice\(0, 10\)\}, prompt \$\{r\.promptVersion\}`/, "no nested parentheses");
});

test("Task 19 (R9): errors in plain words, beside their field, with names instead of IDs", () => {
  const actions = source("app/actions.ts"), review = source("app/review/page.tsx"), orders = source("app/orders/page.tsx");
  assert.match(actions, /"Supply changed since this was read\. Checking it again…"/);
  assert.doesNotMatch(actions + review, /Stale update; review/);
  assert.doesNotMatch(review, /related check/);
  assert.match(actions, /function withNames\(/);
  assert.doesNotMatch(orders, /\(\$\{d\.note\}\)/, "the thread no longer prints a note such as item-6");
  assert.match(orders, /function ThreadLine/);
  assert.match(source("app/lib/errors.ts"), /class FieldError extends Error/);
  // The review page uses the one shared helper (app/lib/field-error.tsx) instead of its own copy.
  assert.match(review, /from "\.\.\/lib\/field-error\.tsx"/);
  assert.match(orders, /from "\.\.\/lib\/field-error\.tsx"/);
  assert.doesNotMatch(orders, /"aria-invalid": true as const/, "the Orders page has no copy of the helper");
  for (const page of [source("app/lib/field-error.tsx")]) {
    assert.match(page, /"aria-invalid": true as const/);
    assert.match(page, /"aria-describedby": `/);
    assert.match(page, /className="field-error" role="alert"/);
  }
  for (const page of ["app/call/page.tsx", "app/pack/page.tsx"]) {
    assert.match(source(page), /from "\.\.\/lib\/field-error\.tsx"/, `${page} uses the shared helper`);
    assert.doesNotMatch(source(page), /"aria-invalid": true as const/, `${page} has no copy of the helper`);
  }
  for (const label of ["Not interpreted", "Needs refresh", "Can't be reviewed"]) assert.doesNotMatch(source("app/lib/format.ts"), new RegExp(`"${label}"`));
});

test("Task 19: after an action, focus moves to the result heading or the invalid field, and the result is announced politely", () => {
  const result = source("app/result.tsx");
  assert.match(result, /"use client"/);
  assert.match(result, /document\.getElementById\(focus\)\?\.focus\(\)/);
  assert.match(result, /role="status" aria-live="polite"/);
  const review = source("app/review/page.tsx"), orders = source("app/orders/page.tsx");
  assert.match(review, /<h1 id="msg" tabIndex=\{-1\}>/);
  assert.match(review, /<h2 id="change" tabIndex=\{-1\}>/, "Approve lands on #change, and focus goes to its heading");
  assert.match(review, /notice\?\.ok && notice\.on === "approve" \? \(notice\.res && conflicts\(w\.ledger\)\.some\(c => c\.lotId === notice\.res\) \? `cut-\$\{notice\.res\}-head` : "change"\)/);
  assert.match(orders, /<h3 id=\{`\$\{r\.id\}-title`\} tabIndex=\{-1\}>/);
  assert.match(orders, /<h1 id="order" tabIndex=\{-1\}>/);
  assert.match(source("app/actions.ts"), /notice = \{ text: step\.done, ok: true, on: step\.on, \.\.\.step\.after\?\.\(next!, item\) \};/);
});

test("Task 19 (R15): repeated buttons carry hidden context, and the 404 page leads back to Overview", () => {
  const orders = source("app/orders/page.tsx");
  assert.match(orders, /Draft message<span className="sr-only">/);
  assert.match(orders, /Send<span className="sr-only">/);
  assert.match(orders, /Record reply<span className="sr-only"> from \{to\}/);
  assert.match(source("app/page.tsx"), /Resolve\{hint && `: \$\{hint\}`\}<span className="sr-only"> \{buyer\(x\.g\.buyerId\)\}/);
  assert.match(source("app/globals.css"), /\.sr-only \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\);/);
  const missing = source("app/not-found.tsx");
  assert.match(missing, /href="\/"/);
  assert.match(missing, /Back to Overview/);
  assert.match(missing, /title: "Not found"/);
});

test("Task 21: Orders shows one pick first, folds the rest, and takes the buyer's answer in one tap", () => {
  const orders = source("app/orders/page.tsx"), actions = source("app/actions.ts");
  assert.match(orders, /recommend\(w, orderId/);
  assert.match(orders, /Other options \(\{rest\.length\}\)/);
  assert.match(orders, /name="accept" value="yes">They said yes/);
  assert.match(orders, /name="accept" value="no">They said no/);
  assert.match(actions, /quoteFor\(/);
});

test("Task 22 (R13): the Overview leads with work; the delivery-day counts come after buyer orders and supply", () => {
  const page = source("app/page.tsx"), at = (t: string) => page.indexOf(t, page.indexOf("export default async function Overview"));
  assert.ok(at('id="needs"') > 0 && at('id="needs"') < at('id="orders"') && at('id="orders"') < at("<SupplyCard") && at("<SupplyCard") < at("<DayCard"));
  assert.match(page, /Needs your attention/);
  assert.match(page, /and \{work\.length - shown\.length\} more/);
  assert.match(page, /x\.st\.label !== ORDER_STATUS\.short\.label/, "a short order says it is short once, not also as a chip");
});

test("Task 22 (R11): Pack confirms the plan, shows stages, makes Print primary and offers the day record", () => {
  const pack = source("app/pack/page.tsx"), sheets = source("src/pack.ts");
  assert.match(pack, /Confirmed by \{c\.confirmed\.by\} at \{time\(c\.confirmed\.at\)\}\./);
  for (const t of ["Confirm today's plan", "Confirm again", "Mark packed", "Mark handed off", "Not confirmed", "Changed since confirmed", "at confirm)"]) assert.ok(pack.includes(t), t);
  assert.doesNotMatch(pack, /Lock plan for packing|Lock again|Plan changed after locking/);
  assert.doesNotMatch(source("app/actions.ts"), /lockAction|lockPlan/);
  // Every new button sits inside a form.
  for (const label of ["Mark packed", "Mark handed off", "Confirm today's plan", "Confirm again", "Late grower message (demo)"]) {
    for (let at = pack.indexOf(label); at >= 0; at = pack.indexOf(label, at + 1)) {
      const open = pack.lastIndexOf("<form", at);
      assert.ok(open > 0 && pack.lastIndexOf("</form>", at) < open, `${label} at ${at} is inside a form`);
    }
  }
  // After Mark packed / Mark handed off, focus goes to that order's sheet heading, not the section's.
  assert.match(pack, /<h4 id=\{`sheet-\$\{s\.orderId\}`\} tabIndex=\{-1\}>/);
  assert.match(pack, /shown\.on === "stage" && shown\.res \? `sheet-\$\{shown\.res\}` : "sheets"/);
  assert.match(source("app/actions.ts"), /on: "stage", res: str\(f, "order"\)/);
  assert.match(pack, /Download day record/);
  assert.match(source("app/pack/print.tsx"), /className="primary"[\s\S]*Print sheets/);
  assert.match(pack, /HUB_NAME/);
  assert.match(pack, /Left over:/);
  assert.match(pack, /className="tick"/);
  assert.match(sheets, /deliveryOn/);
  assert.match(source("app/globals.css"), /\.sheet \{[^}]*break-before: page/, "each buyer and each grower starts a new page");
  assert.doesNotMatch(pack.slice(pack.indexOf("function Sheets")).replace(/\b(key|value|id)=\{[^}]*\}/g, ""), /\{\w+\.(orderId|lotId|growerId|buyerId)\}/, "no internal ID is printed");
});

test("Task 22 (R16): the event page reads as a sentence and keeps hashes, IDs and the model under Technical record", () => {
  const page = source("app/events/[id]/page.tsx"), tech = page.slice(page.indexOf("<details>")), head = page.slice(page.indexOf("return ("), page.indexOf("<details>"));
  assert.match(page, /<h1>\{where\}: \{what\}, approved by \{e\.approval\.reviewer\}<\/h1>/);
  for (const k of ["Technical record", "reviewHash", "beforeHash", "p.source.id", "How it was read"]) assert.ok(tech.includes(k), k);
  assert.doesNotMatch(head, /reviewHash|beforeHash|source\.id|source\.revision|Message read automatically/);
});

test("Task 22 (R18): quieter review controls", () => {
  const review = source("app/review/page.tsx");
  assert.match(review, /No change, dismiss/);
  assert.match(source("app/actions.ts"), /dismissNoChangeAction/);
  assert.match(review, /Done today \(\{done\.length\}\)/);
  assert.match(review, /aria-describedby=\{off \? "approve-why" : undefined\}/);
  assert.match(review, /Answer the open detail above to approve\./);
  assert.doesNotMatch(review, /Mark the lot as checked|Confirm lot|confirmLotAction/, "the lot check is gone from the page");
  assert.match(source("app/actions.ts"), /export async function confirmLotAction/, "its action stays, unused");
});

test("Task 23: reset clears the remembered name, and a dismissal offers the next update or the way back to Overview", () => {
  assert.match(source("app/actions.ts"), /await resetDemo\(\);\s*await forgetName\(\);/);
  assert.match(source("app/lib/name.ts"), /delete\(NAME_COOKIE\)/);
  const review = source("app/review/page.tsx");
  assert.match(review, /\(notice\.on === "hold" \|\| notice\.on === "dismiss"\) && it\.state === "dismissed"/);
  assert.match(review, /Back to Overview/);
  assert.doesNotMatch(review, /No more updates waiting/);
});

test("Final review: recording a buyer's consent or a new lot needs the header name, and the fallback note tells the cause", () => {
  const actions = source("app/actions.ts"), orders = source("app/orders/page.tsx");
  for (const name of ["buyerReplyAction", "supplyReplyAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`)).split(/\nexport async function /)[0];
    assert.match(body, /done: "Reply recorded\."/, name);
    assert.doesNotMatch(body, /anon: true/, name);
  }
  assert.match(orders, /failedTheCheck\(r\.fallback\)/);
  assert.match(orders, /Couldn't get other wording just now\. The template stands\./);
});

test("Task 4: the conflict panel is a fieldset with a legend, reports errors beside it, and its action goes through act", () => {
  const panel = source("app/conflict.tsx"), actions = source("app/actions.ts");
  assert.match(panel, /<fieldset/);
  assert.match(panel, /<legend>Who takes the cut\?<\/legend>/);
  assert.match(panel, /field-error/);
  assert.match(panel, /<Problem\b/);
  assert.match(panel, /Settle the cut/);
  assert.match(panel, /Everyone else's/);
  const body = actions.slice(actions.indexOf("export async function decideCutAction")).split(/\nexport async function /)[0];
  assert.match(body, /await act\(/);
  assert.match(body, /decideCut\(/);
  for (const page of ["app/orders/page.tsx", "app/pack/page.tsx", "app/review/page.tsx"]) assert.match(source(page), /<Conflicts\b/, page);
  assert.match(source("app/page.tsx"), /Promises to settle/);
});

test("a11y: order sheets name their columns, and a changed line's note can wrap", () => {
  const pack = source("app/pack/page.tsx"), css = source("app/globals.css");
  for (const col of ["Amount", "Product and grade", "Grower"]) assert.match(pack, new RegExp(`<th scope="col"[^>]*>${col}</th>`));
  assert.match(pack, /className="was muted small"/);
  assert.doesNotMatch(css, /\.sheet td\.num[^{]*\{[^}]*nowrap/, "the whole amount cell must not be forced onto one line");
});

test("a11y: Review's queue is not sticky in the middle widths, and an approval that opens a conflict says so", () => {
  const css = source("app/globals.css"), actions = source("app/actions.ts"), review = source("app/review/page.tsx");
  assert.match(css, /@media \(max-width: 1180px\) \{[\s\S]*?\.queue \{ position: static; \}/);
  assert.match(actions, /decide who takes the cut/);
  assert.match(review, /`cut-\$\{notice\.res\}-head`/);
  assert.match(source("app/conflict.tsx"), /<H id=\{`\$\{on\}-head`\} tabIndex=\{-1\}>/);
});

test("a11y: stage results name the buyer, the late-message link takes focus, a settled cut is not said twice", () => {
  assert.match(source("app/actions.ts"), /'s order is marked \$\{stage === "packed" \? "packed" : "handed off"\}\./);
  assert.match(source("app/pack/page.tsx"), /"late-link"/);
  assert.match(source("app/conflict.tsx"), /<Result key=\{sig\} text=\{undefined\}/);
});

test("a11y: a refused split keeps the choice and amounts, and says what was entered", () => {
  assert.match(source("app/actions.ts"), /splitTotalMessage\(sum, excess, unitOf\)/);
  assert.match(source("app/cut-choice.tsx"), /Split it: pounds each buyer gets less/);
});

test("Ease task 3: plain words on the review page, and the demo control sits in its own labelled box", () => {
  const review = source("app/review/page.tsx"), fields = source("app/value-fields.tsx"), css = source("app/globals.css");
  for (const banned of [/>Reading</, /Kind of update/, /Change preview/, /proposed allocation/, /Not worked out yet/, /A separate proposal/, /Unallocated/, /Mark the lot as checked/])
    assert.doesNotMatch(review + fields, banned);
  for (const label of ["What we understood", "What changed", "What changes", "Who gets what if you approve", "Needs your answer", "Not going to anyone yet", "Words in the reply that answer these (optional)", "Note this forecast"])
    assert.ok(review.includes(label), label);
  assert.equal(FIELD.operation, "What changed");
  assert.deepEqual(Object.values(OPERATION_CHOICE), ["A new total", "Added to what they have", "A correction", "A forecast, not confirmed"]);
  assert.match(review, /<div className="demo" role="group" aria-label="Demo"><span className="demo-tag">Demo<\/span>[\s\S]*?Receive the grower's reply \(demo\)/);
  assert.match(css, /\.demo \{[^}]*dashed/);
  for (const raw of Object.keys(OPERATION_CHOICE)) assert.notEqual(OPERATION[raw as keyof typeof OPERATION], raw, "the history says the plain name, not the token");
  assert.match(source("app/actions.ts"), /Forecast noted\. Confirmed supply is unchanged\./);
  assert.match(review, /Forecast noted/);
});

test("Ease task 3: the change line says before, after and by how much", () => {
  const lb = (amount: number) => ({ amount, unit: "lb" as const });
  assert.equal(changeLine(lb(120), lb(60)), "120 lb → 60 lb (down 60 lb)");
  assert.equal(changeLine(lb(40), lb(70)), "40 lb → 70 lb (up 30 lb)");
  assert.equal(changeLine(lb(40), lb(40)), "40 lb → 40 lb (no change)");
  assert.equal(changeLine({ amount: 2, unit: "kg" }, { amount: 1, unit: "kg" }), "2 kg → 1 kg (down 1 kg)");
});

test("Ease task 3: every review form that can be refused keeps what was typed", () => {
  const actions = source("app/actions.ts");
  for (const on of ["ask", "reply", "correct", "hold", "hand"]) assert.match(actions, new RegExp(`keep: "${on}"`), on);
  assert.match(actions, /back\(item, notice, step\.on, kept, returnPage/);
  assert.match(actions, /\.\.\.kept, \.\.\.signNotice\(notice/, "kept values sit beside the signed notice, not inside it");
});

test("Ease task 4: Orders wording, the one-step send, the single status chip and the Demo group", () => {
  const orders = source("app/orders/page.tsx"), actions = source("app/actions.ts"), cover = source("app/pending-cover.tsx"), conflict = source("app/conflict.tsx");
  assert.match(orders, /Substitutes this buyer accepts/);
  assert.match(orders, /None yet/);
  assert.doesNotMatch(orders, /Substitute permissions|>None</);
  assert.match(orders, /Sent by \{out\.sentBy\}, \{time\(out\.sentAt\)\}\. \(This demo records messages; it doesn't deliver them\.\)/);
  assert.doesNotMatch(orders, /Recorded as sent \(demo/);
  // The Next step sends in one step from an editable message; the other options still draft first.
  assert.match(orders, /<form action=\{sendNowAction\} className="option-card primary-card" noValidate>/);
  assert.match(orders, /<textarea name="body" required maxLength=\{480\} rows=\{4\} defaultValue=\{draft\}/);
  assert.doesNotMatch(orders, /Use this message/);
  assert.match(orders, /<form action=\{startResolutionAction\} className="option-card">/);
  assert.match(actions, /canSend\(next, r, hubDay\(now\(\)\)\)/, "the domain's own rule decides whether it can be sent");
  assert.match(actions, /sendMessage\(next, id, CONTACTS, who, now\(\)\)/);
  assert.match(actions, /keep: "send"/);
  // One status chip: how short, or the stage.
  assert.match(orders, /orderChip\(/);
  assert.equal((orders.match(/className=\{`chip \$\{st\.tone\}`\}>\{st\.label\}<\/span>\n        \{unsent/g) ?? []).length, 1);
  assert.doesNotMatch(orders, /STAGE\[/);
  // The buyer's answer: nothing prefilled, a call needs no note, and a refusal keeps what was typed.
  assert.doesNotMatch(orders, /BUYER_REPLIES|prefill=/);
  assert.match(actions, /keep: "buyer"/);
  assert.match(actions, /answerOf\(f, true\)/);
  // Demo-only control sits in the Demo group.
  assert.match(orders, /<details className="demo-tools"[^\n]*>\s*<summary>Demo tools<\/summary>[\s\S]*?className="demo" role="group" aria-label="Demo"><span className="demo-tag">Demo<\/span>\s*<form action=\{scriptedRequestReplyAction\}/);
  assert.match(cover, /waitingCover\(/);
  assert.match(conflict, /split=\{!sole\}/, "no Split with one promise");
});

test("Ease task 4: the order chip and the cover line", async () => {
  const { orderChip, coverLine } = await import("../app/lib/format.ts");
  assert.deepEqual(orderChip("short", "planned", 60, "lb"), { label: "Short 60 lb", tone: "block" });
  assert.equal(orderChip("resolving", "planned", 30, "lb").label, "Short 30 lb, waiting on reply");
  assert.equal(orderChip("buyer-told", "planned", 30, "lb").label, "Short 30 lb, buyer told");
  assert.equal(orderChip("covered", "promised", 0, "lb").label, "Promised");
  assert.equal(orderChip("substitute-agreed", "packed", 0, "lb").label, "Packed, substitute agreed");
  for (const st of ["covered", "short", "resolving", "buyer-told", "substitute-agreed"] as const) for (const stage of ["planned", "promised", "packed", "handed-off"] as const)
    assert.ok(!(/Short/.test(orderChip(st, stage, st === "covered" || st === "substitute-agreed" ? 0 : 5, "lb").label) && /Promised/.test(orderChip(st, stage, 5, "lb").label)), "never both Short and Promised");
  assert.equal(coverLine("Alder Creek Farm", 2), "Alder Creek Farm has 2 updates to review that may cover this.");
  assert.equal(coverLine("Alder Creek Farm", 1), "Alder Creek Farm has 1 update to review that may cover this.");
});

test("Task 5: the header tabs, the Overview's folded day details, all-clear card and in-place actions", () => {
  const nav = source("app/nav.tsx"), page = source("app/page.tsx"), css = source("app/globals.css");
  const tabs = nav.match(/const PAGES = \[(.*?)\] as const;/)![1];
  assert.deepEqual([...tabs.matchAll(/"([^"/][^"]*)"\]/g)].map(m => m[1]), ["Overview", "Review updates", "Orders", "Pack", "Log a call"]);
  assert.match(nav, /aria-current=\{here\(href\) \? "page" : undefined\}/, "every tab, Log a call included, marks its page");
  assert.doesNotMatch(page, /Open review workspace/);
  assert.match(page, /openAllLabel\(open\.length\)/, "a text link next to the heading, not a full-width bar");
  // The measures, gauge, donut and grower lots sit in one closed fold below Buyer orders; the export link stays out of it.
  const fold = page.indexOf('<details className="day-details">'), end = page.indexOf("</details>", fold);
  assert.ok(fold > page.indexOf('id="orders"') && page.indexOf("<summary>Day details</summary>") > fold);
  assert.ok(page.indexOf("<SupplyCard", fold) > fold && page.indexOf("<SupplyCard", fold) < end, "Supply against orders is inside the fold");
  assert.doesNotMatch(page.slice(fold, fold + 40), /open/);
  for (const t of ["<DayCard", "<Gauge", "<Donut", 'id="lots"']) assert.ok(page.indexOf(t, fold) > fold && page.indexOf(t, fold) < end, t);
  assert.ok(page.indexOf('href="/export"') < fold, "the export link stays visible, in the hero line");
  for (const t of ["confirmLead(gaps.length > 0", "Plan confirmed by", "Mark all packed", "Mark all handed off", "Print sheets", "Confirm again", "New since you confirmed", "since you confirmed", "reviewCoverLink(grower(cover.growerId)", "Review it"]) assert.ok(page.includes(t), t);
  // Approve and Dismiss post from the Overview and come back to it; Confirm too.
  assert.match(page, /action=\{approveAction\}[\s\S]*?name="hash" value=\{ready\.reviewHash\}/);
  assert.match(page, /action=\{dismissNoChangeAction\}/);
  assert.match(page, /updateKind\(i, p\)/, "Dismiss only on a message that names no lot or no amount");
  assert.match(page, /action=\{confirmAction\}/);
  assert.match(source("app/actions.ts"), /returnPage\(str\(f, "from"\)\)/);
  // A phone sees one card per buyer, and focus lands on the page heading after Reset demo.
  assert.match(css, /@media \(max-width: 600px\) \{\s*table\.buyers/);
  assert.match(page, /<h1 id="hub" tabIndex=\{-1\}>/);
  assert.match(source("app/actions.ts"), /on: "reset"/);
});

test("Task 6: the gate wording, Ship short checkbox, mark all, demo group and print rules", () => {
  const pack = source("app/pack/page.tsx"), css = source("app/globals.css"), domain = source("src/commitments.ts");
  assert.ok(domain.includes("Orders still to resolve: ${blocking.join(\", \")}. Resolve them, or tick “Ship these orders short” to confirm anyway."));
  assert.match(pack, /\{SHIP_SHORT\} without telling the buyer/);
  assert.equal(SHIP_SHORT, "Ship these orders short");
  assert.match(source("app/lib/view.ts"), /Sheets printed from the plan confirmed at \$\{time\(at\)\} are wrong for:/, "dated by the confirm, not the page load");
  for (const t of ["Mark all packed", "Mark all handed off", "arrivedLead(arrived)", "staleSentence(w, cutOpen)", "Confirmed by {c.confirmed.by}", "STALE_HEADING"]) assert.ok(pack.includes(t), t);
  assert.match(pack, /<details className="demo-tools no-print"[\s\S]*<summary>Demo tools<\/summary>[\s\S]*Late grower message \(demo\)/, "demo controls sit in one closed fold at the foot");
  assert.match(pack, /<PrintButton primary=\{!stale && arrived === 0\} \/>/);
  const print = css.slice(css.indexOf("@media print"), css.indexOf("@media (max-width: 1180px)"));
  assert.doesNotMatch(print, /\.sheets \.card-head/, "the buyer name's header is not hidden in print");
  assert.match(print, /\.sheets > \.card-head, \.sheets > h3 \{ display: none; \}/, "only the page's own heading is hidden");
  assert.match(print, /\.sheet-grid \{ display: block; \}/, "block layout, not the grid");
  assert.match(print, /\.sheet \{[^}]*break-before: page/);
  assert.match(print, /\.sheet:first-child \{ break-before: auto/);
  assert.match(css, /@media \(max-width: 600px\) \{\s*button, \.button, \.menu-button, \.who-line \.link, \.menu-who \.link \{ min-height: 44px; \}/);
  assert.doesNotMatch(css, /\.sheet td \{ overflow-wrap: anywhere; vertical-align/, "desktop order-sheet columns do not split words");
});

test("Task 10: Overview and Pack wording and structure", () => {
  const page = source("app/page.tsx"), pack = source("app/pack/page.tsx"), actions = source("app/actions.ts");
  assert.doesNotMatch(page, /Allocation is a proposal/);
  assert.match(page, /\{open\.length > 0 && <a className="open-all" href="\/review">\{openAllLabel/, "a text link, hidden with nothing to review");
  assert.doesNotMatch(page, /bar-action/);
  assert.match(page, /<a className="button" href=\{resolve\}>\{resolveLabel\}/, "Resolve is a secondary button beside a Review button");
  assert.ok(page.indexOf('aria-label="Plan confirmed"') < page.indexOf('id="needs"'), "the confirmed card comes before Needs your attention");
  assert.match(page, /Plan confirmed by \{c\.confirmed\.by\} at \{time\(c\.confirmed\.at\)\}/);
  assert.equal(page.split("Plan confirmed by").length, 2, "said once");
  assert.match(page, /\{counts2\.packed\} of \{counts2\.total\} packed, \{counts2\.handed\} of \{counts2\.total\} handed off/);
  assert.match(page, /href="\/pack\?print=1"/);
  assert.match(page, /unsettledLine\(warnings\.length\)/, "same line as Pack");
  assert.match(pack, /unsettledFor\(/);
  assert.match(pack, /Show checklist/);
  assert.match(pack, /\/review\?item=\$\{encodeURIComponent\(fresh\[0\]\.id\)\}/, "the arrived-messages link goes to the first one");
  assert.match(pack, /<AutoPrint \/>/);
  assert.match(actions, /text: home \? "Confirmed\. Pack and hand off below\."/, "the result does not repeat the card's words");
});
