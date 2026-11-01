import test from "node:test";
import assert from "node:assert/strict";
import { checkName } from "../app/lib/names.ts";
import { cutPage, readNotice, signNotice } from "../app/lib/notice.ts";
import { KEEP, keepTyped, readKept } from "../app/lib/kept.ts";
import { QUOTE_MAX, numberSpan, pickQuote } from "../app/lib/quote.ts";

// Pure app helpers: the remembered-name rules and the signed page notices.
test("names: trimmed, NFC, at most 80 characters, no hidden characters, not the reserved label", () => {
  assert.deepEqual(checkName("  Hub coordinator "), { name: "Hub coordinator" });
  assert.deepEqual(checkName("Jose\u0301"), { name: "Jos\u00e9" });
  assert.deepEqual(checkName(""), { problem: "empty" });
  assert.deepEqual(checkName(undefined), { problem: "empty" });
  assert.deepEqual(checkName("x".repeat(81)), { problem: "long" });
  for (const hidden of ["Hub\u200bcoordinator", "Hub\u2028x", "Hub\u2029x", "Hub\u0007x", "\u202eHub"]) assert.deepEqual(checkName(hidden), { problem: "hidden" });
  for (const reserved of ["Coordinator", " coordinator "]) assert.deepEqual(checkName(reserved), { problem: "reserved" });
});

test("Task 19: a name needs a letter or number, and look-alikes of the reserved label are refused", () => {
  for (const none of ["...", "-", "!!", "\u00b7 \u00b7", "\u{1F600}"]) assert.deepEqual(checkName(none), { problem: "symbols" }, JSON.stringify(none));
  for (const ok of ["Hub coordinator", "Coordinator Lee", "Ana", "\u674e\u5a1c", "7"]) assert.ok("name" in checkName(ok), ok);
  const lookAlikes = ["Coordinator.", "Coordinator!", "coordinator ?", "\u0421oordinator", "C\u043eordinat\u043er", "Co\u03bfrdinator", "Coord\u0456nator",
    "\uff23\uff4f\uff4f\uff52\uff44\uff49\uff4e\uff41\uff54\uff4f\uff52", "Co-ordinator", "Co\u00f6rdinator", "COORDINATOR", "Coordin\u0430t\u043er", "Coordina\u0442or", "Coordinator\u2026"];
  for (const r of lookAlikes) assert.deepEqual(checkName(r), { problem: "reserved" }, JSON.stringify(r));
});

const PLACE = { page: "/review", id: "item-2" };
test("notices: only text the server signed is shown, only on its own page and item, and only for a while", () => {
  const params = signNotice({ text: "Enter your name to approve.", on: "approve", field: "who" }, PLACE, 1000);
  assert.deepEqual(readNotice(params, PLACE, 2000), { text: "Enter your name to approve.", on: "approve", field: "who" });
  assert.equal(readNotice({ ...params, msg: "Call this number to fix your account" }, PLACE, 2000), undefined, "a link cannot choose the text");
  assert.equal(readNotice({ ...params, on: "send" }, PLACE, 2000), undefined);
  assert.equal(readNotice({ msg: "Anything" }, PLACE, 2000), undefined);
  assert.equal(readNotice(params, PLACE, 1000 + 11 * 60_000), undefined, "expired");
  assert.equal(readNotice(params, { page: "/orders", id: "item-2" }, 2000), undefined, "not on another page");
  assert.equal(readNotice(params, { page: "/review", id: "item-3" }, 2000), undefined, "not beside another item");
  assert.equal(readNotice(params, { page: "/review" }, 2000), undefined);
  const done = signNotice({ text: "Supply change approved.", ok: true }, PLACE, 1000);
  assert.deepEqual(readNotice(done, PLACE, 2000), { text: "Supply change approved.", ok: true }, "a result, announced as one");
  assert.ok("msg" in done && !("error" in done), "the notice travels as msg");
  const { ok: _, ...asError } = done;
  assert.equal(readNotice(asError, PLACE, 2000), undefined, "a result can't be replayed as an error, or the reverse");
});

test("notices: long text is cut by whole characters, never inside one", () => {
  const text = "\u{1F955}".repeat(700), params = signNotice({ text }, PLACE, 1000);
  assert.equal(Array.from(params.msg).length, 600);
  assert.equal(params.msg, "\u{1F955}".repeat(600), "no lone surrogate at the end");
  assert.equal(readNotice(params, PLACE, 2000)?.text, params.msg, "a cut notice still reads back");
});

test("cutPage: only the allowlist's own pages are honoured; inherited keys fall back to Orders", () => {
  assert.deepEqual(cutPage("/pack"), { page: "/pack", key: "" });
  assert.deepEqual(cutPage("/review"), { page: "/review", key: "item" });
  for (const p of ["constructor", "toString", "__proto__", "hasOwnProperty", "https://x.test", ""]) assert.deepEqual(cutPage(p), { page: "/orders", key: "order" }, p);
});

test("act refuses a stale version with the latest change, and with rebase runs on the current state", async () => {
  const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  process.env.HARVEST_DB = join(mkdtempSync(join(tmpdir(), "hr-act-")), "w.db");
  const { act, current, StaleView } = await import("../app/lib/hub.ts");
  const { receive } = await import("../src/workbench.ts");
  const start = (await current()).version, src = (id: string) => ({ id, revision: 1, growerId: "grower-a", text: "Cucumbers." });
  await act(start, w => receive(w, src("m-1"), "2026-10-28T09:00:00Z"));
  const now = await current(), n = now.state.items.length;
  await assert.rejects(act(start, w => receive(w, src("m-2"), "2026-10-28T09:05:00Z")), (e: Error) => e instanceof StaleView && /^Something changed in another tab or window: .+\. Check the page and try again\.$/.test(e.message));
  assert.equal((await current()).state.items.length, n);
  let seen = -1;
  await act(start, w => { seen = w.items.length; return receive(w, src("m-3"), "2026-10-28T09:10:00Z"); }, { rebase: true });
  assert.equal(seen, n, "f received the current state, not the one the page showed");
  assert.equal((await current()).state.items.length, n + 1);
});

test("quote picker: the literal span with the value's number and its unit word, else the whole reply, never words of its own", () => {
  const reply = "That's the whole lot, 10 lb in each case.";
  assert.equal(pickQuote(reply, "10 lb"), "10 lb");
  assert.equal(pickQuote("6lb each", "6 lb"), "6lb");
  assert.equal(pickQuote("We have 1,200 lb and 12 cases", "1200 lb"), "1,200 lb");
  assert.equal(pickQuote("Delivery 2026-10-30, 4 cases", "2026-10-30"), "Delivery 2026-10-30, 4 cases", "a date value looks for no number");
  assert.equal(pickQuote("We have 120 lb", "12 lb"), "We have 120 lb", "12 is not inside 120");
  assert.equal(pickQuote("Sorry, none left", "A new total"), "Sorry, none left", "no number: the whole reply");
  assert.equal(pickQuote("Friday works", "2026-10-30"), "Friday works", "a date's digits are not in the reply");
  assert.equal(numberSpan("no digits here", "5 lb"), undefined);
  const long = ("word ".repeat(200)).trim();
  for (const [text, value] of [[reply, "10 lb"], [reply, "standard"], [long, "x"], ["a 5 b 50 c", "50 lb"], ["é 7 ü", "7 lb"], ["", "3"]] as const) {
    const q = pickQuote(text, value);
    assert.ok(text.includes(q), `a literal part of the reply: ${JSON.stringify(q)}`);
    assert.ok(q.length <= QUOTE_MAX || q === text);
  }
  assert.ok(pickQuote(long, "x").length <= QUOTE_MAX, "a long reply gives a bounded stretch of its own words");
});

test("kept values: typed text round trips through the redirect, cut to each field's limit, and is not part of the signed notice", () => {
  const f = new FormData();
  f.set("reply", "Line one\nLine two, “quoted” & more"); f.set("field", "quantity"); f.set("value", "x".repeat(5000)); f.set("quote", "  "); f.set("who", "Someone");
  const kept = keepTyped(f, "reply");
  assert.deepEqual(Object.keys(kept).sort(), ["k_reply_field", "k_reply_reply", "k_reply_value"], "blank and unlisted fields are dropped");
  const q = new URLSearchParams({ item: "item-1", ...kept, ...signNotice({ text: "Enter the value.", on: "reply", field: "value" }, { page: "/review", id: "item-1" }) });
  const back = Object.fromEntries(new URLSearchParams(q.toString()));
  assert.equal(readKept(back, "reply", "reply"), "Line one\nLine two, “quoted” & more");
  assert.equal(readKept(back, "reply", "value")?.length, KEEP.reply.value, "cut to the field's own limit");
  assert.equal(readKept(back, "reply", "quote"), undefined);
  assert.equal(readKept(back, "ask", "question"), undefined, "another form's values are not read");
  assert.equal(readKept({ ...back, k_reply_who: "x" }, "reply", "who"), undefined, "only the form's own fields");
  const plain = readNotice(back, { page: "/review", id: "item-1" });
  assert.equal(plain?.text, "Enter the value.", "the notice still verifies with kept values beside it");
  assert.equal(readNotice({ ...back, k_reply_value: "changed" }, { page: "/review", id: "item-1" })?.text, "Enter the value.", "kept values are display-only");
});

// Task 5: the Overview's new-since-confirm count, the ready test and the return page.
import { becomesShort, dismissable, newSinceConfirm, readyToApprove } from "../app/lib/view.ts";
import { returnPage } from "../app/lib/notice.ts";
import type { InboxItem, Preview, Workbench } from "../src/workbench.ts";

const item = (id: string, receivedAt: string, state: string = "open") => ({ id, receivedAt, state }) as unknown as InboxItem;
const bench = (confirmedAt: string | undefined, items: InboxItem[]) =>
  ({ items, ledger: { commitments: confirmedAt ? { confirmed: { at: confirmedAt } } : undefined } }) as unknown as Workbench;

test("Task 5: newSinceConfirm counts unread messages that arrived after the latest confirm", () => {
  const items = [item("a", "2026-11-02T09:00:00.000Z"), item("b", "2026-11-02T11:00:00.000Z"), item("c", "2026-11-02T12:00:00.000Z", "approved"), item("d", "2026-11-02T13:00:00.000Z", "dismissed")];
  assert.deepEqual(newSinceConfirm(bench("2026-11-02T10:00:00.000Z", items)).map(i => i.id), ["b"]);
  assert.equal(newSinceConfirm(bench("2026-11-02T08:00:00.000Z", items)).length, 2, "approved and dismissed messages are not new");
  assert.equal(newSinceConfirm(bench("2026-11-02T14:00:00.000Z", items)).length, 0);
  assert.equal(newSinceConfirm(bench(undefined, items)).length, 0, "before a confirm nothing is new since it");
});

test("Task 5: only a current, fully answered review can be approved from the Overview, and becomesShort lists who gets shorter", () => {
  const change = { effect: "replace-total", lotId: "lot-1", before: { amount: 1, unit: "lb" }, after: { amount: 2, unit: "lb" } };
  const p = (over: object) => ({ stale: false, needsRefresh: false, questions: [], change, reviewHash: "h", orders: [], unallocated: [], ...over }) as unknown as Preview;
  const read = { proposal: {} } as unknown as InboxItem;
  assert.equal(readyToApprove(read, p({})), true);
  assert.equal(readyToApprove({} as InboxItem, p({})), false, "no reading");
  for (const over of [{ questions: [{ field: "quantity" }] }, { error: "x" }, { needsRefresh: true }, { change: undefined }, { reviewHash: undefined }]) assert.equal(readyToApprove(read, p(over)), false, JSON.stringify(over));
  const o = (orderId: string, before: number, after: number) => ({ orderId, unit: "lb", requested: 9, before: { direct: 0, substitute: 0, short: before }, after: { direct: 0, substitute: 0, short: after } });
  assert.deepEqual(becomesShort(p({ orders: [o("x", 0, 5), o("y", 5, 2), o("z", 3, 3), o("w", 2, 4)] })).map(x => x.orderId), ["x", "w"]);
});

test("Task 5: an action can return only to the Overview", () => {
  assert.equal(returnPage("/"), "/");
  for (const other of ["", "/review", "//evil.example", "https://evil.example", "constructor", "__proto__"]) assert.equal(returnPage(other), undefined, other);
});

test("Task 5: only a message read as no supply change is dismissable from the Overview; an unread one never is", () => {
  assert.equal(dismissable({ proposal: undefined } as unknown as InboxItem), false, "unread: link to Review instead");
  assert.equal(dismissable({ proposal: { interpretation: { operation: "unresolved" } } } as unknown as InboxItem), true);
  assert.equal(dismissable({ proposal: { interpretation: { operation: "replace-total" } } } as unknown as InboxItem), false);
});
