import { cookies } from "next/headers";
import { checkName } from "./names.ts";

// The coordinator's name, remembered for this browser in a cookie for one working day, so
// it is not typed on every decision. Every form that records it says "Recording as …" with
// a way to change it, so on a shared tablet the next person is not credited silently. It is
// only recorded with the coordinator's own decisions and is never sent anywhere else. The
// browser controls the cookie, so every read is checked by the same rules as a typed name.
export const NAME_COOKIE = "hr_name";
export async function rememberedName(): Promise<string | undefined> {
  const c = checkName((await cookies()).get(NAME_COOKIE)?.value);
  return "name" in c ? c.name : undefined;
}
// Secure needs HTTPS. Tailscale Serve terminates HTTPS in front of the app, but the local
// http://127.0.0.1 run must still work, so it is a deployment setting, not a request header.
export async function rememberName(name: string): Promise<void> {
  (await cookies()).set(NAME_COOKIE, name, { httpOnly: true, sameSite: "strict", path: "/", secure: process.env.HARVEST_SECURE_COOKIES === "1", maxAge: 12 * 60 * 60 });
}
// Reset demo starts over, so the remembered name goes with the day's decisions.
export async function forgetName(): Promise<void> {
  (await cookies()).delete(NAME_COOKIE);
}
// The cookie earlier versions used for the same name; removed on any action.
export async function forgetOldName(): Promise<void> {
  const jar = await cookies();
  if (jar.has("reviewer")) jar.delete("reviewer");
}
