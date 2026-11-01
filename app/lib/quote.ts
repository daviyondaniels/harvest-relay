// Picks the words that support an answer when the coordinator leaves the quote blank.
// It only ever returns a literal substring of the text: the shortest stretch that holds the
// value's number (with the word after it, such as its unit), else the whole text. It never writes words of its own.
export const QUOTE_MAX = 500;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
// A number with the word that follows it, if any: "10 lb", "6lb", "1,200 pounds".
const WITH_UNIT = /(\d[\d,]*(?:\.\d+)?)(?:\s*[A-Za-z]+)?/g;
const digits = (s: string) => s.replace(/,/g, "");

// The first number in the value, as typed ("10 lb" gives "10"). A date has none to look for.
function numberIn(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  const m = value.match(NUMBER)?.[0];
  return m ? digits(m) : undefined;
}
// The literal span of the text that is that number on its own (not part of a longer one), with
// the word after it.
export function numberSpan(text: string, value: string): string | undefined {
  const want = numberIn(typeof value === "string" ? value : ""), t = typeof text === "string" ? text : "";
  if (!want) return undefined;
  for (const m of t.matchAll(WITH_UNIT)) if (digits(m[1]) === want) return m[0];
  return undefined;
}
export function pickQuote(text: string, value: string): string {
  const t = typeof text === "string" ? text : "";
  const hit = numberSpan(t, value);
  if (hit) return hit;
  if (t.length <= QUOTE_MAX) return t;
  // A long reply: its opening words, cut at a space, still a literal stretch of it.
  const head = t.slice(0, QUOTE_MAX), cut = head.lastIndexOf(" ");
  return (cut > 0 ? head.slice(0, cut) : head).trim();
}
