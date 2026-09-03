import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Neutralise the server-only guard for Node-based integration tests.
      "server-only": path.resolve(__dirname, "test/empty-module.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Integration tests share one SQLite file, and runCycles sweeps globally,
    // so files must not run concurrently.
    fileParallelism: false,
    env: {
      // Pin the clock's zone so any accidental local-time formatting fails
      // here rather than only for users west of Greenwich. Delivery and charge
      // dates are UTC throughout.
      TZ: "America/New_York",
      // Prisma resolves file:./dev.db relative to the schema directory.
      DATABASE_URL: "file:./dev.db",
    },
  },
});
