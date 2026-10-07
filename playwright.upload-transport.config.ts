import { defineConfig, devices } from "@playwright/test";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== "/ayin_e2e" ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw Error("Upload transport lab requires isolated local ayin_e2e.");
export default defineConfig({
  testDir: "tests/performance-upload",
  testMatch: "*.acceptance.spec.ts",
  outputDir: "test-results/upload-transport",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "off",
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
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      env: {
        ...process.env,
        APP_ENV: "test",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
        AYIN_LAB_DIRECT_TRANSFER: "1",
        AUTH_TOKEN_SECRET: "synthetic-browser-auth-secret-more-than-32-characters",
        UPLOAD_SESSION_SECRET: "synthetic-browser-upload-secret-more-than-32-characters",
        WEB_ORIGIN: "http://127.0.0.1:3000",
      },
    },
    {
      command: "corepack pnpm --filter @ayin/web start --hostname 0.0.0.0",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      env: {
        ...process.env,
        PORT: "3000",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_MEDIA_BASE_URL:
          process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "http://media.invalid",
      },
    },
  ],
});
