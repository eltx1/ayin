import { defineConfig, devices } from "@playwright/test";
import largeRecovery from "./playwright.upload-large-recovery.config";

// The same real-byte test and isolated PostgreSQL/provider setup run in the
// Safari browser engine. Device emulation does not claim physical iPhone coverage.
export default defineConfig({
  ...largeRecovery,
  outputDir: "test-results/upload-webkit-recovery",
  projects: [{ name: "webkit-iphone", use: { ...devices["iPhone 13"], browserName: "webkit" } }],
});
