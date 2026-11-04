import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup, inspectDatabase, restoreBackup, verifyBackup } from "../src/recovery.ts";
import { openStore } from "../src/store.ts";
import { openDemoStore } from "../src/demo-store.ts";
import { createWorkbench, receive } from "../src/workbench.ts";
import { createLedger } from "../src/updates.ts";
import { demoSnapshot } from "../src/demo.ts";
const seed = () => createWorkbench(createLedger(demoSnapshot()));
const changed = () => receive(seed(), { id: "drill-1", revision: 1, growerId: "grower-a", text: "Only 30 lb of tomatoes Friday." }, "2026-11-03T14:00:00Z");
const temp = () => mkdtempSync(join(tmpdir(), "hr-recovery-"));

test("backup includes committed WAL state and restores both workspace modes with exact versions and history", async () => {
  const dir = temp(), source = join(dir, "source.db"), bundle = join(dir, "backup");
  const privateStore = openStore(source), wal = new DatabaseSync(source), visitors = openDemoStore(source);
  try {
    wal.exec("PRAGMA journal_mode = WAL");
    privateStore.reset(seed()); privateStore.save(1, changed());
    const a = visitors.create(seed()), b = visitors.create(changed()); visitors.session(a)!.save(1, changed());
    const manifest = await createBackup(source, bundle);
    assert.deepEqual(manifest.counts, { privateWorkspaces: 1, visitorWorkspaces: 2 });
    assert.deepEqual(verifyBackup(bundle), manifest);
    privateStore.reset(seed()); visitors.session(a)!.reset(seed());
    const restored = restoreBackup(bundle, join(dir, "restored"));
    const p = openStore(restored.database), v = openDemoStore(restored.database);
    try {
      assert.deepEqual(p.load(), { version: 2, state: changed() });
      assert.deepEqual(v.session(a)!.load(), { version: 2, state: changed() });
      assert.deepEqual(v.session(b)!.load(), { version: 1, state: changed() });
      assert.throws(() => p.save(1, seed()), /changed since/);
      assert.equal(p.save(2, seed()), 3, "the recovered store can continue CAS writes");
    } finally { p.close(); v.close(); }
  } finally { privateStore.close(); visitors.close(); wal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("backup and restore never overwrite existing directories or the live database", async () => {
  const dir = temp(), source = join(dir, "source.db"), bundle = join(dir, "backup"), store = openStore(source);
  try {
    store.reset(changed()); await createBackup(source, bundle);
    const before = readFileSync(join(bundle, "workbench.db"));
    await assert.rejects(createBackup(source, bundle), /exist/i);
    assert.throws(() => restoreBackup(bundle, dir), /exist/i);
    assert.throws(() => restoreBackup(bundle, source), /exist/i);
    assert.deepEqual(readFileSync(join(bundle, "workbench.db")), before);
    assert.deepEqual(store.load()!.state, changed());
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("missing sources, corrupt SQLite and unsupported application state fail without a usable backup", async () => {
  const dir = temp();
  try {
    const missing = join(dir, "missing.db");
    await assert.rejects(createBackup(missing, join(dir, "missing-backup")));
    assert.equal(existsSync(missing), false); assert.equal(existsSync(join(dir, "missing-backup")), false);
    const bad = join(dir, "bad.db"); writeFileSync(bad, "not sqlite");
    assert.throws(() => inspectDatabase(bad));
    const wrong = join(dir, "wrong.db"), db = new DatabaseSync(wrong);
    db.exec("CREATE TABLE other (id INTEGER)"); db.close();
    await assert.rejects(createBackup(wrong, join(dir, "wrong-backup")), /Unsupported/);
    const broken = join(dir, "broken.db"), s = openStore(broken);
    s.reset(seed()); s.close();
    const d = new DatabaseSync(broken); d.exec("UPDATE workbench SET state = '{}' WHERE id = 1"); d.close();
    await assert.rejects(createBackup(broken, join(dir, "broken-backup")), /Unsupported/);
    assert.equal(existsSync(join(dir, "broken-backup")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tampered bytes or manifest fail verification before creating a restore directory", async () => {
  const dir = temp(), source = join(dir, "source.db"), bundle = join(dir, "backup"), store = openStore(source);
  try {
    store.reset(seed()); await createBackup(source, bundle);
    const mpath = join(bundle, "manifest.json"), manifest = readFileSync(mpath, "utf8"), m = JSON.parse(manifest);
    writeFileSync(mpath, JSON.stringify({ ...m, counts: { privateWorkspaces: 0, visitorWorkspaces: 0 } }));
    assert.throws(() => restoreBackup(bundle, join(dir, "restored")), /counts/);
    writeFileSync(mpath, manifest);
    const path = join(bundle, "workbench.db"), data = readFileSync(path); data[data.length - 1] ^= 1; writeFileSync(path, data);
    assert.throws(() => restoreBackup(bundle, join(dir, "restored")), /checksum/);
    assert.equal(existsSync(join(dir, "restored")), false);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("restore preserves absolute visitor expiry instead of renewing or resurrecting sessions", async () => {
  const dir = temp(), source = join(dir, "source.db"), bundle = join(dir, "backup");
  let at = 1000;
  const visitors = openDemoStore(source, { now: () => at, lifetimeMs: 100 });
  try {
    const token = visitors.create(changed()); await createBackup(source, bundle);
    at = 1100;
    const restored = restoreBackup(bundle, join(dir, "restored")), v = openDemoStore(restored.database, { now: () => at });
    try { assert.equal(v.session(token), undefined); } finally { v.close(); }
  } finally { visitors.close(); rmSync(dir, { recursive: true, force: true }); }
});
