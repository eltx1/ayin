import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { webRuntimeLaunch } from "./web-runtime-launch.mjs";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const environment = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  NEXT_PUBLIC_API_BASE_URL: "https://api.ayin.stream",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayin.stream",
};

test("artifact smoke uses the real production PM2 Web launch contract", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "ayin-web-launch-"));
  try {
    const webEnv = join(temporary, "web.env");
    const apiEnv = join(temporary, "api.env");
    await writeFile(webEnv, "NODE_ENV=production\n", { mode: 0o600 });
    await writeFile(apiEnv, "NODE_ENV=production\n", { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        'const config = require(process.argv[1]); const web = config.apps.find(app => app.name === "ayin-web"); console.log(JSON.stringify({cwd:web.cwd,script:web.script,args:web.args}));',
        join(repository, "deploy/ecosystem.config.cjs"),
      ],
      {
        env: {
          ...environment,
          AYIN_CURRENT_DIR: repository,
          AYIN_WEB_ENV_FILE: webEnv,
          AYIN_API_ENV_FILE: apiEnv,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const production = JSON.parse(result.stdout);
    const launch = webRuntimeLaunch(repository, 3000, environment);
    assert.equal(launch.options.cwd, production.cwd);
    assert.deepEqual(launch.args, [production.script, ...production.args.split(" ")]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("actual pinned Next loads the production TypeScript configuration with local CSP imports", () => {
  const launch = webRuntimeLaunch(repository, 3000, environment);
  const result = spawnSync(
    launch.command,
    [
      "-e",
      'require(process.argv[1]).default("phase-production-server", process.cwd()).then(async config => { const headers = await config.headers(); if (!headers[0].headers.some(header => header.key === "Content-Security-Policy" && header.value.includes("object-src"))) throw new Error("Missing enforced CSP"); console.log("production-config-loaded"); }).catch(error => { console.error(error); process.exitCode = 1; });',
      join(repository, "apps/web/node_modules/next/dist/server/config"),
    ],
    { ...launch.options, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /production-config-loaded/);
});
