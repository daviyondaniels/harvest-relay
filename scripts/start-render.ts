import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderConfig } from "../src/render-config.ts";
import { openDemoStore } from "../src/demo-store.ts";

const config = renderConfig(process.env);
process.umask(0o077);
mkdirSync(dirname(config.database), { recursive: true });
// Refuse startup if SQLite cannot initialize its schema on the mounted disk.
openDemoStore(config.database).close();
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [next, "start", "-H", "0.0.0.0", "-p", String(config.port)], {
  env: config.env, stdio: "inherit"
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1); });
