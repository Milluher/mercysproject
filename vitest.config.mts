import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Next.js's guard against importing server code into the browser; not meaningful in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // Against a shared real Postgres (TEST_DATABASE_URL), test files must take turns, since each
    // one resets the database. PGlite gives every file its own private database.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
