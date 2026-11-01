import test from "node:test";
import assert from "node:assert/strict";
import { splitDescribed } from "../app/lib/described.ts";

test("clearing an error keeps the field's other descriptions", () => {
  assert.deepEqual(splitDescribed("hint reply-value-error  other"), { errors: ["reply-value-error"], others: ["hint", "other"] });
  assert.deepEqual(splitDescribed(null), { errors: [], others: [] });
});
