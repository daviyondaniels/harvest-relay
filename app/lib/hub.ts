import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEMO_EXTRAS_PATH, needsReset, seedWorkbench, type Extras, type Recording } from "../../src/seed.ts";
import { openStore, type Store, type Stored } from "../../src/store.ts";
import { latestChange, type Workbench } from "../../src/workbench.ts";

// Server-only access to the demo hub's stored workbench. Every action names the stored
// version its page was rendered from; if anything changed since, the action is refused
// and the coordinator sees the current state before deciding again.
const DB = process.env.HARVEST_DB ?? "data/workbench.db";
const READINGS = "data/seed-readings.json";
let store: Store | undefined;
function db(): Store {
  if (!store) { mkdirSync(dirname(DB), { recursive: true }); store = openStore(DB); }
  return store;
}

export function recording(): Recording | undefined {
  return existsSync(READINGS) ? JSON.parse(readFileSync(READINGS, "utf8")) as Recording : undefined;
}

// Local-only recorded model output for the resolution demo; absent or malformed means the
// demo falls back to templates and uninterpreted replies.
export function extras(): Extras | undefined {
  if (!existsSync(DEMO_EXTRAS_PATH)) return undefined;
  try {
    const x = JSON.parse(readFileSync(DEMO_EXTRAS_PATH, "utf8")) as Extras;
    const strings = (o: unknown) => !!o && typeof o === "object" && !Array.isArray(o) && Object.values(o).every(v => typeof v === "string");
    return typeof x?.model === "string" && typeof x.promptVersion === "string" && typeof x.recordedAt === "string" && strings(x.drafts) && strings(x.readings) ? x : undefined;
  } catch { return undefined; }
}

export async function current(): Promise<Stored> {
  const s = db().load();
  if (s && !needsReset(s.state)) return s;
  db().reset(await seedWorkbench(recording()));
  return db().load()!;
}

export class StaleView extends Error {}
// With rebase, a version mismatch runs the action on the current state instead of refusing.
// Only actions whose domain check re-validates exactly what the page showed may ask for it.
export function staleMessage(w: Workbench): string {
  const what = latestChange(w);
  return `Something changed in another tab or window${what ? `: ${what}` : ""}. Check the page and try again.`;
}
export async function act(expected: number, f: (w: Workbench) => Workbench | Promise<Workbench>, opts: { rebase?: boolean } = {}): Promise<void> {
  const s = await current();
  if (s.version !== expected && !opts.rebase) throw new StaleView(staleMessage(s.state));
  db().save(s.version, await f(s.state));
}

export async function resetDemo(): Promise<void> { db().reset(await seedWorkbench(recording())); }
