import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const release = resolve("deploy/release.sh");
const sha = "1".repeat(40);
const digest = "2".repeat(64);

function fixture(mode) {
  const directory = mkdtempSync(join(tmpdir(), "ayin-release-artifact-test-"));
  const commands = join(directory, "bin");
  const root = join(directory, "releases");
  const previous = join(root, "previous");
  const current = join(directory, "current");
  const log = join(directory, "commands.log");
  mkdirSync(commands);
  mkdirSync(previous, { recursive: true });
  symlinkSync(previous, current);
  const executable = (name, body) =>
    writeFileSync(join(commands, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
      mode: 0o755,
    });
  executable(
    "git",
    `
if [[ "$1" == clone ]]; then
  target="\${@: -1}"
  mkdir -p "$target/deploy" "$target/apps/web"
  printf '%s\\n' "$TEST_NODE_VERSION" > "$target/.nvmrc"
  printf '#!/usr/bin/env bash\\nexit 0\\n' > "$target/deploy/ensure-ffmpeg-runtime.sh"
elif [[ "$*" == *'rev-parse HEAD'* ]]; then
  printf '%s\\n' "$TEST_SHA"
fi`,
  );
  executable(
    "node",
    `
if [[ "$1" == --version ]]; then printf 'v%s\\n' "$TEST_NODE_VERSION"; exit 0; fi
printf 'node %s\\n' "$*" >> "$TEST_LOG"
if [[ "$1" == deploy/web-build-artifact.mjs ]]; then
  [[ "$2" == install && "$4" == "$TEST_SHA" && "$6" == "$TEST_DIGEST" ]]
  [[ "$(readlink "$TEST_CURRENT")" == "$TEST_PREVIOUS" ]]
  if [[ "$TEST_MODE" == invalid ]]; then exit 65; fi
fi`,
  );
  executable("corepack", 'printf "corepack %s\\n" "$*" >> "$TEST_LOG"');
  executable("pnpm", 'printf "pnpm %s\\n" "$*" >> "$TEST_LOG"');
  executable("curl", 'printf "curl\\n" >> "$TEST_LOG"');
  executable(
    "pm2",
    `
printf 'pm2 %s\\n' "$*" >> "$TEST_LOG"
if [[ "$1" == pid ]]; then printf '123\\n'; fi`,
  );
  const webEnv = join(directory, "web.env");
  const apiEnv = join(directory, "api.env");
  const artifact = join(directory, "web.tar.gz");
  writeFileSync(webEnv, "NODE_ENV=production\n", { mode: 0o600 });
  writeFileSync(apiEnv, "NODE_ENV=production\n", { mode: 0o600 });
  writeFileSync(artifact, "fake archive for release invocation test");
  return {
    directory,
    root,
    previous,
    current,
    log,
    artifact,
    env: {
      ...process.env,
      PATH: `${commands}:${process.env.PATH}`,
      AYIN_ROOT: directory,
      AYIN_RELEASES_DIR: root,
      AYIN_CURRENT_LINK: current,
      AYIN_WEB_ENV_FILE: webEnv,
      AYIN_API_ENV_FILE: apiEnv,
      AYIN_DEPLOY_LOCK_FILE: join(directory, "deploy.lock"),
      TEST_NODE_VERSION: process.versions.node,
      TEST_SHA: sha,
      TEST_DIGEST: digest,
      TEST_MODE: mode,
      TEST_LOG: log,
      TEST_CURRENT: current,
      TEST_PREVIOUS: previous,
    },
  };
}

for (const mode of ["invalid", "valid"]) {
  test(`release ${mode === "valid" ? "installs verified Web artifact before migration and activation" : "stops before migration and activation when Web artifact is rejected"}`, () => {
    const state = fixture(mode);
    try {
      const result = spawnSync("bash", [release, sha, state.artifact, digest], {
        env: state.env,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.ifError(result.error);
      const log = readFileSync(state.log, "utf8");
      assert.match(log, /web-build-artifact\.mjs install/);
      assert.doesNotMatch(log, /@ayin\/web run build|next build/);
      if (mode === "invalid") {
        assert.equal(result.status, 65, result.stderr);
        assert.doesNotMatch(log, /db:migrate:deploy|pm2 /);
        assert.equal(readlinkSync(state.current), state.previous);
        assert.deepEqual(readdirSync(state.root), ["previous"]);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.ok(log.indexOf("web-build-artifact.mjs install") < log.indexOf("db:migrate:deploy"));
        assert.ok(log.indexOf("db:migrate:deploy") < log.indexOf("pm2 "));
        assert.notEqual(readlinkSync(state.current), state.previous);
      }
    } finally {
      rmSync(state.directory, { recursive: true, force: true });
    }
  });
}

test("release requires a Web artifact instead of falling back to a host compilation", () => {
  const result = spawnSync("bash", [release, sha], { encoding: "utf8" });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /verified-web-archive/);
});
