import { requireTestDatabase } from "./test-database-guard.mjs";

// Unit tests may run with no database at all. Any supplied database must be safe,
// including when Vitest is invoked directly instead of through the root scripts.
if (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL) {
  requireTestDatabase();
}
