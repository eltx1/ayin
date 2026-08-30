import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required for Playwright E2E.");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @ayin/api start",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        APP_ENV: "test",
        API_HOST: "127.0.0.1",
        PORT: "3001",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
        AUTH_TOKEN_SECRET: "task-29-e2e-auth-secret-with-more-than-32-characters",
        UPLOAD_SESSION_SECRET: "task-29-e2e-upload-secret-with-more-than-32-characters",
        WEB_ORIGIN: "http://127.0.0.1:3000",
        CORS_ORIGIN: "http://127.0.0.1:3000",
        AYIN_E2E_STORAGE: "1",
      },
    },
    {
      command: "pnpm --filter @ayin/web start",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: "3000",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_MEDIA_BASE_URL: "http://media.invalid",
      },
    },
  ],
});
