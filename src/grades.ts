// Growers abbreviate and misspell grade names ("std"). A stated grade is mapped to the
// hub's grade name before review, so a known spelling is not reported as a conflict. The
// evidence span still points at the grower's own words. Anything not listed is returned
// unchanged, so an unknown or different grade still raises review's grade question.
// Keys are lowercase, trimmed spellings; values are grade names exactly as lots use them.
// An entry asserts what growers at this hub mean; never add a spelling that could name
// more than one grade.
export const GRADE_ALIASES: Readonly<Record<string, string>> = {
  standard: "standard",
  std: "standard",
};

export function canonicalGrade(stated: string, aliases: Readonly<Record<string, string>> = GRADE_ALIASES): string {
  const key = stated.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  return Object.hasOwn(aliases, key) ? aliases[key] : stated;
}
