import { defineConfig, devices } from "@playwright/test";

import { requireTestDatabase } from "./scripts/test-database-guard.mjs";

const databaseUrl = requireTestDatabase();

export default defineConfig({
  testDir: "tests/e2e",
  // The new 42-sample product lab runs only through its dedicated entry point.
  // Existing Browse/Analytics measurement cases retain their prior CI placement.
  testIgnore: ["**/product-performance-lab.acceptance.spec.ts"],
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
  // Keep the complete suite on Chromium; only these bounded critical journeys
  // are repeated on the other engines (not the visual/performance labs).
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox-critical",
      testMatch: [
        "**/cross-browser-critical.acceptance.spec.ts",
        "**/upload-transport.acceptance.spec.ts",
        "**/quick-upload-account-scope.acceptance.spec.ts",
      ],
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit-critical",
      testMatch: [
        "**/cross-browser-critical.acceptance.spec.ts",
        "**/upload-transport.acceptance.spec.ts",
        "**/quick-upload-account-scope.acceptance.spec.ts",
      ],
      use: { ...devices["Desktop Safari"] },
    },
  ],
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
        WEB_ORIGIN: "http://127.0.0.1:3000",
        CORS_ORIGIN: "http://127.0.0.1:3000",
        AYIN_E2E_STORAGE: "1",
        AYIN_INTERNAL_EDGE_TOKEN: "controlled-e2e-viewer-policy-edge-token-more-than32",
        AYIN_TRUST_CLOUDFLARE_REGION: "false",
      },
    },
    {
      command: "pnpm --filter @ayin/web start",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: "3000",
        NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
        NEXT_PUBLIC_MEDIA_BASE_URL: "http://media.invalid",
        AYIN_INTERNAL_EDGE_TOKEN: "controlled-e2e-viewer-policy-edge-token-more-than32",
      },
    },
  ],
});
