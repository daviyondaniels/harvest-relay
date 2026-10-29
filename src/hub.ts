// The longest name a person can record their decisions under: the header's name field and
// every recorded actor, reviewer and recorder use the same limit.
export const NAME_MAX = 80;

// The hub's own time zone: relative days in messages ("tmrw") and the times shown to coordinators use it.
export const HUB_ZONE = "America/Chicago";

// The calendar date (YYYY-MM-DD) in the hub's time zone at the given instant.
export function hubDay(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error("Valid timestamp required");
  return new Intl.DateTimeFormat("en-CA", { timeZone: HUB_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
