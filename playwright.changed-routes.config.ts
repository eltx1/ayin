import { defineConfig } from "@playwright/test";
import base from "./playwright.performance.config";

// Explicitly bounded continuation for the two rendering/authority paths that changed.
export default defineConfig({
  ...base,
  testMatch: "product-performance-lab.acceptance.spec.ts",
  testIgnore: [],
  metadata: { ...base.metadata, ayinProductRouteSelection: "search-and-watch" },
  outputDir: "test-results/changed-routes",
  use: { ...base.use, trace: "off", video: "off", serviceWorkers: "block" },
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    ...(server.command.includes("@ayin/api") ? { command: "node apps/api/dist/main.js" } : {}),
    ...(server.command.includes("@ayin/web")
      ? {
          command: "pnpm --filter @ayin/web start --hostname 0.0.0.0",
          env: {
            ...server.env,
            NEXT_PUBLIC_MEDIA_BASE_URL:
              process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "http://media.invalid",
          },
        }
      : {}),
  })),
});
