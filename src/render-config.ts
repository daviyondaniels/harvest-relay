import { isAbsolute } from "node:path";

// This entry point is exclusively for the public synthetic demo. Deployment
// settings cannot accidentally turn it into the shared private workbench.
export function renderConfig(input: NodeJS.ProcessEnv) {
  const database = input.HARVEST_DB;
  if (!database || !isAbsolute(database)) throw new Error("HARVEST_DB must be an absolute path on the persistent disk.");
  if (!input.PORT || !/^\d+$/.test(input.PORT)) throw new Error("PORT must be an integer from 1 to 65535.");
  const port = Number(input.PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  return { database, port, env: {
    ...input,
    NODE_ENV: "production",
    HARVEST_PUBLIC_DEMO: "1",
    HARVEST_LIVE_CALLS: "0",
    HARVEST_SECURE_COOKIES: "1",
    MODEL_API_KEY: ""
  } };
}
