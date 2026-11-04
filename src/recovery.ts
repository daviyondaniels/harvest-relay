import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { planOf } from "./commitments.ts";
import { validateSnapshot } from "./planner.ts";
import type { Workbench } from "./workbench.ts";

const FILE = "workbench.db", MANIFEST = "manifest.json", FORMAT = "harvest-relay-sqlite-backup-v1";
const MAX_BYTES = 200 * 1024 * 1024;
type Counts = { privateWorkspaces: number; visitorWorkspaces: number };
export type BackupManifest = { format: typeof FORMAT; createdAt: string; bytes: number; sha256: string; counts: Counts };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function bytes(path: string): Buffer {
  const info = lstatSync(path);
  if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) throw new Error("Expected a regular database file of at most 200 MiB.");
  return readFileSync(path);
}
function state(raw: unknown, version: unknown): void {
  if (!Number.isSafeInteger(version) || Number(version) < 1 || typeof raw !== "string") throw new Error("Invalid stored version or state.");
  const w = JSON.parse(raw) as Workbench;
  if (!w || !w.ledger || !Number.isSafeInteger(w.ledger.version) || w.ledger.version < 0 || ![w.items, w.resolutions, w.outbox, w.ledger.events, w.ledger.records, w.ledger.forecasts].every(Array.isArray) || !Number.isSafeInteger(w.calls) || w.calls < 0) throw new Error("Unsupported workbench state.");
  validateSnapshot(w.ledger.snapshot); planOf(w.ledger);
}
// A read-only compatibility/integrity check, not an importer for arbitrary untrusted SQLite files.
export function inspectDatabase(path: string): Counts {
  bytes(path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error("Database integrity check failed.");
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(x => x.name);
    if (!tables.length || tables.some(x => x !== "workbench" && x !== "demo_workspaces")) throw new Error("Unsupported database tables.");
    const counts: Counts = { privateWorkspaces: 0, visitorWorkspaces: 0 };
    if (tables.includes("workbench")) {
      for (const row of db.prepare("SELECT id, version, state FROM workbench").all()) {
        if (row.id !== 1) throw new Error("Unsupported private workspace.");
        state(row.state, row.version); counts.privateWorkspaces++;
      }
    }
    if (tables.includes("demo_workspaces")) {
      for (const row of db.prepare("SELECT id, version, state, expires FROM demo_workspaces").all()) {
        if (typeof row.id !== "string" || !/^[a-f0-9]{64}$/.test(row.id) || !Number.isSafeInteger(row.expires) || Number(row.expires) < 1) throw new Error("Invalid visitor workspace.");
        state(row.state, row.version); counts.visitorWorkspaces++;
      }
    }
    return counts;
  } finally { db.close(); }
}
function reserve(path: string): string {
  const out = resolve(path);
  // No recursive mkdir or overwrite. The parent must exist and the destination must be new.
  mkdirSync(out, { mode: 0o700 });
  return out;
}
export async function createBackup(source: string, destination: string, at = new Date().toISOString()): Promise<BackupManifest> {
  if (!Number.isFinite(Date.parse(at))) throw new Error("Valid backup timestamp required.");
  inspectDatabase(source);
  const out = reserve(destination), file = join(out, FILE), db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, file); } finally { db.close(); }
  chmodSync(file, 0o600);
  const counts = inspectDatabase(file), content = bytes(file);
  const manifest: BackupManifest = { format: FORMAT, createdAt: new Date(at).toISOString(), bytes: content.length, sha256: hash(content), counts };
  // A failed/incomplete backup has no final manifest and cannot be restored by this tool.
  writeFileSync(join(out, MANIFEST), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return manifest;
}
export function verifyBackup(directory: string): BackupManifest {
  const manifestPath = join(directory, MANIFEST), info = lstatSync(manifestPath);
  if (!info.isFile() || info.size > 4096) throw new Error("Invalid backup manifest.");
  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (m?.format !== FORMAT || !/^[a-f0-9]{64}$/.test(m.sha256) || !Number.isFinite(Date.parse(m.createdAt)) || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > MAX_BYTES) throw new Error("Invalid backup manifest.");
  const file = join(directory, FILE), content = bytes(file);
  if (content.length !== m.bytes || hash(content) !== m.sha256) throw new Error("Backup checksum does not match; nothing was restored.");
  const counts = inspectDatabase(file);
  if (!m.counts || counts.privateWorkspaces !== m.counts.privateWorkspaces || counts.visitorWorkspaces !== m.counts.visitorWorkspaces) throw new Error("Backup workspace counts do not match.");
  return m;
}
export function restoreBackup(directory: string, destination: string): { database: string; manifest: BackupManifest } {
  const manifest = verifyBackup(directory), out = reserve(destination), file = join(out, FILE);
  copyFileSync(join(directory, FILE), file, constants.COPYFILE_EXCL); chmodSync(file, 0o600);
  // Verify the copied bytes too, so a changed source cannot bypass the pre-copy check.
  if (statSync(file).size !== manifest.bytes || hash(bytes(file)) !== manifest.sha256) throw new Error("Backup changed during restore; do not use the destination.");
  inspectDatabase(file);
  return { database: file, manifest };
}
