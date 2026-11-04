"use server";
import { redirect } from "next/navigation";
import { recording } from "../lib/hub.ts";
import { publicDemo, startDemoSession } from "../lib/demo-session.ts";
import { forgetName } from "../lib/name.ts";
import { seedWorkbench } from "../../src/seed.ts";

export async function startDemoAction() {
  if (!publicDemo()) redirect("/");
  try {
    await startDemoSession(await seedWorkbench(recording()));
    await forgetName();
  } catch { redirect("/start?busy=1"); }
  redirect("/guide");
}
