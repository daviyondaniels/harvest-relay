export type BaseUnit = "g" | "lb" | "each";
export type Quantity = {
  amount: number;
  unit: "g" | "kg" | "lb" | "each" | "case";
  pack?: { amount: number; unit: BaseUnit };
};
export type Normalized = { amount: number; unit: BaseUnit };

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
      if (q.pack.amount === 0) throw new Error("Pack amount must be positive");
      amount *= q.pack.amount;
      unit = q.pack.unit;
      break;
    default: throw new Error("Unsupported unit; clarification required");
  }
  integer(amount, "normalized quantity");
  return { amount, unit };
}
