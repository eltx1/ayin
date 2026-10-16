import { spawnSync } from "node:child_process";
import { requireTestDatabase } from "./test-database-guard.mjs";

const url = requireTestDatabase();
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("A test command is required.");
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
