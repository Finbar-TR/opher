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
      // Prisma resolves file:./dev.db relative to the schema directory.
      DATABASE_URL: "file:./dev.db",
    },
  },
});
