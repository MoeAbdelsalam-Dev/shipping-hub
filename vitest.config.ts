import { defineConfig } from "vitest/config";

// Unit tests only (pure rule/config logic). Kept separate from vite.config.ts,
// whose React Router plugin is for the app build.
export default defineConfig({
  test: { include: ["app/**/*.test.ts", "carriers/**/*.test.ts"] },
});
