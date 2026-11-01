// Pure helpers for the visual-design tests: read the colour tokens out of app/globals.css and
// compute WCAG contrast ratios. No rendering is involved.
export type Tokens = Record<string, string>;

// The custom properties declared in the first block that starts with `open` (e.g. ":root {").
export function tokensIn(css: string, open: string): Tokens {
  const at = css.indexOf(open);
  if (at < 0) throw new Error(`no block ${open}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out: Tokens = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/g)) out[m[1]] = m[2];
  return out;
}
// The light tokens, and the dark tokens laid over them.
export function themes(css: string): { light: Tokens; dark: Tokens } {
  const light = tokensIn(css, ":root {");
  return { light, dark: { ...light, ...tokensIn(css, ':root[data-theme="dark"] {') } };
}
function channel(v: number): number { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function luminance(hex: string): number {
  const h = hex.length === 4 ? "#" + [...hex.slice(1)].map(c => c + c).join("") : hex;
  const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// The declarations of the first rule whose selector is exactly `selector`.
export function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1];
}
