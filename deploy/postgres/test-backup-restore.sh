#!/usr/bin/env bash
set -euo pipefail
umask 077

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_CONNECTION="$(node "$REPO_ROOT/deploy/postgres/backup-test-database.mjs" connection)"

[[ "${APP_ENV:-}" == "test" ]] || {
  echo "error: backup restore integration drill requires APP_ENV=test" >&2
  exit 1
}

for command in age age-keygen createdb dropdb find jq psql; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "error: missing test command '$command'" >&2
    exit 1
  }
done

WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ayin-backup-restore-test.XXXXXX")"
RUN_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
SOURCE_DB="ayin_backup_ci_${RUN_ID}"
RESTORE_DB="ayin_restore_ci_${RUN_ID}"
PGHOST_TEST="$(jq -r .host <<<"$TEST_CONNECTION")"
PGPORT_TEST="$(jq -r .port <<<"$TEST_CONNECTION")"
PGUSER_TEST="$(jq -r .user <<<"$TEST_CONNECTION")"
PGPASSWORD_TEST="$(jq -r .password <<<"$TEST_CONNECTION")"
PGDATABASE_TEST="$(jq -r .database <<<"$TEST_CONNECTION")"
unset TEST_CONNECTION
SOURCE_CREATED=0
RESTORE_CREATED=0
IDENTITY_FILE="$WORK_DIR/age-identity.txt"
STORE_DIR="$WORK_DIR/store"
REPORT_FILE="$WORK_DIR/restore-report.json"

cleanup() {
  local exit_code=$?
  if (( RESTORE_CREATED == 1 )); then
    PGPASSWORD="$PGPASSWORD_TEST" dropdb -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" --maintenance-db="$PGDATABASE_TEST" "$RESTORE_DB" >/dev/null || exit_code=1
  fi
  if (( SOURCE_CREATED == 1 )); then
    PGPASSWORD="$PGPASSWORD_TEST" dropdb -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" --maintenance-db="$PGDATABASE_TEST" "$SOURCE_DB" >/dev/null || exit_code=1
  fi
  rm -rf "$WORK_DIR"
  return "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The client endpoint is the guarded loopback URL. A Docker service may report a
# private container address/internal port, so only compare the authoritative DB/role.
DATABASE_IDENTITY="$(PGPASSWORD="$PGPASSWORD_TEST" psql -X -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" -d "$PGDATABASE_TEST" -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database(), current_user')"
[[ "$DATABASE_IDENTITY" == "$PGDATABASE_TEST|$PGUSER_TEST" ]] || {
  echo "error: disposable PostgreSQL identity did not match the explicit test connection" >&2
  exit 1
}

age-keygen -o "$IDENTITY_FILE" >/dev/null 2>&1
chmod 600 "$IDENTITY_FILE"
AGE_RECIPIENT="$(age-keygen -y "$IDENTITY_FILE")"
[[ "$AGE_RECIPIENT" == age1* ]]

PGPASSWORD="$PGPASSWORD_TEST" createdb -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" --maintenance-db="$PGDATABASE_TEST" "$SOURCE_DB"
SOURCE_CREATED=1
SOURCE_URL="$(AYIN_TEST_SOURCE_DATABASE="$SOURCE_DB" node -e 'const u=new URL(process.env.TEST_DATABASE_URL);u.pathname="/"+process.env.AYIN_TEST_SOURCE_DATABASE;process.stdout.write(u.toString())')"
(
  cd "$REPO_ROOT"
  DATABASE_URL="$SOURCE_URL" corepack pnpm db:migrate:deploy >/dev/null
)

PGPASSWORD="$PGPASSWORD_TEST" psql -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" -d "$SOURCE_DB" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO "FeatureFlag" ("id", "key", "description", "enabled", "rolloutPercentage", "createdAt", "updatedAt")
VALUES ('44444444-4444-4444-8444-444444444444', 'task44.restore.marker', 'Task 44 restore verification marker', true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "enabled" = true, "updatedAt" = CURRENT_TIMESTAMP;
SQL

install -d -m 700 "$STORE_DIR"
(
  cd "$REPO_ROOT"
  APP_ENV=test \
  AYIN_RELEASE_SHA="${AYIN_RELEASE_SHA:-$(git rev-parse HEAD)}" \
  AYIN_BACKUP_STORAGE_MODE=filesystem \
  AYIN_BACKUP_LOCAL_STORE="$STORE_DIR" \
  AYIN_BACKUP_RUNTIME_DIR="$WORK_DIR/runtime" \
  AYIN_BACKUP_STATUS_DIR="$WORK_DIR/status" \
  AYIN_BACKUP_PGHOST="$PGHOST_TEST" \
  AYIN_BACKUP_PGPORT="$PGPORT_TEST" \
  AYIN_BACKUP_PGUSER="$PGUSER_TEST" \
  AYIN_BACKUP_PGPASSWORD="$PGPASSWORD_TEST" \
  AYIN_BACKUP_PGDATABASE="$SOURCE_DB" \
  AYIN_BACKUP_AGE_RECIPIENT="$AGE_RECIPIENT" \
  AYIN_BACKUP_TEST_AGE_IDENTITY_FILE="$IDENTITY_FILE" \
    bash deploy/postgres/backup-production.sh >/dev/null
)

mapfile -t backup_keys < <(find "$STORE_DIR/postgresql/daily" -type f -name '*.dump.age' -printf '%P\n' | sed 's#^#postgresql/daily/#')
[[ "${#backup_keys[@]}" -eq 1 ]] || {
  echo "error: expected exactly one encrypted backup object" >&2
  exit 1
}
BACKUP_KEY="${backup_keys[0]}"

run_restore() (
  cd "$REPO_ROOT"
  APP_ENV=test \
  AYIN_RELEASE_SHA="${AYIN_RELEASE_SHA:-$(git rev-parse HEAD)}" \
  AYIN_RESTORE_SOURCE_MODE=filesystem \
  AYIN_BACKUP_LOCAL_STORE="$STORE_DIR" \
  AYIN_RESTORE_OBJECT_KEY="$BACKUP_KEY" \
  AYIN_RESTORE_AGE_IDENTITY_FILE="$IDENTITY_FILE" \
  AYIN_RESTORE_PGHOST="$PGHOST_TEST" \
  AYIN_RESTORE_PGPORT="$PGPORT_TEST" \
  AYIN_RESTORE_PGUSER="$PGUSER_TEST" \
  AYIN_RESTORE_PGPASSWORD="$PGPASSWORD_TEST" \
  AYIN_RESTORE_ADMIN_DATABASE="$PGDATABASE_TEST" \
  AYIN_RESTORE_DATABASE="$RESTORE_DB" \
  AYIN_RESTORE_REPORT_PATH="$REPORT_FILE" \
    bash deploy/postgres/restore-drill.sh >/dev/null
)

expect_restore_failure() {
  local expected_stage="$1"
  if run_restore 2>"$WORK_DIR/expected-failure.log"; then
    echo "error: restore unexpectedly passed the $expected_stage negative control" >&2
    exit 1
  fi
  jq -e --arg stage "$expected_stage" '.status == "failure" and .failedStage == $stage' "$REPORT_FILE" >/dev/null
}

# These operate only on this run's synthetic local backup, before any target is created.
cp "$STORE_DIR/$BACKUP_KEY" "$WORK_DIR/original.dump.age"
printf 'corrupt-test-ciphertext' >> "$STORE_DIR/$BACKUP_KEY"
expect_restore_failure integrity
mv "$WORK_DIR/original.dump.age" "$STORE_DIR/$BACKUP_KEY"
VALID_IDENTITY_FILE="$IDENTITY_FILE"
IDENTITY_FILE="$WORK_DIR/wrong-identity.txt"
age-keygen -o "$IDENTITY_FILE" >/dev/null 2>&1
chmod 600 "$IDENTITY_FILE"
expect_restore_failure decrypt
IDENTITY_FILE="$VALID_IDENTITY_FILE"
ABSENT_TARGET="$(PGPASSWORD="$PGPASSWORD_TEST" psql -X -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" -d "$PGDATABASE_TEST" -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_database WHERE datname = '$RESTORE_DB'")"
[[ "$ABSENT_TARGET" == "0" ]] || { echo "error: a preflight rejection created a restore database" >&2; exit 1; }

run_restore
RESTORE_CREATED=1

jq -e '
  .status == "success"
  and .checks.checksum == "ok"
  and .checks.decryption == "ok"
  and .checks.pgRestore == "ok"
  and .checks.prismaMigrations == "ok"
  and .checks.applicationSmoke == "ok"
' "$REPORT_FILE" >/dev/null
cp "$REPORT_FILE" "$WORK_DIR/success-report.json"

# Reusing an existing target must refuse without dropping or changing its restored data.
expect_restore_failure target_guard

marker="$(PGPASSWORD="$PGPASSWORD_TEST" psql -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" -d "$RESTORE_DB" -Atqc "SELECT enabled FROM \"FeatureFlag\" WHERE key = 'task44.restore.marker'")"
[[ "$marker" == "t" ]] || {
  echo "error: restored database did not preserve the Task 44 marker row" >&2
  exit 1
}

if [[ -n "${AYIN_BACKUP_TEST_REPORT_PATH:-}" ]]; then
  install -d -m 700 "$(dirname -- "$AYIN_BACKUP_TEST_REPORT_PATH")"
  jq '. + {syntheticData:true,storageMode:"filesystem",markerPreserved:true,negativeChecks:{corruptCiphertext:"rejected",wrongIdentity:"rejected",existingTarget:"preserved"}}' "$WORK_DIR/success-report.json" > "$AYIN_BACKUP_TEST_REPORT_PATH"
  chmod 600 "$AYIN_BACKUP_TEST_REPORT_PATH"
fi

printf 'Task 44 encrypted PostgreSQL backup/restore drill passed.\n'
