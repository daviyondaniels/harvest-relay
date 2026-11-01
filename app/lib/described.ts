/** The error ids among a field's aria-describedby (the "-error" ids), and the other ids kept apart. */
export function splitDescribed(value: string | null): { errors: string[]; others: string[] } {
  const ids = (value ?? "").split(/\s+/).filter(Boolean);
  return { errors: ids.filter(x => x.endsWith("-error")), others: ids.filter(x => !x.endsWith("-error")) };
}
