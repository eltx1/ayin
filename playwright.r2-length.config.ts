import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/r2-length",
  outputDir: "test-results-r2-length",
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: { trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
