import { NAME_MAX } from "../../src/hub.ts";
import { FieldError } from "./errors.ts";

// The rules for a coordinator's name, typed or read back from the remembered cookie. Pure,
// so the same rules hold on every read. "Coordinator" is the label for actions taken with
// no name, so no one may claim it, nor a look-alike of it.
export { NAME_MAX };
export const RESERVED_NAME = "Coordinator";
export type NameCheck = { name: string } | { problem: "empty" | "long" | "hidden" | "symbols" | "reserved" };
// Cyrillic, Greek and other letters, and digits, that pass for the letters of "coordinator"
// (after lower-casing and NFKC). Enough for the one reserved label; not a general confusables table.
const LOOK_ALIKE: Record<string, string> = {
  "\u0441": "c", "\u03f2": "c", "\u217d": "c",
  "\u043e": "o", "\u03bf": "o", "\u03c3": "o", "\u0585": "o", "0": "o",
  "\u0433": "r", "\u1d26": "r", "\u0280": "r",
  "\u0501": "d", "\u217e": "d",
  "\u0456": "i", "\u03b9": "i", "\u0131": "i", "\u04cf": "i", "1": "i", "l": "i", "\u0269": "i",
  "\u03b7": "n", "\u043f": "n", "\u0578": "n", "\u03bd": "n",
  "\u0430": "a", "\u03b1": "a", "\u0251": "a",
  "\u0442": "t", "\u03c4": "t",
  "\u0435": "e", "\u03b5": "e", "\u0454": "e"
};
// What a name looks like, for comparison with the reserved label only: compatibility forms
// folded (NFKC), lower case, accents dropped, look-alike letters mapped, and everything but
// letters and numbers removed, so "Coordinator." and "Co-ordinator" match too.
function skeleton(name: string): string {
  const folded = name.normalize("NFKC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return Array.from(folded, ch => LOOK_ALIKE[ch] ?? ch).join("").replace(/[^\p{L}\p{N}]/gu, "");
}
export function checkName(v: unknown): NameCheck {
  const name = typeof v === "string" ? v.normalize("NFC").trim() : "";
  if (!name) return { problem: "empty" };
  if (name.length > NAME_MAX) return { problem: "long" };
  // Control, format (zero-width, bidi), line and paragraph separator characters.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return { problem: "hidden" };
  if (!/[\p{L}\p{N}]/u.test(name)) return { problem: "symbols" };
  if (skeleton(name) === skeleton(RESERVED_NAME)) return { problem: "reserved" };
  return { name };
}
export const NAME_PROBLEM: Record<"long" | "hidden" | "symbols" | "reserved", string> = {
  long: `Your name can be at most ${NAME_MAX} characters.`,
  hidden: "Your name can't contain hidden or control characters.",
  symbols: "Your name needs at least one letter or number.",
  reserved: `"${RESERVED_NAME}" is the label for unnamed actions. Enter your own name.`
};

// True when the form would be refused only for lacking a name: nothing typed and none remembered.
export function needsName(typed: unknown, remembered: string | undefined): boolean {
  if (remembered) return false;
  const c = checkName(typed);
  return "problem" in c && c.problem === "empty";
}
export const NAME_NEEDED = "Enter your name to continue.";
// Runs an action as the coordinator named on the form (checked by the same rules as any name), else
// as the name remembered for this browser; with neither the form is refused beside its own name field.
// A typed name is remembered only once the action has worked: a refused action never changes who the
// header says is recording. remember is called at most once, and not at all when fn throws.
export async function runAs<T>(typed: unknown, remembered: string | undefined, remember: (name: string) => Promise<void>, fn: (who: string) => Promise<T>): Promise<T> {
  const c = checkName(typed);
  let who: string;
  if ("name" in c) who = c.name;
  else if (c.problem !== "empty") throw new FieldError(NAME_PROBLEM[c.problem], "who");
  else if (remembered) who = remembered;
  else throw new FieldError(NAME_NEEDED, "who");
  const done = await fn(who);
  if ("name" in c && c.name !== remembered) await remember(c.name);
  return done;
}
