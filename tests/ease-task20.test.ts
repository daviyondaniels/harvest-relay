import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const source = (p: string) => readFileSync(join(root, p), "utf8");
const files = (dir: string): string[] => readdirSync(join(root, dir)).flatMap(n => {
  const rel = `${dir}/${n}`;
  return statSync(join(root, rel)).isDirectory() ? files(rel) : rel.endsWith(".tsx") ? [rel] : [];
});

// The browser's own validation bubble would hide the app's message beside the field, so a form with a
// required field says noValidate and the server names the field at fault.
test("every form with a required field has noValidate", () => {
  const bad: string[] = [];
  for (const f of files("app")) {
    const src = source(f);
    let at = src.indexOf("<form");
    while (at >= 0) {
      const end = src.indexOf("</form>", at), body = src.slice(at, end < 0 ? undefined : end);
      const tag = body.slice(0, body.search(/[^=]>/) + 1);
      const needs = /\brequired\b/.test(body) || /<(ValueFields|AnswerFields)\b/.test(body);
      if (needs && !/\bnoValidate\b/.test(tag)) bad.push(`${f}: ${tag.slice(0, 80)}`);
      at = src.indexOf("<form", at + 5);
    }
  }
  assert.deepEqual(bad, []);
  // The name field is checked by the server, not by the browser.
  assert.doesNotMatch(source("app/named-submit.tsx"), /<input name="who" required/);
});

test("the preview sits in the form above its button, and the form carries the hash of the preview", () => {
  const review = source("app/review/page.tsx"), fields = source("app/value-fields.tsx"), actions = source("app/actions.ts");
  assert.match(review, /\{shown && <input type="hidden" name="shown" value=\{shown\} \/>\}\s*\{outcome\}\s*<div className="row">/);
  assert.match(fields, /\{shown && <input type="hidden" name="shown" value=\{shown\} \/>\}\s*\{preview\}\s*<div className="row">/);
  assert.match(actions, /shown = str\(f, "shown"\) \|\| undefined/);
  assert.match(actions, /You changed the details, so check the change below, then approve\./);
  assert.match(review, /id="approve-button"/);
});

test("copy: a pre-filled hand form says to check and save; the empty form says to enter the details", () => {
  const review = source("app/review/page.tsx");
  assert.match(review, /start\?\.complete \? "Check the details below, then save and approve\."/);
  assert.match(review, /filled \? "Check the details below, then save and approve\." : "Enter the details below"/);
  assert.match(review, /className=\{filled \? "tag" : "tag blocked"\}/);
  assert.match(review, /className=\{p\.questions\.length && !p\.error \? "tag" : "tag blocked"\}/, "the waiting state is neutral");
});

test("a refused name fills only the name field of the form it was typed in", async () => {
  const { keepWho, keptWho, KEPT_WHO, KEPT_WHO_ON } = await import("../app/lib/kept.ts");
  const f = new FormData();
  f.set("who", "  Sam "); f.set("who_on", "stage-order-b");
  const kept = keepWho(f);
  assert.deepEqual(kept, { [KEPT_WHO]: "Sam", [KEPT_WHO_ON]: "stage-order-b" });
  const p = new URLSearchParams(kept);
  assert.equal(keptWho(p, "stage-order-b"), "Sam");
  assert.equal(keptWho(p, "stage-order-a"), undefined, "another form's field stays empty");
  assert.equal(keptWho(p, "lock"), undefined);
  assert.equal(keptWho(new URLSearchParams({ [KEPT_WHO]: "Sam" }), "lock"), undefined, "a name with no form fills none");
  assert.match(source("app/named-submit.tsx"), /<input type="hidden" name="who_on" value=\{on\} \/>/);
  assert.match(source("app/named-submit.tsx"), /keptWho\(useSearchParams\(\), on\)/);
});

test("every refusal redirect keeps the typed name, including Pack confirm", () => {
  const actions = source("app/actions.ts");
  const body = (name: string) => { const at = actions.indexOf(`export async function ${name}`); return actions.slice(at, actions.indexOf("\nexport ", at + 10) < 0 ? undefined : actions.indexOf("\nexport ", at + 10)); };
  for (const name of ["confirmAction", "lateMessageAction", "stageAction", "stageAllAction", "decideCutAction", "museDraftAction", "logCallAction"])
    assert.match(body(name), /keepWho\(f\)/, `${name} keeps the name`);
  assert.match(actions, /\.\.\.keepWho\(f\)/);
});

test("the result names each buyer whose shortfall changed, and says no buyer changes only when none did", async () => {
  const { buyerChanges } = await import("../app/lib/result.ts");
  const riverbend = { orderId: "o1", buyerId: "riverbend", short: 30, unit: "lb" as const };
  const before = new Map([["o1", 60]]);
  const reduced = buyerChanges(before, [riverbend]);
  assert.equal(reduced.changed, true);
  assert.equal(reduced.lines.length, 1);
  assert.match(reduced.lines[0], /is now 30 lb short \(was 60 lb\)\.$/);
  assert.deepEqual(buyerChanges(new Map([["o1", 30]]), [riverbend]), { lines: [], changed: false });
  assert.equal(buyerChanges(new Map([["o1", 30]]), []).changed, true, "a buyer now covered is a change");
  assert.equal(buyerChanges(new Map(), [riverbend]).changed, true, "a buyer newly short is a change");
  assert.deepEqual(buyerChanges(new Map(), []), { lines: [], changed: false });
});

test("the Orders short row, the sent link and the card notes use the agreed wording", () => {
  const orders = source("app/orders/page.tsx"), cover = source("app/pending-cover.tsx");
  assert.match(cover, /waitingCover\(/); assert.match(cover, /reviewCoverLink\(/);
  assert.match(orders, /Message to \{open\.facts\.to\.name\}, sent, waiting on the answer/);
  const head = orders.slice(orders.indexOf('<h1 id="order"'), orders.indexOf('<p className="lot">'));
  assert.doesNotMatch(head, /Recorded only; nothing is delivered/);
  assert.doesNotMatch(head, /NOT_PROMISED|Not promised/);
  assert.match(orders, /<h2 id="drafts">Messages<\/h2>\s*<p className="muted small">Recorded only; nothing is delivered\.<\/p>/);
  assert.equal((orders.match(/\{NOT_PROMISED\}/g) ?? []).length, 1, "said once, beside the planned amount");
});
