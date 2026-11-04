import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_STATE_BYTES, openDemoStore } from "../src/demo-store.ts";
import { createLedger } from "../src/updates.ts";
import { createWorkbench, receive } from "../src/workbench.ts";
import { demoSnapshot } from "../src/demo.ts";

const seed = () => createWorkbench(createLedger(demoSnapshot()));
const changed = () => receive(seed(), { id: "m1", revision: 1, growerId: "grower-a", text: "Only 30 lb Friday." }, "2026-11-03T14:00:00Z");

test("demo workspaces isolate reads, writes and resets, including the same stored version", () => {
  const db = openDemoStore(":memory:");
  try {
    const a = db.create(seed()), b = db.create(seed());
    assert.notEqual(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
    const sa = db.session(a)!, sb = db.session(b)!;
    assert.equal(sa.save(1, changed()), 2);
    assert.equal(sb.load()!.version, 1);
    assert.equal(sb.load()!.state.items.length, 0);
    assert.throws(() => sa.save(1, seed()), /changed or expired/);
    assert.equal(sa.reset(seed()), 3);
    assert.equal(sb.save(1, changed()), 2, "A's reset cannot stale B's own version");
    assert.equal(sa.load()!.state.items.length, 0);
    assert.equal(sb.load()!.state.items.length, 1);
  } finally { db.close(); }
});

test("missing, malformed and unissued tokens never fall back to an existing workspace", () => {
  const db = openDemoStore(":memory:");
  try {
    db.create(changed());
    for (const token of [undefined, "", "../shared", "' OR 1=1 --", "a".repeat(64), "A".repeat(64), "a".repeat(65)]) assert.equal(db.session(token), undefined);
  } finally { db.close(); }
});

test("expiry applies to existing handles and cannot be extended by saves or resets", () => {
  let at = 1000;
  const db = openDemoStore(":memory:", { now: () => at, lifetimeMs: 100 });
  try {
    const token = db.create(seed()), session = db.session(token)!;
    at = 1099;
    session.save(1, changed());
    at = 1100;
    assert.equal(session.load(), undefined);
    assert.equal(db.session(token), undefined);
    assert.throws(() => session.save(2, seed()), /expired/);
    assert.throws(() => session.reset(seed()), /expired/);
  } finally { db.close(); }
});

test("capacity is bounded, cleanup admits new visitors, and active workspaces survive failed creation", () => {
  let at = 1000;
  const db = openDemoStore(":memory:", { now: () => at, capacity: 1, lifetimeMs: 100 });
  try {
    const first = db.create(changed());
    assert.throws(() => db.create(seed()), /busy/);
    assert.equal(db.session(first)!.load()!.state.items.length, 1);
    at = 1100;
    const next = db.create(seed());
    assert.equal(db.session(first), undefined);
    assert.ok(db.session(next));
  } finally { db.close(); }
});

test("oversize writes are atomic and demo sessions survive reopening", () => {
  const dir = mkdtempSync(join(tmpdir(), "hr-demo-")), path = join(dir, "demo.db");
  try {
    let db = openDemoStore(path);
    const token = db.create(changed()), huge = seed();
    (huge as unknown as { padding: string }).padding = "x".repeat(DEMO_STATE_BYTES);
    assert.throws(() => db.session(token)!.save(1, huge), /demo is full/);
    assert.equal(db.session(token)!.load()!.version, 1);
    db.close();
    db = openDemoStore(path);
    assert.deepEqual(db.session(token)!.load(), { version: 1, state: changed() });
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
