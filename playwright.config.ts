import { defineConfig } from "@playwright/test";

const PORT = 3100;

/**
 * End-to-end tests against a production build with the demo data, in a throwaway local database.
 * Run with `npm run test:e2e` (builds first).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `rm -rf .data/e2e && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    env: { PGLITE_DIR: ".data/e2e", SEED_DEMO: "true", SETUP_TOKEN: "e2e-setup-code-not-secret" },
  },
});
