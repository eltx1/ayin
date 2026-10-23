import { defineConfig, devices } from "@playwright/test";

// Exercises the actual Next page and viewer lifecycle with controlled public
// responses. The API's separate integration suite owns real DB/policy coverage.
export default defineConfig({
  testDir: "tests/home-discovery",
  outputDir: "test-results-home-discovery",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3140",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node apps/web/node_modules/next/dist/bin/next dev apps/web --hostname 127.0.0.1 --port 3140",
    url: "http://127.0.0.1:3140",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3141",
      NEXT_PUBLIC_MEDIA_BASE_URL: "http://127.0.0.1:3142",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
