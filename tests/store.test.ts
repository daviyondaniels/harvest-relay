import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scenario } from "../evaluation/scenario.ts";
import { openStore } from "../src/store.ts";
import { createLedger } from "../src/updates.ts";
import { createWorkbench, receive } from "../src/workbench.ts";

test("saves are compare-and-swap on the stored version, and state survives reopening", () => {
  const dir = mkdtempSync(join(tmpdir(), "harvest-store-")), path = join(dir, "workbench.db");
  try {
    const seed = createWorkbench(createLedger(scenario()));
    let store = openStore(path);
    assert.equal(store.load(), undefined);
    assert.equal(store.reset(seed), 1);
    const loaded = store.load()!;
    const next = receive(loaded.state, { id: "m1", revision: 1, growerId: "grower-a", text: "Only 30 kg of tomatoes." }, "2026-10-28T09:00:00Z");
    assert.equal(store.save(loaded.version, next), 2);
    assert.throws(() => store.save(loaded.version, seed), /changed since you loaded it/, "a second tab saving from version 1 is refused");
    store.close();
    store = openStore(path);
    assert.deepEqual(store.load(), { version: 2, state: next });
    assert.equal(store.reset(seed), 3);
    assert.deepEqual(store.load()!.state, seed);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
