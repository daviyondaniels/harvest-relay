import { digest } from "./planner.ts";
import type { BaseUnit } from "./quantity.ts";

export type MessageFacts = {
  kind: "request" | "offer" | "notice";
  to: { kind: "grower" | "buyer"; id: string; name: string };
  product: string; substitute?: string; amount: number; unit: BaseUnit; deliveryOn: string;
};
export type Confirm = { token: string; question: string };
// ok means no problems; confirmation items are words the coordinator must confirm before sending.
export type Check = { ok: boolean; problems: string[]; confirm: Confirm[] };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX = 480;

export function display(amount: number, unit: BaseUnit): string {
  return unit === "g" ? `${amount / 1000} kg` : `${amount} ${unit}`;
}
function dateOf(s: string, what: string): Date {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(NaN);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s) throw new Error(`Invalid ${what}: ${s}`);
  return t;
}
const dayIndex = (f: MessageFacts) => dateOf(f.deliveryOn, "delivery date").getUTCDay();
const dayOf = (f: MessageFacts) => DAYS[dayIndex(f)];

export function template(f: MessageFacts): string {
  const qty = display(f.amount, f.unit), Day = dayOf(f), name = f.to.name;
  switch (f.kind) {
    case "request": return `Hi ${name}, could you bring another ${qty} of ${f.product} for ${Day}? Reply with how much you can do. Thanks!`;
    case "offer":
      if (!f.substitute) throw new Error("An offer needs a substitute");
      return `Hi ${name}, we're ${qty} short on ${f.product} for ${Day}. Would ${f.substitute} work for that ${qty}? Reply yes or no.`;
    case "notice": return `Hi ${name}, your ${f.product} order for ${Day} will be ${qty} short. We're sorry for the change.`;
  }
}

export function factsDigest(f: MessageFacts): string { return digest(f); }


// Every quantity, day, date and product in the text must come from the facts (E11), and the
// product, amount and day must all appear. The text is split into letter runs and digit runs;
// every other character is a separator, so nothing can hide behind a word boundary. Each token
// is resolved to what it means (a day, a relative day, a number, a unit or a product), shorthand
// and close misspellings included, and the meaning is checked against the facts. A token that
// looks like a fact but has no confident reading becomes a confirmation item. The checker errs
// toward flagging: a false positive costs a fallback or a question, a miss is what this stops.
// Lookup tables have no prototype, so a word like "constructor" or "toString" finds nothing.
const table = <T>(o: Record<string, T>): Record<string, T> => Object.assign(Object.create(null), o);
const VALUES: Record<string, number> = table(Object.fromEntries([
  ..."zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ").map((w, i) => [w, i]),
  ..."twenty thirty forty fifty sixty seventy eighty ninety".split(" ").map((w, i) => [w, 20 + 10 * i]),
  ["hundred", 100], ["thousand", 1000], ["million", 1e6], ["dozen", 12],
]));
const VALUE_KEYS = Object.keys(VALUES).sort((a, b) => b.length - a.length);
// Number shorthand that is not a misspelling.
const NUMBER_SHORT: Record<string, number> = table({ doz: 12, dz: 12, dozn: 12 });
// Real words close enough to a number word to be read as one (see nearNumbers); never read as a
// misspelt number. Found by checking every word in a 63,875-word English dictionary. Number words
// that are not in VALUES (billion, trillion, zillion) are left out, so they are still flagged.
const NOT_NUMBERS = new Set((
  "bight bights bullion bundled clever cloven cozen delve dirty doyen doze dozed dozes element " +
  "elves enliven even evenly evens event events fight fights finely finery flighty foray fort forte " +
  "forth forts funded handed handled height heighten heights hellion highly hindered honored " +
  "hounded huddled humored hunched hungered hunkered hunted hurdled kindred leaven levee level " +
  "lever light lighten lightly lights liven might mighty milling minion minty mission mullion " +
  "mullions naivety nicely nicety nifty night nightly nights nighty ninny piety pigsty pillion " +
  "pillions plenty right rightly rights sateen seen semen serenity sever severity shelve shifty " +
  "shirt shirts shitty sight sights sinewy sloven subteen sundered sweaty swerve teensy teeny tent " +
  "tents testy thee there theres thinly thirdly thirst thirsts thirsty thorny threw thrifty throe " +
  "thundered tight tighten tightly tights treaty tree trendy twee tweedy tweet tweets uneven weave " +
  "weight weights weighty went wight wights winery"
).split(" "));
// Vague or inflected amounts: a number, but never the decision's amount.
const CARDINALS = [...Object.keys(VALUES), "half", "halves", "couple", "few", "several", "pair", "twice", "double", "triple", "quarter", "score", "gross"];
const IRREGULAR = ["twenties", "thirties", "forties", "fifties", "sixties", "seventies", "eighties", "nineties"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth", "hundredth", "thousandth"];
const NUMBER_WORDS = new Set([...CARDINALS, ...IRREGULAR, ...ORDINALS]);
// A letter token is number-like if it is a number word (or its plural), starts with a cardinal of 4+
// letters (thirtyish, fourth), or is a 3-letter cardinal with fold/th or more number words (tenfold).
function isNumberWord(w: string, depth = 0): boolean {
  if (NUMBER_WORDS.has(w) || (w.endsWith("s") && NUMBER_WORDS.has(w.slice(0, -1)))) return true;
  if (CARDINALS.some(c => c.length >= 4 && w.startsWith(c))) return true;
  if (/^(?:twen|thir|for|fif|six|seven|eigh|nine)tieth/.test(w)) return true;
  for (const c of CARDINALS) {
    if (c.length !== 3 || !w.startsWith(c)) continue;
    const rest = w.slice(3);
    if (rest === "fold" || rest === "th") return true;
    if (depth < 3 && rest && isNumberWord(rest, depth + 1)) return true;
  }
  return false;
}
// A run of number words read as one number ("one hundred twenty five", "two dozen"), or undefined
// when the words do not form one.
function wordsValue(ws: string[]): number | undefined {
  let total = 0, cur = 0, last = "";
  for (const w of ws) {
    const v = VALUES[w];
    if (v === undefined || last === "dozen") return;
    if (v >= 1000) { if (last === "big") return; total += (cur || 1) * v; cur = 0; last = "big"; }
    else if (v === 100 || w === "dozen") { if (last === "mul" || last === "tens") return; cur = (cur || 1) * v; last = w === "dozen" ? "dozen" : "mul"; }
    else if (last === "unit" || last === "teen" || (last === "tens" && v >= 10)) return;
    else { cur += v; last = v >= 20 ? "tens" : v >= 10 ? "teen" : "unit"; }
  }
  return total + cur;
}
function splitWords(w: string): string[] | undefined {
  if (!w) return [];
  for (const k of VALUE_KEYS) if (w.startsWith(k)) { const r = splitWords(w.slice(k.length)); if (r) return [k, ...r]; }
}
const exactNumber = (w: string): number | undefined => NUMBER_SHORT[w] ?? (VALUES[w] !== undefined ? VALUES[w] : (s => s && s.length > 1 ? wordsValue(s) : undefined)(splitWords(w)));

const BASE_UNITS: Record<string, string> = table({ lb: "lb", pound: "lb", kg: "kg", kilo: "kg", kilogram: "kg", g: "g", gram: "g", each: "each" });
const OTHER_UNITS = new Set(["case", "box", "crate", "bunch", "flat", "bushel", "bag", "pallet", "sack", "tote", "pint", "quart", "peck", "lug", "carton", "tray", "tonne", "ton", "oz", "ounce", "bin", "basket", "bale", "gallon", "bundle", "head"]);
function unitOf(w: string): { base?: string; other?: boolean } | undefined {
  for (const c of [w, ...(w.endsWith("es") ? [w.slice(0, -2)] : []), ...(w.endsWith("s") ? [w.slice(0, -1)] : [])]) {
    if (BASE_UNITS[c]) return { base: BASE_UNITS[c] };
    if (OTHER_UNITS.has(c)) return { other: true };
  }
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// The values whose spellings are closest to w within max edits (max may depend on the spelling).
// Unless anyFirst, a spelling must share w's first letter: a typo rarely changes the first letter,
// and this keeps lemon/melon and right/eight apart. Days set anyFirst, since a day name is long and
// distinct enough that "hursday" can only be Thursday.
function nearest<T>(w: string, spellings: [string, T][], max: number | ((s: string, v: T) => number), anyFirst = false): T[] {
  let best = Infinity, out: T[] = [];
  for (const [s, v] of spellings) {
    if (!anyFirst && s[0] !== w[0]) continue;
    const d = lev(w, s);
    if (d > (typeof max === "number" ? max : max(s, v))) continue;
    if (d < best) { best = d; out = [v]; } else if (d === best && !out.includes(v)) out.push(v);
  }
  return out;
}
const FUZZY_NUMBERS = Object.entries(VALUES).filter(([w]) => w.length >= 5);
// Edit distance where swapping two neighbouring letters is one edit ("thrity" is one from thirty).
// Stops early at 3: callers allow at most 2.
function swaps(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// The closest number words to w: 1 edit from a 5-letter number word, 2 from one of 6+ letters,
// counting a swap of neighbours as one edit ("thrity", "twentee"). Any first letter may differ
// ("wenty", "rwenty", "dight"). Number words under 5 letters are never fuzzy, so zero, four, five
// and nine stay exact. Ordinary words this reaches are listed in NOT_NUMBERS.
function nearNumbers(w: string): number[] {
  let best = 3, out: number[] = [];
  for (const [s, v] of FUZZY_NUMBERS) {
    const d = swaps(w, s);
    if (d > (s.length >= 6 ? 2 : 1)) continue;
    if (d < best) { best = d; out = [v]; } else if (d === best && !out.includes(v)) out.push(v);
  }
  return out;
}
const or = (xs: string[]) => xs.slice(0, 2).join(" or ");

// Days: the full name, its plural and the usual abbreviations ("." is a separator) state a day.
const EXPLICIT_DAYS = new Map<string, number>([
  ...DAYS.flatMap((d, i) => [[d.toLowerCase(), i], [`${d.toLowerCase()}s`, i]] as [string, number][]),
  ["sun", 0], ["mon", 1], ["tue", 2], ["tues", 2], ["wed", 3], ["weds", 3], ["thu", 4], ["thur", 4], ["thurs", 4], ["fri", 5], ["sat", 6],
]);
const DAY_SPELLINGS = DAYS.flatMap((d, i) => [[d.toLowerCase(), i], [`${d.toLowerCase()}s`, i]] as [string, number][]);
// Ordinary words that would otherwise read as a day: short words that spell the start of a day
// name in order ("thus" in thursday, "may" in monday, "weed" in wednesday), and words two edits
// from a day name (fridge, midday, sturdy). None is a day form; "sun", "sat" and "mon" are, so they stay days.
const NOT_DAYS = new Set(["we", "say", "sad", "may", "thus", "thy", "thud", "wee", "weed", "weeds", "fray", "fridge", "fridges", "midday", "sturdy", "sty"]);
// Day names with their vowels dropped ("mndy", "wdnsdy", "strdy"): a token with no vowels that
// spells one of these is that day. Tokens with vowels are not matched, so "sandy" and "sturdy" stay words.
const SKELETONS = new Map(DAYS.map((d, i) => [d.toLowerCase().replace(/[aeiou]/g, ""), i] as [string, number]));
// A token with no vowels read against the skeletons: the skeleton or its plural is that day; 1 edit
// from one when the token has 4+ letters ("wdsdy", "wnsdy"); and a token of 3+ letters that spells
// a skeleton's first two letters and then some of its letters in order ("wds", "wdns", "mnd") might
// be it; "try" and "shy" do not start like a skeleton.
function skeletonDay(w: string): { day: number } | { maybe: number[] } | undefined {
  const sk = SKELETONS.get(w) ?? (w.endsWith("s") ? SKELETONS.get(w.slice(0, -1)) : undefined);
  if (sk !== undefined) return { day: sk };
  if (w.length >= 4) {
    const near = [...SKELETONS].flatMap(([k, i]) => (Math.min(swaps(w, k), swaps(w, k + "s")) <= 1 ? [i] : []));
    if (near.length === 1) return { day: near[0] };
    if (near.length) return { maybe: near };
  }
  if (w.length < 3) return;
  const maybe = [...SKELETONS].flatMap(([k, i]) => (k.slice(0, 2) === w.slice(0, 2) && subseq(w, k + "s") ? [i] : []));
  return maybe.length ? { maybe } : undefined;
}
const subseq = (w: string, d: string) => { let k = 0; for (const c of d) if (c === w[k]) k++; return k === w.length; };
// What weekday a token states: one day with confidence (an explicit form or abbreviation, or a
// close misspelling of a name: 1 edit for 5 letters, 2 for 6+), or the days it might mean (a
// look-alike of 2-5 letters that starts like a day and spells its letters in order, as "Thr",
// "Satur" or "Frid"). A longer word that only shares a prefix ("month", "friendly") is not a day.
// product marks a token that is a word of a known product: only an explicit day form reads it.
function readDay(w: string, product = false): { day: number } | { maybe: number[] } | undefined {
  const exact = EXPLICIT_DAYS.get(w);
  if (exact !== undefined) return { day: exact };
  if (product || NOT_DAYS.has(w)) return;
  if (!/[aeiou]/.test(w)) {
    const bare = skeletonDay(w);
    if (bare) return bare;
  }
  if (w.length >= 5) {
    const near = nearest(w, DAY_SPELLINGS, w.length === 5 ? 1 : 2, true);
    if (near.length === 1) return { day: near[0] };
    if (near.length) return { maybe: near };
  }
  if (w.length < 2 || w.length > 5) return;
  const maybe = DAYS.flatMap((d, i) => (d.toLowerCase().startsWith(w.slice(0, 2)) && subseq(w, d.toLowerCase()) ? [i] : []));
  return maybe.length ? { maybe } : undefined;
}
// Relative days as days after the date the message is written.
const RELATIVE_DAYS: Record<string, number> = table({
  today: 0, tonight: 0, tonite: 0, tdy: 0,
  tday: 0, // "today" without the o
  tomorrow: 1, tmrw: 1, tmw: 1, tmrrw: 1, tomorow: 1, tommorow: 1,
  tmr: 1, // consonant shorthand for tomorrow
  tmro: 1, // "tmr" with the sounded o, as in "tmro night"
  tmrow: 1, // tomorrow without its vowels but the last o
  tmoro: 1, // "tomoro" without the first o
  tomoz: 1, // British slang for tomorrow
});
// Shorthand that starts like tomorrow ("tm", "tom") but is not on the list above; with no other
// reading it is asked about, so a new spelling of tomorrow cannot pass unread.
const TOMORROW_LIKE = /^(tm|tom)[a-z]*$/;
// Words that shift what a day means: "next Friday", "the day before Friday", "last Friday", "Friday
// gone", "a week from Friday". A day in the same sentence as one is not read as the bare day.
const SHIFT_WORDS = ["next", "last", "before", "after", "prior", "previous", "gone", "ago", "later", "following", "week", "weeks", "fortnight", "from"];
const SHIFT_SHORT: Record<string, string> = table({ nxt: "next", wk: "week", wks: "weeks", fortnite: "fortnight", folowing: "following", prev: "previous", b4: "before" });
// Shift words that put the day before the writing date.
const PAST = new Set(["last", "prior", "previous", "gone", "ago"]);
// Real words 1 edit from a shift word of 5+ letters; never read as a shift. Found by checking every
// word in a 63,875-word English dictionary (followings, fortnights and priors stay shifts).
const NOT_SHIFTS = new Set(("alter apter aster cater dafter eater fallowing geeks hater hollowing lager lamer laser latex " +
  "lather latter laxer layer leeks liter peeks precious priory rafter reeks seeks water weeds weeps").split(" "));
// Words that may sit inside a day phrase without ending it ("Friday in a week", "Friday just gone").
const FILLERS = new Set(["the", "a", "an", "in", "of", "just", "on"]);
// Words that lead into a day phrase and belong to its label ("the day after tomorrow", "a week tomorrow").
const LEADS = new Set(["the", "a", "day"]);
const shiftExact = (w: string): string | undefined => (SHIFT_WORDS.includes(w) ? w : SHIFT_SHORT[w]);
// The shift words a token states: a shift word or its shorthand, a misspelling 1 edit from one of 5+
// letters ("folowing"), or two of them run together ("nextweek").
function shiftsOf(w: string): string[] | undefined {
  const e = shiftExact(w);
  if (e) return [e];
  if (w.length >= 5 && !NOT_SHIFTS.has(w)) {
    const near = SHIFT_WORDS.filter(s => s.length >= 5 && swaps(w, s) <= 1);
    if (near.length === 1) return near;
  }
  for (let k = 2; k <= w.length - 2; k++) {
    const a = shiftExact(w.slice(0, k)), b = shiftExact(w.slice(k));
    if (a && b) return [a, b];
  }
}
// "two days", "2days", "twoday": a count of days after the writing date.
const DAY_WORDS = new Set(["day", "days"]);
// "2moro", "2day": the digit 2 followed by one of these, with no gap.
const TWO_DAYS: Record<string, number> = table({ moro: 1, morrow: 1, mrw: 1, day: 0, nite: 0, night: 0 });
// Spans of time that name no single day; always asked about.
const VAGUE_DAYS = new Set(["weekend", "weekends"]);
function relativeOf(w: string): number | "past" | undefined {
  if (RELATIVE_DAYS[w] !== undefined) return RELATIVE_DAYS[w];
  if (w.length < 5) return;
  const near = nearest(w, [["tomorrow", 1], ["tomorrows", 1], ["yesterday", -1], ["yesterdays", -1]], 2, true);
  return near.length !== 1 ? undefined : near[0] === 1 ? 1 : "past";
}

type Tok = { t: string; num: boolean; start: number; end: number };
const TOKEN = /\d+(?:\.\d+)?|\.\d+|[A-Za-z]+/g;
const PLAIN = /[^\x20-\x7E\n\r\t’‘“”–—]/g;

function base(amount: number, kind: string): { amount: number; unit: BaseUnit } {
  if (kind === "kg") {
    const x = amount * 1000, r = Math.round(x);
    return { amount: Math.abs(x - r) < 1e-6 ? r : x, unit: "g" };
  }
  return { amount, unit: kind as BaseUnit };
}

// Unapproved products are found on a letters-only copy of the text (every separator and digit
// removed), so "cherry tomatoes", "c-h-e-r-r-y tomatoes" and "cherrytomatoes" read the same. A
// product is mentioned wherever its stem occurs (the name without spaces and a trailing "y", so
// berry also finds berries). An occurrence outside the decision is flagged unless those very
// letters lie inside an occurrence of an approved name (approved "cherry tomato" contains
// "tomato"); letters after an approved name and its plural suffix ("zucchinipeas") are outside it.
const keyOf = (p: string) => p.toLowerCase().replace(/[^a-z]/g, "");
function productScan(toks: Tok[], byKey: Map<string, string>, ok: Set<string>): string[] {
  const letters = toks.filter(t => !t.num).map(t => t.t.toLowerCase()).join("");
  const hits: { key: string; from: number; to: number }[] = [];
  for (const key of byKey.keys()) {
    const stem = key.replace(/y$/, "") || key;
    for (let at = letters.indexOf(stem); at >= 0; at = letters.indexOf(stem, at + 1)) {
      hits.push({ key, from: at, to: at + (letters.startsWith(key, at) ? key.length : stem.length) });
    }
  }
  const approved = hits.filter(h => ok.has(h.key)), flagged: string[] = [];
  for (const h of hits) {
    if (ok.has(h.key) || flagged.includes(h.key) || approved.some(a => a.from <= h.from && h.to <= a.to)) continue;
    flagged.push(h.key);
  }
  return flagged;
}
const forms = (k: string) => [k, `${k}s`, `${k}es`, ...(k.endsWith("y") ? [`${k.slice(0, -1)}ies`] : [])];
// Whole-word product reading: each run of up to as many words as a name has is compared with every
// known name and its plurals. A run of 5+ letters also matches a name within 1 edit, or 2 edits for
// names of 7+ letters ("cucumbre"); shorter names would catch ordinary words ("much" is one edit
// from mache). Words are tokens, and also glued runs (tokens joined by a separator other than a
// space, or letters spaced out), so "c-u-c-u-m-b-r-e" is read as one word.
// Common words a few edits from a produce name (sorry/sorrel, could/couve, there/thyme); they are
// never read as a misspelt product. Exact product names are still read.
const COMMON_WORDS = new Set(["sorry", "could", "would", "should", "thanks", "there", "their", "these", "those", "about", "other", "which", "while", "where",
  "still", "today", "every", "much", "check", "order", "reply", "short", "works", "please", "maybe"]);
type Span = { from: number; to: number; text: string; keys: string[]; exact: boolean };
function productSpans(toks: Tok[], text: string, byKey: Map<string, string>): Span[] {
  const names = [...byKey.keys()].map(k => ({ k, n: byKey.get(k)!.split(/[^A-Za-z]+/).filter(Boolean).length, f: forms(k) }));
  const most = Math.max(1, ...names.map(x => x.n)), out: Span[] = [];
  const words = toks.map((t, i) => ({ from: i, to: i, t: t.t.toLowerCase(), num: t.num }));
  const longest = Math.max(0, ...names.flatMap(x => x.f.map(f => f.length))) + 2;
  for (let i = 0; i < toks.length; i++) {
    let j = i;
    while (j + 1 < toks.length && !toks[j].num && !toks[j + 1].num && (!/\s/.test(text.slice(toks[j].end, toks[j + 1].start)) || (toks[j].t.length <= 2 && toks[j + 1].t.length <= 2))) j++;
    // Every sub-run of the glued run, so a word glued on in front ("Or c-u-c-u-m-b-r-e") cannot hide one.
    for (let a = i; a < j; a++) {
      let t = toks[a].t.toLowerCase();
      for (let b = a + 1; b <= j && t.length + toks[b].t.length <= longest; b++) words.push({ from: a, to: b, t: (t += toks[b].t.toLowerCase()), num: false });
    }
    i = j;
  }
  const fits = Array.from({ length: most + 1 }, (_, n) => names.filter(x => x.n >= n));
  const fuzzy = fits.map(fit => fit.filter(x => x.k.length >= 5).flatMap(x => x.f.map(s => [s, x.k] as [string, string])));
  const edits = (_: string, k: string) => (k.length >= 7 ? 2 : 1);
  const spelt = new Map<string, { k: string; n: number }[]>();
  for (const x of names) for (const s of x.f) spelt.set(s, [...(spelt.get(s) ?? []), x]);
  const startAt = new Map<number, typeof words>();
  for (const w of words) if (!w.num) startAt.set(w.from, [...(startAt.get(w.from) ?? []), w]);
  // Breadth first by word count, each token range read once with its fewest words (fewer words fit
  // more names), so a long glued run costs one reading per range, not one per way of splitting it.
  const seen = new Set<number>(), id = (from: number, to: number) => from * (toks.length + 1) + to;
  let level = words.filter(w => !w.num).map(w => ({ from: w.from, to: w.to, joined: w.t }));
  for (let n = 1; n <= most && level.length; n++) {
    const next: typeof level = [];
    for (const { from, to, joined } of level) {
      if (seen.has(id(from, to))) continue;
      seen.add(id(from, to));
      if (joined.length <= longest) {
        const exact = (spelt.get(joined) ?? []).filter(x => x.n >= n).map(x => x.k);
        const keys = exact.length ? exact : joined.length >= 5 && !COMMON_WORDS.has(joined) ? nearest(joined, fuzzy[n], edits) : [];
        if (keys.length) out.push({ from, to, text: text.slice(toks[from].start, toks[to].end), keys, exact: exact.length > 0 });
      }
      if (n < most) for (const w of startAt.get(to + 1) ?? []) if (joined.length + w.t.length <= longest && !seen.has(id(from, w.to))) next.push({ from, to: w.to, joined: joined + w.t });
    }
    level = next;
  }
  return out;
}
// Tokens that spell an approved product's name (last word optionally plural) are the product and
// are not read as days, units or number words, so the template passes for any approved name.
function approvedWords(toks: Tok[], allowed: string[]): Set<number> {
  const out = new Set<number>();
  for (const p of allowed) {
    const words = p.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (!words.length) continue;
    const last = words[words.length - 1], fs = forms(last);
    for (let i = 0; i + words.length <= toks.length; i++) {
      const span = toks.slice(i, i + words.length).map(t => (t.num ? "" : t.t.toLowerCase()));
      if (span.slice(0, -1).every((w, k) => w === words[k]) && fs.includes(span[span.length - 1])) {
        for (let k = i; k < i + words.length; k++) out.add(k);
      }
    }
  }
  return out;
}

// on is the date the message is written (YYYY-MM-DD); relative days resolve against it, and
// without it a relative day is asked about.
export function checkDraft(raw: string, f: MessageFacts, knownProducts: string[], on?: string): Check {
  const dayIdx = dayIndex(f), day = DAYS[dayIdx], written = on === undefined ? undefined : dateOf(on, "writing date");
  if (!raw.trim()) return { ok: false, problems: ["Message is empty"], confirm: [] };
  const problems: string[] = [], confirm: Confirm[] = [];
  const ask = (token: string, question: string) => { if (!confirm.some(c => c.token === token && c.question === question)) confirm.push({ token, question }); };
  if (raw.length > MAX) problems.push(`Longer than ${MAX} characters`);
  let text = f.to.name ? raw.split(f.to.name).join(" ") : raw;
  const odd = [...new Set(text.match(PLAIN) ?? [])];
  if (odd.length) problems.push(`Uses characters outside plain text (${odd.join(" ")})`);

  const [, , mo, d] = f.deliveryOn.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  text = text.replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g, m => {
    if (m !== f.deliveryOn) problems.push(`Date "${m}" is not the delivery date`);
    return " ".repeat(m.length);
  });

  const toks: Tok[] = [...text.matchAll(TOKEN)].map(m => ({ t: m[0], num: /^[\d.]/.test(m[0]), start: m.index!, end: m.index! + m[0].length }));
  const quote = (a: number, b: number) => text.slice(toks[a].start, toks[b].end);
  const lower = (i: number) => toks[i]?.t.toLowerCase() ?? "";
  const used = new Set<number>();
  const allowed = [f.product, f.substitute].filter((x): x is string => !!x);
  const product = approvedWords(toks, allowed);
  let found = 0, days = 0;
  // Words of known products (sunchoke, sunflower) are not read as look-alike days.
  const knownWords = new Set(knownProducts.flatMap(p => p.toLowerCase().split(/[^a-z]+/).filter(Boolean).flatMap(forms)));
  // The decision's amount as written in a message (grams are written as kg).
  const stated = f.unit === "g" ? f.amount / 1000 : f.amount;
  // Tokens that start like tomorrow and have no other reading; asked about once products are known.
  const tomorrowLike: number[] = [];
  // Reads toks[j] as "day"/"days" after the count n stated by toks[i..j-1]; false when it is not.
  const dayCount = (n: number, i: number, j: number): boolean => {
    if (!toks[j] || toks[j].num || !DAY_WORDS.has(lower(j)) || !/^[\s-]?$/.test(text.slice(toks[j - 1].end, toks[j].start))) return false;
    used.add(j);
    relative(quote(i, j), n);
    return true;
  };

  const relative = (label: string, n: number | "past") => {
    if (n === "past") return problems.push(`"${label}" is before the delivery (${day})`);
    if (!written) return ask(label, `"${label}" — which day is that?`);
    const when = new Date(written.getTime() + n * 864e5), iso = when.toISOString().slice(0, 10), w = DAYS[when.getUTCDay()];
    if (iso === f.deliveryOn) days++;
    else problems.push(w === day ? `"${label}" means ${w} ${iso}; the delivery is ${day} ${f.deliveryOn}` : `"${label}" means ${w}; the delivery is ${day}`);
  };
  // Reads toks[j] as the unit of the number n stated by toks[i..j-1]; false when it is not a unit.
  const quantity = (n: number, i: number, j: number): boolean => {
    const u = toks[j] && !toks[j].num && toks[j].start - toks[j - 1].end <= 1 ? unitOf(lower(j)) : undefined;
    if (!u) return false;
    used.add(j);
    if (u.other) { problems.push(`Quantity "${quote(i, j)}" uses a unit that is not in the decision (${display(f.amount, f.unit)})`); return true; }
    found++;
    const q = base(n, u.base!);
    if (q.unit !== f.unit || q.amount !== f.amount) problems.push(`Quantity "${quote(i, j)}" is not in the decision (${display(f.amount, f.unit)})`);
    return true;
  };

  // Day phrases, judged by sentence (split on . ! ? ; and newlines, not commas). A day or relative
  // day in a sentence that also has a shift word is not read as the bare day. Shift words next to
  // it (fillers such as "in a" between) form its phrase, which is resolved against the writing date
  // when it fits a known pattern and then checked like a relative day. Otherwise the phrase has
  // several readings: it is asked about when one could be the delivery, and is a problem when none can.
  const sentence: number[] = [];
  toks.forEach((t, k) => sentence.push(k && /[.!?;\n]/.test(text.slice(toks[k - 1].end, t.start)) ? sentence[k - 1] + 1 : k ? sentence[k - 1] : 0));
  const word = (k: number) => k >= 0 && k < toks.length && !toks[k].num && !product.has(k) ? lower(k) : "";
  const shiftAt = toks.map((t, k) => {
    // "b4" is split into "b" and "4"; the 4 is part of the word, not a number.
    if (word(k) === "b" && toks[k + 1]?.t === "4" && toks[k + 1].start === t.end) { used.add(k + 1); return ["before"]; }
    return word(k) ? shiftsOf(word(k)) : undefined;
  });
  const isWeek = (k: number) => !!shiftAt[k] && shiftAt[k]!.length === 1 && /^weeks?$/.test(shiftAt[k]![0]);
  const shifted = new Set(sentence.filter((_, k) => shiftAt[k]));
  for (let i = 0; i < toks.length; i++) {
    if (!word(i) || used.has(i) || shiftAt[i] || !shifted.has(sentence[i])) continue;
    const w = lower(i), r = relativeOf(w), dr = r === undefined ? readDay(w, knownWords.has(w)) : undefined;
    const rel = typeof r === "number" && r >= 0 ? r : undefined;
    const W = dr ? ("day" in dr ? [dr.day] : dr.maybe) : [];
    if (rel === undefined && !W.length) continue;
    const mods: number[] = [];
    let from = i, to = i;
    for (const dir of [-1, 1]) {
      for (let k = i + dir, n = 0; k >= 0 && k < toks.length && sentence[k] === sentence[i] && n < 5; k += dir, n++) {
        if (shiftAt[k] || (word(k) === "this" && isWeek(k + 1))) { mods.push(k); if (dir < 0) from = k; else to = k; }
        else if (!FILLERS.has(word(k))) break;
      }
    }
    if (word(to) === "b" && used.has(to + 1)) to++;
    for (let n = 0; n < 2 && LEADS.has(word(from - 1)) && sentence[from - 1] === sentence[i]; n++) from--;
    for (let k = from; k <= to; k++) used.add(k);
    let label = quote(from, to);
    if ((label.split("(").length > label.split(")").length) && text[toks[to].end] === ")") label += ")";
    const M = new Set(mods.flatMap(m => shiftAt[m] ?? ["this"]));
    const has = (x: string) => M.has(x);
    const past = [...M].some(x => PAST.has(x)), week = has("week") || has("weeks"), thisWeek = has("this");
    const afterNext = mods.some(m => shiftAt[m]?.at(-1) === "after" && shiftAt[m + 1]?.[0] === "next");
    // "the day after tomorrow", "the day before Friday"
    const dayShift = mods.includes(i - 1) && word(i - 2) === "day" ? shiftAt[i - 1]!.at(-1) : undefined;
    // Each reading as days after the writing date; exact when the phrase fits a pattern.
    let exact = true;
    const readings = (n: number, last: number): number[] => {
      if (dayShift === "after") return [n + 1];
      if (dayShift === "before") return [n - 1];
      if (has("last")) return [-last];
      if (past) { exact = false; return [-last, -last - 7]; }
      if (afterNext) return [n + 7, n + 14];
      if (has("fortnight")) return [n + 14];
      if (week && thisWeek) return [n];
      if (week || has("next") || has("following")) return [n + 7];
      exact = false;
      return [n - 7, n, n + 1, n + 7, n + 14];
    };
    const asks = () => ask(label, `"${label}": which date is that?`);
    if (!written) {
      if (rel === undefined && !W.includes(dayIdx)) problems.push(`"${label}" reads as ${or(W.map(x => DAYS[x]))}, not the delivery day (${day})`);
      else if (rel === undefined && W.length === 1 && thisWeek && mods.length === 2) days++;
      else asks();
      continue;
    }
    const dow = written.getUTCDay();
    const offsets = rel !== undefined ? readings(rel, 1 - rel) : W.flatMap(x => readings((x - dow + 7) % 7 || 7, (dow - x + 7) % 7 || 7));
    if (exact && offsets.length === 1 && (rel !== undefined || "day" in dr!)) { relative(label, offsets[0]); continue; }
    const isos = [...new Set(offsets.map(n => new Date(written.getTime() + n * 864e5).toISOString().slice(0, 10)))];
    if (isos.includes(f.deliveryOn)) asks();
    else if (rel === undefined && !W.includes(dayIdx)) problems.push(`"${label}" reads as ${or(W.map(x => DAYS[x]))}, not the delivery day (${day})`);
    else if (past) problems.push(`"${label}" is before ${on}; the delivery is ${day} ${f.deliveryOn}`);
    else problems.push(`"${label}" means ${or(isos)}; the delivery is ${day} ${f.deliveryOn}`);
  }

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i], next = toks[i + 1], w = lower(i);
    if (tok.num) {
      if (used.has(i)) continue;
      if (tok.t === "2" && next && !next.num && next.start === tok.end && TWO_DAYS[lower(i + 1)] !== undefined) { relative(quote(i, i + 1), TWO_DAYS[lower(i + 1)]); i++; continue; }
      if (quantity(Number(tok.t), i, i + 1) || dayCount(Number(tok.t), i, i + 1)) i++;
      else problems.push(`Number "${tok.t}" is not in the decision`);
      continue;
    }
    if (used.has(i) || product.has(i)) continue;
    const mi = MONTHS.findIndex(m => m.toLowerCase() === w);
    if (mi >= 0 && next?.num && /^\d{1,2}$/.test(next.t) && /^\s+$/.test(text.slice(tok.end, next.start))) {
      if (mi + 1 !== Number(mo) || Number(next.t) !== Number(d)) problems.push(`Date "${quote(i, i + 1)}" is not the delivery date`);
      i++;
      continue;
    }
    // "next week" or "this week" with no day: a problem when no day of that week is the delivery.
    const span = shiftAt[i]?.join(" ") === "next week" ? 0 : (shiftAt[i]?.[0] === "next" || w === "this") && isWeek(i + 1) && !used.has(i + 1) ? 1 : -1;
    if (span >= 0) {
      const label = quote(i, i + span), nextWeek = w !== "this";
      if (written) {
        const toMonday = (8 - written.getUTCDay()) % 7 || 7, at = (Date.parse(f.deliveryOn) - written.getTime()) / 864e5;
        const [lo, hi] = nextWeek ? [toMonday, toMonday + 6] : [0, toMonday - 1];
        if (at < lo || at > hi) { problems.push(`"${label}" does not include the delivery (${day} ${f.deliveryOn})`); i += span; continue; }
      }
      ask(label, `"${label}" — which day is that?`);
      i += span;
      continue;
    }
    if (VAGUE_DAYS.has(w)) { ask(tok.t, `"${tok.t}" — which day is that?`); continue; }
    const glued = w.match(/^([a-z]+?)(days?)$/), count = glued ? exactNumber(glued[1]) : undefined;
    if (count !== undefined) { relative(tok.t, count); continue; }
    const rel = relativeOf(w);
    if (rel !== undefined) { relative(tok.t, rel); continue; }
    // A day stated with confidence must be the delivery day. A possible day is asked about only
    // when the delivery day is one of its readings; otherwise every
    // reading is wrong, so confirming it would assert a wrong day, and it is a problem.
    const dr = readDay(w, knownWords.has(w));
    if (dr && "day" in dr) {
      if (dr.day === dayIdx) days++;
      else problems.push(`Day "${tok.t}" is not the delivery day (${day})`);
    } else if (dr && dr.maybe.includes(dayIdx)) {
      // Asked about, but a question never states the required day.
      ask(tok.t, `Did you mean ${or(dr.maybe.map(x => DAYS[x]))}?`);
    } else if (dr) problems.push(`Day "${tok.t}" reads as ${or(dr.maybe.map(x => DAYS[x]))}, not the delivery day (${day})`);
    if (unitOf(w)) { problems.push(`Unit without a number ("${tok.t}")`); continue; }
    // Number words: the longest run of exact number words that forms one number, then its unit.
    let j = i;
    while (j < toks.length && !toks[j].num && !product.has(j) && exactNumber(lower(j)) !== undefined && (j === i || /^[\s-]+$/.test(text.slice(toks[j - 1].end, toks[j].start)))) j++;
    for (; j > i; j--) {
      const ws = toks.slice(i, j).flatMap(t => splitWords(t.t.toLowerCase()) ?? [t.t.toLowerCase()]);
      const n = j - i === 1 ? exactNumber(w) : wordsValue(ws);
      if (n === undefined) continue;
      if (!quantity(n, i, j) && !dayCount(n, i, j)) problems.push(`Number "${quote(i, j - 1)}" (${n}) is not in the decision`);
      break;
    }
    if (j > i) { i = used.has(j) ? j : j - 1; continue; }
    if (isNumberWord(w)) { problems.push(`Uses an amount in words that is not the decision's ("${tok.t}")`); continue; }
    // A close misspelling of a number word is a quantity when a unit follows. Without one it is
    // asked about when a reading is the decision's amount, and is a problem when none is.
    const near = w.length < 4 || NOT_NUMBERS.has(w) ? [] : nearNumbers(w);
    if (near.length === 1 && (quantity(near[0], i, i + 1) || dayCount(near[0], i, i + 1))) { i++; continue; }
    if (near.includes(stated)) ask(tok.t, `Did you mean ${or(near.map(String))}?`);
    else if (near.length) problems.push(`Number "${tok.t}" reads as ${or(near.map(String))}, which is not in the decision (${display(f.amount, f.unit)})`);
    else if (!dr && w.length >= 3 && w.length <= 8 && TOMORROW_LIKE.test(w) && !forms("tomato").includes(w)) tomorrowLike.push(i);
  }
  if (!found) problems.push("No amount stated");

  // Products: exact stems anywhere (above), then whole-word readings. A misspelt unapproved
  // product is a problem; a word close to two products, one of them approved, is asked about.
  const byKey = new Map<string, string>();
  for (const p of [...allowed, ...knownProducts]) if (keyOf(p) && !byKey.has(keyOf(p))) byKey.set(keyOf(p), p);
  const ok = new Set(allowed.map(keyOf)), flagged = productScan(toks, byKey, ok);
  for (const k of flagged) problems.push(`Mentions ${byKey.get(k)}, which is not in the decision`);
  const spans = productSpans(toks, text, byKey), mentioned = new Set<string>(), covered = new Set<number>();
  const cells = (s: Span) => Array.from({ length: s.to - s.from + 1 }, (_, k) => s.from + k);
  for (const s of spans) {
    if (s.keys.length === 1 && ok.has(s.keys[0])) cells(s).forEach(c => covered.add(c));
    // Only a confident reading mentions a product: an exact name, or a misspelling of one product.
    if (s.exact || s.keys.length === 1) s.keys.forEach(k => mentioned.add(k));
  }
  // A fuzzy reading is set aside only when an exact reading spans all of it. One that reaches past
  // an exact approved name ("chery tomatoes" around "tomatoes") is a longer product and is checked.
  const inExact = (s: Span) => spans.some(e => e.exact && e.from <= s.from && s.to <= e.to);
  for (const s of spans) {
    if (s.exact || s.keys.every(k => ok.has(k)) || cells(s).every(c => covered.has(c)) || inExact(s)) continue;
    if (s.keys.some(k => ok.has(k))) { ask(s.text, `Did you mean ${or(s.keys.map(k => byKey.get(k)!))}?`); continue; }
    const names = s.keys.map(k => byKey.get(k)!);
    if (!s.keys.every(k => flagged.includes(k))) problems.push(`Mentions ${or(names)} ("${s.text}"), which is not in the decision`);
    s.keys.forEach(k => flagged.includes(k) || flagged.push(k));
  }
  // Shorthand that starts like tomorrow and is not a product is asked about.
  for (const i of tomorrowLike) if (!spans.some(s => s.from <= i && i <= s.to)) { ask(toks[i].t, `"${toks[i].t}" — which day is that?`); }
  if (!days) problems.push(`Does not state the delivery day (${day})`);
  const required = f.kind === "offer" ? f.substitute : f.product;
  if (required && !mentioned.has(keyOf(required))) problems.push(`Does not mention ${required}`);

  return { ok: problems.length === 0, problems, confirm };
}
