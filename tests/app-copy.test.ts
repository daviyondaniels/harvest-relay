import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forecastTag } from "../app/lib/format.ts";

// The app's own words, checked where a unit test cannot render the page.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("I2: the measures card says what was counted, not that each count resolved an order", () => {
  const page = source("app/page.tsx");
  assert.doesNotMatch(page, /covered by a grower|"buyers? told"/, "a corrected notice to one buyer would read as two buyers told");
  for (const label of ["grower asks that added supply", "substitutes agreed", "shortfall notices sent", "shipped short"]) assert.match(page, new RegExp(label));
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
  assert.match(page, /nothing is delivered/);
});

test("Task 17: the approver name is asked for beside its field and remembered in a strict, HttpOnly cookie", () => {
  const actions = source("app/actions.ts"), name = source("app/lib/name.ts");
  assert.match(actions, /"Enter your name at the top to continue\."/, "fix round 3: the name is asked once, in the header");
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

test("Fix round 1 / Task 18 fix 3: forms that record a name rely on the header name and are refused without it", () => {
  const review = source("app/review/page.tsx"), orders = source("app/orders/page.tsx"), actions = source("app/actions.ts");
  for (const page of [review, orders]) {
    assert.doesNotMatch(page, /Recorder|name="who"/, "no per-form name field");
    assert.match(page, /notice\?\.field === "who" && <NameNeeded key=\{String\(params\.sig\)\} text=\{notice\.text\} \/>/);
  }
  assert.match(actions, /async function named\(\): Promise<string> \{[\s\S]*?if \(!kept\) throw new NameNeeded\(NAME_AT_TOP\);/);
  for (const fn of ["stageAction", "confirmAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`)).split(/\nexport /)[0];
    assert.match(body, /await named\(\)/, `${fn} records a person's name`);
    assert.doesNotMatch(body, /await actor\(\)/, `${fn} never falls back to the reserved name`);
    assert.match(body, /instanceof NameNeeded/, `${fn} sends a missing name to the header field`);
  }
  assert.match(source("app/pack/page.tsx"), /field === "who" && <NameNeeded/);
  assert.match(actions, /resId && notice\?\.field !== "who"/, "a name refusal on Orders lands at the top, by the header field");
  assert.match(source("app/who.tsx"), /window\.addEventListener\(ASK_NAME/);
  assert.match(orders, /name="words"/, "confirm posts the words shown");
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
  assert.match(layout, /className="skip" href="#main"/);
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
  assert.ok(menu.indexOf("Log a call") < menu.indexOf("<ThemeToggle") && menu.indexOf("<ThemeToggle") < menu.indexOf("Reset demo"), "Reset demo is last in the menu, after the theme");
  assert.doesNotMatch(source("app/layout.tsx"), /Reset demo/, "no Reset demo button in the header row");
});

test("Task 18: the header says who is recording, once, and the name can be changed there", () => {
  const who = source("app/who.tsx"), actions = source("app/actions.ts");
  for (const s of [/Recording as/, /not you\?/, /Who is working\?/, /aria-invalid/, /aria-describedby/, /role="alert"/]) assert.match(who, s);
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
  // Fix round 3 (N4): the list comes first in the page order, as drawn from 761 px; only the
  // phone grid places the item first.
  assert.ok(review.indexOf('<nav className="queue"') < review.indexOf("{it ? <Item"), "queue first in the page order");
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
  assert.match(css, /\.overview \.needs \{ order: -1; \}/, "the attention card follows the heading (R13)");
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
  assert.ok(orders.indexOf('<nav className="queue"') < orders.indexOf("{o ? <Order"), "list first in the page order; the phone grid puts the order first");
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
  assert.equal(forecastTag({ effect: "forecast", lotId: "lot-d", before: lb(40), after: lb(40), expected: lb(20) }), "+20 lb expected");
  assert.equal(forecastTag({ effect: "forecast", lotId: "lot-d", before: lb(40), after: lb(40) }), undefined, "no expected amount, no tag, never +0");
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
  assert.match(actions, /class FieldError extends Error/);
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
  assert.match(source("app/page.tsx"), /Resolve<span className="sr-only"> \{buyer\(x\.g\.buyerId\)\}/);
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
  assert.match(review, /Approving does not need it\./, "Confirm lot is explained");
  assert.doesNotMatch(review, /<div className="row">\s*\{hasScript[\s\S]{0,400}Confirm lot/, "Confirm lot is off the main row");
});

test("Task 23: reset clears the remembered name, and a dismissal offers the next update or the way back to Overview", () => {
  assert.match(source("app/actions.ts"), /await resetDemo\(\);\s*await forgetName\(\);/);
  assert.match(source("app/lib/name.ts"), /delete\(NAME_COOKIE\)/);
  const review = source("app/review/page.tsx");
  assert.match(review, /notice\.on === "hold" && it\.state === "dismissed"/);
  assert.match(review, /Back to Overview/);
  assert.doesNotMatch(review, /No more updates waiting/);
});

test("Final review: recording a buyer's consent or a new lot needs the header name, and the fallback note tells the cause", () => {
  const actions = source("app/actions.ts"), orders = source("app/orders/page.tsx");
  for (const name of ["buyerReplyAction", "supplyReplyAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`)).split(/\nexport async function /)[0];
    assert.match(body, /done: "Reply recorded\.", named: true/, name);
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
  for (const col of ["Amount", "Product and grade", "Grower"]) assert.match(pack, new RegExp(`<th scope="col">${col}</th>`));
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
  assert.match(source("app/actions.ts"), /You entered \$\{sum\} lb; the cuts must total \$\{excess\} lb\./);
  assert.match(source("app/conflict.tsx"), /amount to cut if splitting/);
});
