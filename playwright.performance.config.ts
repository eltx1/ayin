import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Focused measurement entry point: bind the known loopback host explicitly,
// without querying the executor's restricted network-interface inventory.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: [
    "performance-lab.acceptance.spec.ts",
    "product-performance-lab.acceptance.spec.ts",
    "search-locale-cors.acceptance.spec.ts",
  ],
  outputDir: "test-results/performance",
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    reuseExistingServer: false,
    ...(server.command.includes("@ayin/web")
      ? { command: server.command + " --hostname 127.0.0.1" }
      : {}),
  })),
});
