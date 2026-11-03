import { CONTACTS } from "../../src/demo.ts";
import type { HandReading } from "../../src/workbench.ts";
import { FieldError, manyMissing, type Missing } from "./errors.ts";

// The checks on the coordinator's own reading of a message, and on a logged call, kept apart from the
// server actions so a test can run them on plain values. `get` returns a field's trimmed text, "" when absent.
export type Get = (name: string) => string;
// The kinds of update the hand form offers (shown as plain words on the page).
export const KINDS = ["replace-total", "add-quantity", "correction", "forecast"] as const;
export const UNIT_CHOICES = ["g", "kg", "lb", "each", "case"] as const;

function need(get: Get, k: string, ask: string): string {
  const v = get(k);
  if (!v) throw new FieldError(ask, k);
  return v;
}
// What kind of update, which lot, how much, the grade and the day. A call note is its own evidence; any other message needs the words.
export function handFields(get: Get, callNote: boolean): HandReading {
  const operation = need(get, "operation", "Choose what kind of update this is.") as HandReading["operation"];
  if (!KINDS.includes(operation)) throw new FieldError("Choose what kind of update this is.", "operation");
  const lotId = need(get, "lot", "Choose the lot.");
  const amount = need(get, "amount", "Enter the amount.");
  // A number that is not above zero (0, -5) is told so; only what is not a whole number at all asks for one.
  if (/^-?\d+$/.test(amount) && Number(amount) <= 0) throw new FieldError("Enter an amount above zero.", "amount");
  if (!/^\d{1,9}$/.test(amount)) throw new FieldError("Enter the amount as a whole number.", "amount");
  const unit = get("unit") as (typeof UNIT_CHOICES)[number];
  if (!UNIT_CHOICES.includes(unit)) throw new FieldError("Choose a unit.", "unit");
  const grade = need(get, "grade", "Enter the grade."), deliveryOn = need(get, "day", "Choose the delivery day.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryOn)) throw new FieldError("Choose the delivery day.", "day");
  const quote = get("quote");
  if (!quote && !callNote) throw new FieldError("Copy the words in the message that support this.", "quote");
  return { operation, lotId, quantity: { amount: Number(amount), unit }, grade, deliveryOn, ...(get("target") ? { correctsEventId: get("target") } : {}), ...(quote ? { quote } : {}) };
}

// Log a call: everything missing, in the order the fields sit on the page.
export function callMissing(growerId: string, note: string, nameNeeded: boolean): Missing[] {
  return [
    ...(!CONTACTS.some(c => c.id === growerId) ? [{ field: "grower", what: "who called" }] : []),
    ...(!note ? [{ field: "note", what: "the call note" }] : []),
    ...(nameNeeded ? [{ field: "who", what: "your name" }] : [])
  ];
}
// One refusal naming every missing field, focused on the first; undefined when fewer than two are missing
// (a single missing field keeps its own, more specific message).
export const callRefusal = (growerId: string, note: string, nameNeeded: boolean): FieldError | undefined => manyMissing(callMissing(growerId, note, nameNeeded));
