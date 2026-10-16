import { defineConfig, devices } from "@playwright/test";
import { requireTestDatabase } from "./scripts/test-database-guard.mjs";

const databaseUrl = requireTestDatabase();

export default defineConfig({
  testDir: "tests/recovery",
  testMatch:
    process.env.AYIN_RECOVERY_TEST_V2 === "1"
      ? "upload-recovery-v2.acceptance.spec.ts"
      : "upload-recovery.acceptance.spec.ts",
  outputDir: "test-results-recovery",
  timeout: 90_000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "corepack pnpm --filter @ayin/api exec node --import tsx test/support/upload-recovery-browser-server.ts",
      url: "http://127.0.0.1:3012/stats",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        APP_ENV: "test",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
        AUTH_TOKEN_SECRET: "synthetic-browser-auth-secret-more-than-32-characters",
        UPLOAD_SESSION_SECRET: "synthetic-browser-upload-secret-more-than-32-characters",
        WEB_ORIGIN: "http://127.0.0.1:3000",
      },
    },
    {
      command: "corepack pnpm --filter @ayin/web start --hostname 0.0.0.0",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        PORT: "3000",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_MEDIA_BASE_URL: "http://media.invalid",
      },
    },
  ],
});
