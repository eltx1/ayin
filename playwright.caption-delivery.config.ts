import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/caption-delivery",
  outputDir: "test-results-caption-delivery",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3227",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node apps/web/node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3227",
    url: "http://127.0.0.1:3227/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      APP_ENV: "test",
      NEXT_PUBLIC_MEDIA_BASE_URL: "http://127.0.0.1:3228",
    },
  },
});
