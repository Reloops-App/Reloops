import { defineConfig } from "@playwright/test";

const integration = process.env.RELOOPS_TEST_INTEGRATION === "1";

export default defineConfig({
  testDir: "tests/browser",
  testMatch: process.env.RELOOPS_TEST_INTEGRATION === "1" ? "**/*.integration.spec.ts" : "**/*.spec.ts",
  testIgnore: process.env.RELOOPS_TEST_INTEGRATION === "1" ? [] : ["**/*.integration.spec.ts"],
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.RELOOPS_TEST_URL || "http://127.0.0.1:6273",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {},
  },
  webServer: process.env.RELOOPS_TEST_URL ? undefined : {
    command: "pnpm --filter @reloops/web dev --host 127.0.0.1 --port 6273 --strictPort",
    url: "http://127.0.0.1:6273/tests/browser/harness.html",
    reuseExistingServer: !process.env.CI,
    // Integration tests use the real keys written by sync-env. Standalone
    // browser tests can run on a clean checkout with no backend or .env file.
    env: integration ? {} : {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "http://127.0.0.1:56321",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "browser-tests-no-backend",
    },
  },
});
