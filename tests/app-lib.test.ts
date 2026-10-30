import test from "node:test";
import assert from "node:assert/strict";
import { checkName } from "../app/lib/names.ts";
import { cutPage, readNotice, signNotice } from "../app/lib/notice.ts";

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
