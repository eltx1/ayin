#!/usr/bin/env bash
set -euo pipefail
umask 077

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

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/ayin-backup-restore-test.XXXXXX")"
SOURCE_DB="ayin_backup_ci_${RANDOM}"
RESTORE_DB="ayin_restore_ci_${RANDOM}"
PGHOST_TEST="127.0.0.1"
PGPORT_TEST="5432"
PGUSER_TEST="ayin"
PGPASSWORD_TEST="ayin"
IDENTITY_FILE="$WORK_DIR/age-identity.txt"
STORE_DIR="$WORK_DIR/store"
REPORT_FILE="$WORK_DIR/restore-report.json"

cleanup() {
  PGPASSWORD="$PGPASSWORD_TEST" dropdb -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" --if-exists "$RESTORE_DB" >/dev/null 2>&1 || true
  PGPASSWORD="$PGPASSWORD_TEST" dropdb -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" --if-exists "$SOURCE_DB" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

age-keygen -o "$IDENTITY_FILE" >/dev/null 2>&1
chmod 600 "$IDENTITY_FILE"
AGE_RECIPIENT="$(age-keygen -y "$IDENTITY_FILE")"
[[ "$AGE_RECIPIENT" == age1* ]]

PGPASSWORD="$PGPASSWORD_TEST" createdb -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" "$SOURCE_DB"
SOURCE_URL="postgresql://ayin:ayin@127.0.0.1:5432/${SOURCE_DB}?schema=public"
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
  AYIN_RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
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

(
  cd "$REPO_ROOT"
  APP_ENV=test \
  AYIN_RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  AYIN_RESTORE_SOURCE_MODE=filesystem \
  AYIN_BACKUP_LOCAL_STORE="$STORE_DIR" \
  AYIN_RESTORE_OBJECT_KEY="$BACKUP_KEY" \
  AYIN_RESTORE_AGE_IDENTITY_FILE="$IDENTITY_FILE" \
  AYIN_RESTORE_PGHOST="$PGHOST_TEST" \
  AYIN_RESTORE_PGPORT="$PGPORT_TEST" \
  AYIN_RESTORE_PGUSER="$PGUSER_TEST" \
  AYIN_RESTORE_PGPASSWORD="$PGPASSWORD_TEST" \
  AYIN_RESTORE_DATABASE="$RESTORE_DB" \
  AYIN_RESTORE_REPORT_PATH="$REPORT_FILE" \
    bash deploy/postgres/restore-drill.sh >/dev/null
)

jq -e '
  .status == "success"
  and .checks.checksum == "ok"
  and .checks.decryption == "ok"
  and .checks.pgRestore == "ok"
  and .checks.prismaMigrations == "ok"
  and .checks.applicationSmoke == "ok"
' "$REPORT_FILE" >/dev/null

marker="$(PGPASSWORD="$PGPASSWORD_TEST" psql -h "$PGHOST_TEST" -p "$PGPORT_TEST" -U "$PGUSER_TEST" -d "$RESTORE_DB" -Atqc "SELECT enabled FROM \"FeatureFlag\" WHERE key = 'task44.restore.marker'")"
[[ "$marker" == "t" ]] || {
  echo "error: restored database did not preserve the Task 44 marker row" >&2
  exit 1
}

printf 'Task 44 encrypted PostgreSQL backup/restore drill passed.\n'
