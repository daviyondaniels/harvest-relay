import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { renderConfig } from "../src/render-config.ts";

test("public deployment refuses missing persistent paths and invalid listener ports", () => {
  for (const path of [undefined, "", "data/workbench.db"]) {
    assert.throws(() => renderConfig({ PORT: "10000", HARVEST_DB: path }), /absolute path/);
  }
  for (const port of [undefined, "", "0", "65536", "3.5", "10000 --help", "NaN"]) {
    assert.throws(() => renderConfig({ PORT: port, HARVEST_DB: resolve("test.db") }), /PORT/);
  }
});

test("public deployment forces isolated mode, secure cookies and zero paid calls even with conflicting settings", () => {
  const input = { PORT: "10000", HARVEST_DB: resolve("test.db"), HARVEST_PUBLIC_DEMO: "0", HARVEST_LIVE_CALLS: "99", HARVEST_SECURE_COOKIES: "0", MODEL_API_KEY: "must-not-reach-child", NODE_ENV: "development" };
  const result = renderConfig(input);
  assert.equal(result.port, 10000);
  assert.equal(result.database, input.HARVEST_DB);
  assert.equal(result.env.HARVEST_PUBLIC_DEMO, "1");
  assert.equal(result.env.HARVEST_LIVE_CALLS, "0");
  assert.equal(result.env.HARVEST_SECURE_COOKIES, "1");
  assert.equal(result.env.MODEL_API_KEY, "");
  assert.equal(result.env.NODE_ENV, "production");
  assert.equal(input.MODEL_API_KEY, "must-not-reach-child");
});
