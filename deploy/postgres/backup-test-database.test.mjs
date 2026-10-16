import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backupTestDatabase, validateBackupTestTarget } from "./backup-test-database.mjs";

const url = "postgresql://ayin_test:synthetic%21@127.0.0.1:55432/ayin_test_restore?schema=public";
const safe = { APP_ENV: "test", TEST_DATABASE_URL: url, DATABASE_URL: url };
const backup = {
  ...safe,
  AYIN_BACKUP_PGHOST: "127.0.0.1",
  AYIN_BACKUP_PGPORT: "55432",
  AYIN_BACKUP_PGUSER: "ayin_test",
  AYIN_BACKUP_PGPASSWORD: "synthetic!",
  AYIN_BACKUP_PGDATABASE: "ayin_backup_test_123",
};
const restore = {
  ...safe,
  AYIN_RESTORE_PGHOST: "127.0.0.1",
  AYIN_RESTORE_PGPORT: "55432",
  AYIN_RESTORE_PGUSER: "ayin_test",
  AYIN_RESTORE_PGPASSWORD: "synthetic!",
  AYIN_RESTORE_DATABASE: "ayin_restore_test_123",
  AYIN_RESTORE_ADMIN_DATABASE: "ayin_test_restore",
};

test("derives one explicit loopback test connection, including its nondefault port", () => {
  assert.deepEqual(backupTestDatabase(safe), {
    host: "127.0.0.1",
    port: "55432",
    user: "ayin_test",
    password: "synthetic!",
    database: "ayin_test_restore",
  });
  assert.equal(validateBackupTestTarget("backup", backup).port, "55432");
  assert.equal(validateBackupTestTarget("restore", restore).port, "55432");
});

for (const [label, mode, env] of [
  ["missing test URL", "backup", { ...backup, TEST_DATABASE_URL: undefined }],
  [
    "production application URL",
    "backup",
    { ...backup, DATABASE_URL: url.replace("ayin_test_restore", "ayin") },
  ],
  ["remote backup host", "backup", { ...backup, AYIN_BACKUP_PGHOST: "production.invalid" }],
  ["other backup port", "backup", { ...backup, AYIN_BACKUP_PGPORT: "5432" }],
  ["other backup role", "backup", { ...backup, AYIN_BACKUP_PGUSER: "ayin_app" }],
  ["production backup name", "backup", { ...backup, AYIN_BACKUP_PGDATABASE: "ayin" }],
  ["remote restore host", "restore", { ...restore, AYIN_RESTORE_PGHOST: "production.invalid" }],
  [
    "other restore admin database",
    "restore",
    { ...restore, AYIN_RESTORE_ADMIN_DATABASE: "postgres" },
  ],
  ["production restore name", "restore", { ...restore, AYIN_RESTORE_DATABASE: "ayin" }],
  ["inherited host address", "restore", { ...restore, PGHOSTADDR: "192.0.2.1" }],
  ["inherited service", "restore", { ...restore, PGSERVICE: "private-service" }],
  ["inherited service file", "restore", { ...restore, PGSERVICEFILE: "/private/service" }],
  ["inherited options", "restore", { ...restore, PGOPTIONS: "private-options" }],
]) {
  test(`refuses ${label} without disclosing connection data`, () => {
    assert.throws(
      () => validateBackupTestTarget(mode, env),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /synthetic|production\.invalid|private-service|192\.0\.2/,
        );
        return true;
      },
    );
  });
}

function runDrill(envOverrides, scenario) {
  const work = mkdtempSync(join(tmpdir(), "ayin-backup-guard-test-"));
  try {
    const log = join(work, "commands");
    const shim = `#!/bin/bash
printf '%s\\n' "\${0##*/}" >> "$AYIN_TEST_COMMAND_LOG"
case "\${0##*/}" in
  psql) printf '%s\\n' "\${AYIN_TEST_IDENTITY:-ayin_test_restore|ayin_test}";;
  age-keygen) if [[ "$1" == -o ]]; then printf '%s\\n' test-only > "$2"; else printf '%s\\n' age1testonlyrecipient000000000000000000; fi;;
  createdb) exit 71;;
esac
`;
    for (const command of ["age", "age-keygen", "createdb", "dropdb", "psql"]) {
      const file = join(work, command);
      writeFileSync(file, shim);
      chmodSync(file, 0o755);
    }
    const env = {
      ...process.env,
      ...safe,
      ...envOverrides,
      PATH: `${work}:${process.env.PATH}`,
      AYIN_TEST_COMMAND_LOG: log,
    };
    for (const key of ["PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) delete env[key];
    const result = spawnSync(
      "bash",
      [new URL("./test-backup-restore.sh", import.meta.url).pathname],
      { env, encoding: "utf8" },
    );
    const commands = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    scenario(result, commands);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test("the real drill refuses a missing test URL before any database or encryption command", () => {
  runDrill({ TEST_DATABASE_URL: undefined }, (result, commands) => {
    assert.equal(result.status, 1);
    assert.deepEqual(commands, []);
    assert.match(result.stderr, /explicit isolated test database/);
  });
});

test("the real drill never drops an unowned database after CREATE fails", () => {
  runDrill({}, (result, commands) => {
    assert.equal(result.status, 71);
    assert.ok(commands.includes("createdb"));
    assert.equal(commands.includes("dropdb"), false);
  });
});

test("the real drill refuses an unexpected live database identity before CREATE", () => {
  runDrill({ AYIN_TEST_IDENTITY: "ayin|ayin_app" }, (result, commands) => {
    assert.equal(result.status, 1);
    assert.deepEqual(commands, ["psql"]);
    assert.match(result.stderr, /identity did not match/);
  });
});

test("the real restore runner rejects a remote test target before source reads or database commands", () => {
  const result = spawnSync("bash", [new URL("./restore-drill.sh", import.meta.url).pathname], {
    env: { ...process.env, ...restore, AYIN_RESTORE_PGHOST: "production.invalid" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /explicit isolated test database/);
  assert.doesNotMatch(result.stderr, /production\.invalid|synthetic/);
});
