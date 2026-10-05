import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for caption browser acceptance.");
const environment = {
  ...process.env,
  APP_ENV: "test",
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  AUTH_TOKEN_SECRET: "caption-browser-auth-secret-with-more-than-32-characters",
  UPLOAD_SESSION_SECRET: "caption-browser-upload-secret-with-more-than-32-characters",
  PAYOUT_DATA_ENCRYPTION_KEY: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk=",
  WEB_ORIGIN: "http://127.0.0.1:3000",
  CORS_ORIGIN: "http://127.0.0.1:3000",
  NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
  NEXT_PUBLIC_MEDIA_BASE_URL: "http://127.0.0.1:3002",
};
// Separate from the default E2E adapter: these journeys require independently
// observed HTTP PUT bytes, HEAD metadata and bounded reads, never hardcoded VTT.
export default defineConfig({
  testDir: "tests/captions",
  timeout: 60_000,
  globalTimeout: 180_000,
  outputDir: "test-results-captions",
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report-captions" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/e2e/caption-storage-server.mjs",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      timeout: 120_000,
      env: environment,
    },
    {
      command: "pnpm --filter @ayin/web start --hostname 0.0.0.0",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      timeout: 120_000,
      env: environment,
    },
  ],
});
