import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== "/ayin_e2e" ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("Player acceptance requires isolated local ayin_e2e.");

// Build the web app with these same public URLs before starting this suite.
// Same-origin synthetic media makes text-track decoding part of the test without
// claiming that an external provider's CORS or playback deployment was verified.
const environment = {
  ...process.env,
  APP_ENV: "test",
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  AUTH_TOKEN_SECRET: "player-locale-test-auth-secret-with-more-than-32-characters",
  UPLOAD_SESSION_SECRET: "player-locale-test-upload-secret-with-more-than-32-characters",
  WEB_ORIGIN: "http://127.0.0.1:3000",
  CORS_ORIGIN: "http://127.0.0.1:3000",
  NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001",
  NEXT_PUBLIC_MEDIA_BASE_URL: "http://127.0.0.1:3000",
};

export default defineConfig({
  testDir: "tests/player-localization",
  outputDir: "test-results-player-localization",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-player-localization" }],
  ],
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
      env: { ...environment, API_HOST: "127.0.0.1", PORT: "3001" },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @ayin/web start --hostname 0.0.0.0",
      url: "http://127.0.0.1:3000",
      env: { ...environment, PORT: "3000" },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
