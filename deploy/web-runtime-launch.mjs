import assert from "node:assert/strict";
import { join } from "node:path";

// Match the production ayin-web PM2 working directory. Next's TypeScript config
// loader resolves local imports using this cwd even when a project argument is supplied.
export function webRuntimeLaunch(repository, port, environment) {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "Invalid Web runtime port");
  const cwd = join(repository, "apps/web");
  return {
    command: process.execPath,
    args: [
      join(cwd, "node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    options: { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  };
}
