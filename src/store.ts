import { DatabaseSync } from "node:sqlite";
import type { Workbench } from "./workbench.ts";

// Single-process local store: the whole workbench as one versioned JSON row. Every save
// names the version it was built from, and the update only succeeds if that is still
// the stored version, so two tabs acting on the same state cannot overwrite each other.
// Local SQLite is not portable to hosts without durable disk; swap this adapter first.
export type Stored = { version: number; state: Workbench };
export type Store = { load(): Stored | undefined; save(expected: number, state: Workbench): number; reset(state: Workbench): number; close(): void };

export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS workbench (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, state TEXT NOT NULL)");
  const read = db.prepare("SELECT version, state FROM workbench WHERE id = 1");
  const swap = db.prepare("UPDATE workbench SET version = version + 1, state = ? WHERE id = 1 AND version = ?");
  const put = db.prepare("INSERT INTO workbench (id, version, state) VALUES (1, 1, ?) ON CONFLICT (id) DO UPDATE SET version = version + 1, state = excluded.state");
  return {
    load() {
      const row = read.get() as { version: number; state: string } | undefined;
      return row && { version: row.version, state: JSON.parse(row.state) as Workbench };
    },
    save(expected, state) {
      if (!Number.isSafeInteger(expected)) throw new Error("Stored version required");
      if (swap.run(JSON.stringify(state), expected).changes !== 1) throw new Error("The workbench changed since you loaded it; reload and review again");
      return expected + 1;
    },
    // Explicit reset to a seed state, recorded as a new version so open tabs see it as a change.
    reset(state) { put.run(JSON.stringify(state)); return (read.get() as { version: number }).version; },
    close() { db.close(); }
  };
}
