import type { NextConfig } from "next";

// The app imports the domain modules in src/ directly; they stay plain TypeScript run by
// Node for tests, so the app gets its own tsconfig with Next's settings.
const config: NextConfig = {
  typescript: { tsconfigPath: "tsconfig.app.json" },
  poweredByHeader: false
};
export default config;
