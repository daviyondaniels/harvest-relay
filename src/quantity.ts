export type BaseUnit = "g" | "lb" | "each";
export type Quantity = {
  amount: number;
  unit: "g" | "kg" | "lb" | "each" | "case";
  pack?: { amount: number; unit: BaseUnit };
};
export type Normalized = { amount: number; unit: BaseUnit };

// Sanity ceilings, so a slipped key never reaches a review. Counted in the unit people say:
// pounds or pieces as they are, grams as kilograms.
export const MAX_AMOUNT = 100_000;
export const MAX_PACK = 2_000;
export const TOO_MUCH = "That amount is more than this hub handles (over 100,000 lb, or 2,000 per case). Check it.";
const PER_UNIT = { g: 1000, lb: 1, each: 1 } as const;
export function checkAmount(amount: number, unit: BaseUnit): void {
  if (amount > MAX_AMOUNT * PER_UNIT[unit]) throw new Error(TOO_MUCH);
}
export function checkPack(pack: { amount: number; unit: BaseUnit }): void {
  if (pack.amount === 0) throw new Error("Case contents must be more than zero.");
  if (pack.amount > MAX_PACK * PER_UNIT[pack.unit]) throw new Error(TOO_MUCH);
}

export function integer(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field}: nonnegative safe integer required`);
}

export function normalize(q: Quantity): Normalized {
  integer(q.amount, "quantity");
  let amount = q.amount;
  let unit: BaseUnit;
  switch (q.unit) {
    case "g": unit = "g"; break;
    case "kg": amount *= 1000; unit = "g"; break;
    case "lb": unit = "lb"; break;
    case "each": unit = "each"; break;
    case "case":
      if (!q.pack || !["g", "lb", "each"].includes(q.pack.unit)) throw new Error("Clarify the confirmed contents of one case");
      integer(q.pack.amount, "pack amount");
      checkPack(q.pack);
      amount *= q.pack.amount;
      unit = q.pack.unit;
      break;
    default: throw new Error("Unsupported unit; clarification required");
  }
  integer(amount, "normalized quantity");
  checkAmount(amount, unit);
  return { amount, unit };
}
