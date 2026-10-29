import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A message shown on the page after an action: its text, and the control it belongs to, or
// (ok) the result of an action that worked. It travels in the redirect URL, signed with a key
// that lives only in this server process, so a link can never put chosen text beside a
// control. The signature also covers the page and the item or order it was written for, so
// a notice can't be moved to another page or shown beside another item. Notices expire after
// ten minutes, and a restart forgets the key, which only hides old notices.
export type Notice = { text: string; on?: string; res?: string; field?: string; ok?: boolean };
// Where a notice is shown: the page's path, and the item or order the page has open.
export type Place = { page: string; id?: string };
type Params = Record<string, string | string[] | undefined>;
const MAX_AGE = 10 * 60_000, MAX_TEXT = 600;
const store = globalThis as { __hrNoticeKey?: Buffer };
const key = () => (store.__hrNoticeKey ??= randomBytes(32));
const mac = (n: Notice, place: Place, at: string) => createHmac("sha256", key())
  .update(JSON.stringify([n.text, n.on ?? "", n.res ?? "", n.field ?? "", n.ok ? "ok" : "", place.page, place.id ?? "", at])).digest("base64url");
// Cut by code point, so a cut never splits a character in two.
const cut = (s: string) => Array.from(s).slice(0, MAX_TEXT).join("");

export function signNotice(n: Notice, place: Place, now = Date.now()): Record<string, string> {
  const text = cut(n.text), at = String(now), signed = { ...n, text };
  return { msg: text, ...(n.on ? { on: n.on } : {}), ...(n.res ? { res: n.res } : {}), ...(n.field ? { field: n.field } : {}), ...(n.ok ? { ok: "1" } : {}), at, sig: mac(signed, place, at) };
}
export function readNotice(p: Params, place: Place, now = Date.now()): Notice | undefined {
  const one = (k: string) => typeof p[k] === "string" ? p[k] as string : undefined;
  const text = one("msg"), at = one("at"), sig = one("sig");
  if (!text || !at || !sig || text.length > 2 * MAX_TEXT || Array.from(text).length > MAX_TEXT || !/^\d{1,16}$/.test(at)) return undefined;
  const age = now - Number(at);
  if (age < 0 || age > MAX_AGE) return undefined;
  const n: Notice = { text, ...(one("on") ? { on: one("on") } : {}), ...(one("res") ? { res: one("res") } : {}), ...(one("field") ? { field: one("field") } : {}), ...(one("ok") === "1" ? { ok: true } : {}) };
  const want = Buffer.from(mac(n, place, at)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? n : undefined;
}
