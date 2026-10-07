import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(resolve(".github/workflows/deploy.yml"), "utf8");
const host = "13.52.116.200";
const port = "22";
const pinnedFingerprint = "SHA256:YoUNEx7Aizhzl99TReL4kGCyUY6KopzrPuPgRmhDC0Y";

// Public test data only: SSH wire-format Ed25519 keys, with no private key.
const keyBlob = (byte) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from("ssh-ed25519"),
    Buffer.from([0, 0, 0, 32]),
    Buffer.alloc(32, byte),
  ]);
const fixtureKey = `${host} ssh-ed25519 ${keyBlob(7).toString("base64")}\n`;
const wrongKey = `${host} ssh-ed25519 ${keyBlob(8).toString("base64")}\n`;
const fixtureFingerprint = `SHA256:${createHash("sha256").update(keyBlob(7)).digest("base64").replace(/=+$/, "")}`;

function stepScript(name) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split("\n      - name: ")[0];
  assert.ok(step, `Missing workflow step: ${name}`);
  const script = step.split("        run: |\n")[1];
  assert.ok(script, `Missing workflow script: ${name}`);
  return script.replace(/^          /gm, "");
}

const stepNames = [
  "Configure pinned AYIN SSH trust",
  "Verify isolated AYIN account",
  "Transfer trusted bootstrap deploy script",
  "Deploy exact validated commit",
];
const scripts = stepNames.map(stepScript);

function commandPath(name) {
  const result = spawnSync("bash", ["-c", 'command -v "$1"', "--", name], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${name} is required for deployment tooling tests`);
  return result.stdout.trim();
}

test("workflow preserves production trust inputs and stops downstream steps on failure", () => {
  assert.ok(workflow.includes(`DEPLOY_HOST: ${host}\n`));
  assert.ok(workflow.includes(`SSH_PORT: "${port}"\n`));
  assert.ok(workflow.includes(`PINNED_SSH_HOST_FINGERPRINT: ${pinnedFingerprint}\n`));
  assert.ok(workflow.includes("DEPLOY_KEY: ${{ secrets.AYIN_DEPLOY_SSH_KEY }}"));
  assert.ok(workflow.includes("ref: ${{ env.RELEASE_SHA }}"));
  for (const name of stepNames) {
    const step = workflow.split(`      - name: ${name}\n`)[1].split("\n      - name: ")[0];
    assert.doesNotMatch(step, /continue-on-error:|^        if:/m);
  }
  const stepOffsets = stepNames.map((name) => workflow.indexOf(`      - name: ${name}\n`));
  assert.deepEqual(
    stepOffsets,
    [...stepOffsets].sort((left, right) => left - right),
  );
  assert.ok(
    workflow.includes("if: ${{ always() && steps.verify_isolated_account.outcome == 'success' }}"),
  );
  assert.doesNotMatch(
    workflow,
    /StrictHostKeyChecking\s*[= ]\s*(?:no|accept-new)|UserKnownHostsFile/,
  );
});

for (const [name, modes, success, scans] of [
  ["accepts a matching key on the first attempt", "valid", true, 1],
  ["recovers from an empty successful scan", "empty,valid", true, 2],
  ["recovers from an empty nonzero scan", "network,valid", true, 2],
  ["recovers on the third and final attempt", "empty,network,valid", true, 3],
  ["stops after three empty scans", "empty,empty,empty,valid", false, 3],
  ["stops after three nonzero empty scans", "network,network,network,valid", false, 3],
  ["recovers after a bounded hanging scan", "hang,valid", true, 2],
  ["bounds and terminates scans that ignore TERM", "hang,hang,hang,valid", false, 3],
  ["fails immediately for a malformed key", "malformed,valid", false, 1],
  ["fails immediately for a comment without a key", "comment,valid", false, 1],
  ["fails immediately for a pin mismatch", "wrong,valid", false, 1],
  ["does not retry a pin mismatch after an empty scan", "empty,wrong,valid", false, 2],
  ["does not retry partial failed scans", "partial,valid", false, 1],
]) {
  test(name, () => {
    const directory = mkdtempSync(join(tmpdir(), "ayin-ssh-key-test-"));
    try {
      const bin = join(directory, "commands");
      const home = join(directory, "home");
      const sshDirectory = join(home, ".ssh");
      mkdirSync(bin);
      mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
      const knownHosts = join(sshDirectory, "known_hosts");
      writeFileSync(knownHosts, "existing trusted keys\n", { mode: 0o600 });
      writeFileSync(join(directory, "valid-key"), fixtureKey);
      writeFileSync(join(directory, "wrong-key"), wrongKey);

      const executable = (name, body) =>
        writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
          mode: 0o755,
        });
      executable(
        "ssh-keyscan",
        `
[[ "$*" == '-T 15 -p ${port} -t ed25519 ${host}' ]]
printf 'scan\\n' >> "$TEST_DIR/scans"
attempt="$(wc -l < "$TEST_DIR/scans")"
IFS=, read -ra modes <<< "$TEST_MODES"
mode="\${modes[attempt - 1]}"
case "$mode" in
  valid) cat "$TEST_DIR/valid-key" ;;
  empty) exit 0 ;;
  network) exit 1 ;;
  hang) trap '' TERM; exec "$TEST_REAL_SLEEP" 60 ;;
  malformed) printf 'invalid host key\\n' ;;
  comment) printf '# host:22 SSH-2.0-test\\n' ;;
  wrong) cat "$TEST_DIR/wrong-key" ;;
  partial) cat "$TEST_DIR/valid-key"; exit 1 ;;
  *) exit 99 ;;
esac`,
      );
      executable(
        "timeout",
        `
[[ "$1" == --kill-after=2s && "$2" == 20s && "$3" == ssh-keyscan ]]
printf 'timeout\\n' >> "$TEST_DIR/timeouts"
# Exercise real process-group termination with shorter test-only deadlines.
if [[ "$TEST_MODES" == *hang* ]]; then
  shift 2
  exec "$TEST_REAL_TIMEOUT" --kill-after=0.1s 0.2s "$@"
fi
exec "$TEST_REAL_TIMEOUT" "$@"`,
      );
      executable(
        "sleep",
        `
[[ "$*" == 2 ]]
printf 'backoff\\n' >> "$TEST_DIR/backoffs"`,
      );
      executable(
        "mv",
        `
printf 'promote\\n' >> "$TEST_DIR/promotions"
exec "$TEST_REAL_MV" "$@"`,
      );
      executable(
        "ssh",
        `
printf '%s\\n' "$*" >> "$TEST_DIR/ssh-calls"
[[ -f "$TEST_DIR/promotions" ]]
[[ "$*" != *whoami* ]] || printf 'ayin\\n'`,
      );
      executable("scp", 'printf "%s\\n" "$*" >> "$TEST_DIR/scp-calls"');

      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: home,
        DEPLOY_KEY: "test-only-placeholder-no-private-key",
        DEPLOY_HOST: host,
        DEPLOY_USER: "ayin",
        SSH_PORT: port,
        REMOTE_HOME: "/home/ayin",
        RELEASE_SHA: "1".repeat(40),
        PINNED_SSH_HOST_FINGERPRINT: fixtureFingerprint,
        TEST_DIR: directory,
        TEST_MODES: modes,
        TEST_REAL_TIMEOUT: commandPath("timeout"),
        TEST_REAL_SLEEP: commandPath("sleep"),
        TEST_REAL_MV: commandPath("mv"),
      };

      // Run the actual workflow scripts in order, stopping just as Actions does
      // after a failed step. Every network command is a local fake.
      const results = [];
      const started = performance.now();
      for (const script of scripts) {
        const result = spawnSync("bash", ["-c", script], {
          env,
          encoding: "utf8",
          timeout: 5000,
        });
        assert.ifError(result.error);
        assert.equal(result.signal, null, result.stderr);
        results.push(result);
        if (result.status !== 0) break;
      }
      const diagnostic = results.map(({ stderr }) => stderr).join("\n");
      assert.equal(
        results.every(({ status }) => status === 0),
        success,
        diagnostic,
      );
      assert.equal(results.length, success ? scripts.length : 1, diagnostic);
      const count = (file) =>
        existsSync(join(directory, file))
          ? readFileSync(join(directory, file), "utf8").trim().split("\n").length
          : 0;
      assert.equal(count("scans"), scans, diagnostic);
      assert.equal(count("timeouts"), scans, diagnostic);
      assert.equal(count("backoffs"), scans - 1, diagnostic);
      assert.equal(count("promotions"), success ? 1 : 0, diagnostic);
      assert.equal(count("ssh-calls"), success ? 5 : 0, diagnostic);
      assert.equal(count("scp-calls"), success ? 1 : 0, diagnostic);
      assert.equal(
        readFileSync(knownHosts, "utf8"),
        success ? fixtureKey : "existing trusted keys\n",
      );
      assert.equal(statSync(knownHosts).mode & 0o777, 0o600);
      assert.equal(statSync(sshDirectory).mode & 0o777, 0o700);
      assert.equal(statSync(join(sshDirectory, "id_ed25519")).mode & 0o777, 0o600);
      assert.equal(readFileSync(join(sshDirectory, "id_ed25519"), "utf8"), `${env.DEPLOY_KEY}\n`);
      if (modes.startsWith("hang")) {
        assert.ok(performance.now() - started < 5000, "Hanging scans must be terminated");
        if (!success) assert.match(diagnostic, /exhausted 3 bounded attempts/);
      }
      if (modes.includes("wrong")) assert.match(diagnostic, /SSH host fingerprint mismatch/);
      if (success) assert.match(results[0].stdout, /Pinned AYIN SSH host fingerprint verified/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
