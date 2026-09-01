"use strict";

const { spawnSync } = require("node:child_process");
const { loadEnvFile } = require("./env-file.cjs");

const [envFile, command, ...args] = process.argv.slice(2);

if (!envFile || !command) {
  console.error("usage: node deploy/run-with-env.cjs <env-file> <command> [args...]");
  process.exit(64);
}

const environment = {
  ...process.env,
  ...loadEnvFile(envFile),
};

const result = spawnSync(command, args, {
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  console.error(`failed to execute ${command}: ${result.error.message}`);
  process.exit(69);
}

process.exit(result.status ?? 1);
