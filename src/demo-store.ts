import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Stored } from "./store.ts";
import type { Workbench } from "./workbench.ts";

export const DEMO_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const DEMO_CAPACITY = 100;
export const DEMO_STATE_BYTES = 1024 * 1024;
export const DEMO_EXPIRED = "Your demo expired. Start a new private demo.";
export type DemoWorkspace = { load(): Stored | undefined; save(expected: number, state: Workbench): number; reset(state: Workbench): number };
export const validDemoToken = (token: unknown): token is string => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
const key = (token: string) => createHash("sha256").update(token).digest("hex");
function encoded(state: Workbench): string {
  const value = JSON.stringify(state);
  if (Buffer.byteLength(value, "utf8") > DEMO_STATE_BYTES) throw new Error("This demo is full. Export the day record and start a new demo.");
  return value;
}

// Independent of the private shared workbench table. Tokens are random bearer capabilities;
// only their hashes are stored. Absolute expiry, capacity and state-size bounds limit storage.
export function openDemoStore(path: string, options: { now?: () => number; capacity?: number; lifetimeMs?: number } = {}) {
  const now = options.now ?? Date.now, capacity = options.capacity ?? DEMO_CAPACITY, lifetime = options.lifetimeMs ?? DEMO_LIFETIME_MS;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > DEMO_CAPACITY || !Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > DEMO_LIFETIME_MS) throw new Error("Invalid demo store limits");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS demo_workspaces (id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL)");
  const read = db.prepare("SELECT version, state FROM demo_workspaces WHERE id = ? AND expires > ?");
  const swap = db.prepare("UPDATE demo_workspaces SET version = version + 1, state = ? WHERE id = ? AND version = ? AND expires > ?");
  const reset = db.prepare("UPDATE demo_workspaces SET version = version + 1, state = ? WHERE id = ? AND expires > ?");
  return {
    create(state: Workbench): string {
      const value = encoded(state), token = randomBytes(32).toString("hex"), at = now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM demo_workspaces WHERE expires <= ?").run(at);
        const count = (db.prepare("SELECT COUNT(*) AS n FROM demo_workspaces").get() as { n: number }).n;
        if (count >= capacity) throw new Error("The demo is busy. Please try again after an existing session expires.");
        db.prepare("INSERT INTO demo_workspaces (id, version, state, expires) VALUES (?, 1, ?, ?)").run(key(token), value, at + lifetime);
        db.exec("COMMIT");
        return token;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    session(token: unknown): DemoWorkspace | undefined {
      if (!validDemoToken(token)) return undefined;
      const id = key(token);
      const load = (): Stored | undefined => {
        const row = read.get(id, now()) as { version: number; state: string } | undefined;
        return row && { version: row.version, state: JSON.parse(row.state) as Workbench };
      };
      if (!load()) return undefined;
      return {
        load,
        save(expected, state) {
          if (!Number.isSafeInteger(expected) || expected < 1) throw new Error("Stored version required");
          if (swap.run(encoded(state), id, expected, now()).changes !== 1) throw new Error("The demo changed or expired; reload and review again.");
          return expected + 1;
        },
        reset(state) {
          if (reset.run(encoded(state), id, now()).changes !== 1) throw new Error(DEMO_EXPIRED);
          return load()!.version;
        }
      };
    },
    close() { db.close(); }
  };
}
