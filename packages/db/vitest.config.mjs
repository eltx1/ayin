import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["../../scripts/check-test-database.mjs"] },
});
