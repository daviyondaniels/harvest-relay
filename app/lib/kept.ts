// What a coordinator typed into a form that was refused comes back with the redirect, so
// nothing has to be typed again. The values travel as plain query parameters, one per field,
// each cut to its field's own limit. They are only ever shown as a field's starting text: they
// are never signed and never trusted, and they are not part of the signed notice.
type Params = Record<string, string | string[] | undefined>;
export const KEEP = {
  ask: { field: 40, question: 500 },
  reply: { reply: 2000, field: 40, value: 200, quote: 500 },
  correct: { field: 40, value: 200, quote: 500 },
  hold: { note: 500 },
  send: { body: 480 },
  buyer: { channel: 10, text: 480, quote: 480 },
  hand: { operation: 40, lot: 80, amount: 12, unit: 8, grade: 80, day: 10, target: 80, quote: 500 }
} as const satisfies Record<string, Record<string, number>>;
export type KeptForm = keyof typeof KEEP;
const key = (on: string, name: string) => `k_${on}_${name}`;
const cut = (s: string, max: number) => Array.from(s).slice(0, max).join("");

// The query parameters that carry a refused form's typed fields.
export function keepTyped(f: FormData, on: KeptForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, max] of Object.entries(KEEP[on])) {
    const v = f.get(name);
    if (typeof v === "string" && v.trim()) out[key(on, name)] = cut(v, max);
  }
  return out;
}
// One kept field, if the URL carries it. Only the form's own fields are read, each cut to its limit.
export function readKept(p: Params, on: KeptForm, name: string): string | undefined {
  const max = (KEEP[on] as Record<string, number>)[name], v = p[key(on, name)];
  return max !== undefined && typeof v === "string" && v ? cut(v, max) : undefined;
}
