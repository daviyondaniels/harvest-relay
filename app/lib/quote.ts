// Picks the words that support an answer when the coordinator leaves the quote blank.
// It only ever returns a literal substring of the text: the shortest stretch that holds the
// value's number, else the whole text. It never writes words of its own.
export const QUOTE_MAX = 500;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const digits = (s: string) => s.replace(/,/g, "");

// The first number in the value, as typed ("10 lb" gives "10"; "2026-10-30" gives "2026").
function numberIn(value: string): string | undefined {
  const m = value.match(NUMBER)?.[0];
  return m ? digits(m) : undefined;
}
// The shortest literal span of the text that is that number on its own (not part of a longer one).
export function numberSpan(text: string, value: string): string | undefined {
  const want = numberIn(typeof value === "string" ? value : ""), t = typeof text === "string" ? text : "";
  if (!want) return undefined;
  for (const m of t.matchAll(NUMBER)) if (digits(m[0]) === want) return m[0];
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
