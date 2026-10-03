import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw Error("PWA acceptance requires TEST_DATABASE_URL");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/ayin_e2e")
  throw Error("PWA acceptance requires an isolated local ayin_e2e database");

export default defineConfig({
  testDir: "tests/pwa",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results-pwa",
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report-pwa" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @ayin/api start",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: false,
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
        WEB_ORIGIN: "http://127.0.0.1:3100",
        CORS_ORIGIN: "http://127.0.0.1:3100",
        AYIN_E2E_STORAGE: "1",
      },
    },
    {
      command: "pnpm --filter @ayin/web start",
      url: "http://127.0.0.1:3102",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, PORT: "3102" },
    },
    {
      command: "node tests/pwa/network-proxy.mjs",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...process.env, AYIN_E2E_PWA: "1", TEST_DATABASE_URL: databaseUrl },
    },
  ],
});
