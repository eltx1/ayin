import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "tests/performance-media",
  outputDir: "test-results/native-media",
  reporter: [["list"], ["html", { outputFolder: "playwright-report-native-media", open: "never" }]],
  use: { ...base.use, serviceWorkers: "block", trace: "off", video: "off" },
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    ...(server.command.includes("@ayin/api") ? { command: "node apps/api/dist/main.js" } : {}),
    ...(server.command.includes("@ayin/web")
      ? {
          command: "node tests/performance-media/serve-next-with-fixture.mjs",
          env: {
            ...server.env,
            NEXT_PUBLIC_MEDIA_BASE_URL:
              process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "http://media.invalid",
            APP_ENV: "test",
            TEST_DATABASE_URL: process.env.TEST_DATABASE_URL!,
          },
        }
      : {}),
  })),
});
