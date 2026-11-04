import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cookies } from "next/headers.js";
import { DEMO_EXPIRED, DEMO_LIFETIME_MS, openDemoStore, type DemoWorkspace } from "../../src/demo-store.ts";
import type { Workbench } from "../../src/workbench.ts";

export const DEMO_COOKIE = "hr_demo";
export const publicDemo = () => process.env.HARVEST_PUBLIC_DEMO === "1";
function registry() {
  const path = process.env.HARVEST_DB ?? "data/workbench.db";
  mkdirSync(dirname(path), { recursive: true });
  return openDemoStore(path);
}
export async function startDemoSession(state: Workbench): Promise<void> {
  if (!publicDemo()) throw new Error("Isolated demo mode is not enabled.");
  const db = registry();
  let token: string;
  try { token = db.create(state); } finally { db.close(); }
  (await cookies()).set(DEMO_COOKIE, token, {
    httpOnly: true, sameSite: "strict", path: "/", secure: process.env.HARVEST_SECURE_COOKIES === "1", maxAge: DEMO_LIFETIME_MS / 1000
  });
}
export async function demoWorkspace<T>(use: (store: DemoWorkspace | undefined) => T): Promise<T> {
  const token = (await cookies()).get(DEMO_COOKIE)?.value, db = registry();
  try { return use(db.session(token)); } finally { db.close(); }
}
export const loadDemoSession = () => demoWorkspace(store => store?.load());
export const saveDemoSession = (version: number, state: Workbench) => demoWorkspace(store => {
  if (!store) throw new Error(DEMO_EXPIRED);
  return store.save(version, state);
});
export const resetDemoSession = (state: Workbench) => demoWorkspace(store => {
  if (!store) throw new Error(DEMO_EXPIRED);
  return store.reset(state);
});
