import { parseOperation } from "../../src/answers.ts";
import type { Field } from "../../src/updates.ts";
import { FieldError } from "./errors.ts";

// Reads a value typed by the coordinator, in the same shapes the model must use.
export function value(fieldName: Field, raw: string, at = "value"): unknown {
  if (!raw) throw new FieldError("Enter the value.", at);
  if (fieldName === "operation") {
    const kind = parseOperation(raw);
    if (!kind) throw new FieldError("Choose what changed: a new total, added to what they have, a correction or a forecast.", at);
    return kind;
  }
  if (fieldName === "quantity" || fieldName === "unit" || fieldName === "pack") {
    const m = raw.toLowerCase().match(/^(\d+)\s*(g|kg|lbs?|each|cases?)$/);
    if (!m) throw new FieldError(`Write the ${fieldName === "pack" ? "contents of one case" : "quantity"} as a whole number and a unit, like "3 kg", "30 lb" or "4 cases".`, at);
    const unit = m[2].startsWith("case") ? "case" : m[2] === "lbs" ? "lb" : m[2];
    if (fieldName === "pack" && unit === "case") throw new FieldError("Write the contents of one case in g, kg, lb or each.", at);
    return { amount: Number(m[1]), unit };
  }
  return raw;
}
