#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=deploy/postgres/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

for command in age corepack createdb date dropdb jq mktemp node pg_restore psql sha256sum stat; do
  ayin_require_command "$command"
done

SOURCE_MODE="${AYIN_RESTORE_SOURCE_MODE:-r2}"
OBJECT_KEY="${AYIN_RESTORE_OBJECT_KEY:-}"
[[ "$OBJECT_KEY" =~ ^postgresql/daily/[0-9]{4}/[0-9]{2}/[0-9]{2}/ayin-postgresql-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.dump\.age$ ]] || \
  ayin_backup_fail "AYIN_RESTORE_OBJECT_KEY is missing or does not match an immutable AYIN backup key"

IDENTITY_FILE="${AYIN_RESTORE_AGE_IDENTITY_FILE:-}"
[[ -n "$IDENTITY_FILE" ]] || ayin_backup_fail "AYIN_RESTORE_AGE_IDENTITY_FILE is required"
ayin_require_private_file "$IDENTITY_FILE"

if [[ "$SOURCE_MODE" == "r2" ]]; then
  ayin_require_command aws
  ayin_load_backup_storage
elif [[ "$SOURCE_MODE" == "filesystem" ]]; then
  [[ "${APP_ENV:-}" == "test" ]] || ayin_backup_fail "filesystem restore source is allowed only with APP_ENV=test"
else
  ayin_backup_fail "unsupported restore source mode '$SOURCE_MODE'"
fi

PGHOST_TARGET="${AYIN_RESTORE_PGHOST:-127.0.0.1}"
PGPORT_TARGET="${AYIN_RESTORE_PGPORT:-5432}"
PGUSER_TARGET="${AYIN_RESTORE_PGUSER:-}"
PGPASSWORD_TARGET="${AYIN_RESTORE_PGPASSWORD:-}"
PGADMIN_DATABASE="${AYIN_RESTORE_ADMIN_DATABASE:-postgres}"
RESTORE_DATABASE="${AYIN_RESTORE_DATABASE:-}"

[[ "$PGPORT_TARGET" =~ ^[0-9]{2,5}$ ]] || ayin_backup_fail "invalid restore PostgreSQL port"
[[ "$PGUSER_TARGET" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || ayin_backup_fail "invalid restore PostgreSQL user"
[[ -n "$PGPASSWORD_TARGET" ]] || ayin_backup_fail "AYIN_RESTORE_PGPASSWORD is required"
[[ "$PGADMIN_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || ayin_backup_fail "invalid restore admin database"
[[ "$RESTORE_DATABASE" =~ ^ayin_restore_[A-Za-z0-9_]{1,48}$ ]] || ayin_backup_fail "restore database must use the ayin_restore_ prefix"
[[ "$RESTORE_DATABASE" != "ayin" ]] || ayin_backup_fail "production database name is forbidden"

if [[ "${APP_ENV:-}" != "test" ]]; then
  [[ "${AYIN_RESTORE_CONFIRM_NON_PRODUCTION:-}" == "YES" ]] || \
    ayin_backup_fail "set AYIN_RESTORE_CONFIRM_NON_PRODUCTION=YES only after verifying the target is non-production"
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ayin-restore-drill.XXXXXX")"
ENCRYPTED_FILE="$WORK_DIR/backup.dump.age"
CHECKSUM_FILE="$WORK_DIR/backup.sha256"
MANIFEST_FILE="$WORK_DIR/manifest.json"
DUMP_FILE="$WORK_DIR/backup.dump"
REPORT_ROOT="${AYIN_RESTORE_REPORT_DIR:-/var/tmp/ayin-restore-reports}"
REPORT_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_PATH="${AYIN_RESTORE_REPORT_PATH:-$REPORT_ROOT/ayin-restore-${REPORT_TIMESTAMP}-${RESTORE_DATABASE}.json}"
[[ "$REPORT_PATH" != "$WORK_DIR" && "$REPORT_PATH" != "$WORK_DIR/"* ]] || \
  ayin_backup_fail "restore report must be stored outside the temporary work directory"
START_EPOCH="$(date +%s)"
DATABASE_CREATED=0
SUCCESS=0
CURRENT_STAGE="download"

write_failure_report() {
  local exit_code="$1"
  local report_dir
  report_dir="$(dirname "$REPORT_PATH")"
  install -d -m 700 "$report_dir" || return 0
  jq -cn \
    --arg status failure \
    --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg objectKey "$OBJECT_KEY" \
    --arg targetDatabase "$RESTORE_DATABASE" \
    --arg releaseSha "$(ayin_release_sha)" \
    --arg failedStage "$CURRENT_STAGE" \
    --argjson exitCode "$exit_code" \
    --argjson durationSeconds "$(( $(date +%s) - START_EPOCH ))" \
    '{schemaVersion:1,status:$status,completedAt:$completedAt,objectKey:$objectKey,targetDatabase:$targetDatabase,releaseSha:$releaseSha,durationSeconds:$durationSeconds,failedStage:$failedStage,exitCode:$exitCode}' \
    > "$REPORT_PATH.tmp" || return 0
  chmod 600 "$REPORT_PATH.tmp" || true
  mv "$REPORT_PATH.tmp" "$REPORT_PATH" || true
}

cleanup() {
  local exit_code=$?
  if (( SUCCESS == 0 )); then
    write_failure_report "$exit_code" || true
  fi
  if (( DATABASE_CREATED == 1 )) && [[ "${AYIN_RESTORE_CLEANUP_DATABASE:-0}" == "1" ]]; then
    PGPASSWORD="$PGPASSWORD_TARGET" dropdb \
      -h "$PGHOST_TARGET" -p "$PGPORT_TARGET" -U "$PGUSER_TARGET" \
      --if-exists "$RESTORE_DATABASE" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
  unset PGPASSWORD_TARGET AYIN_BACKUP_R2_SECRET_ACCESS_KEY AYIN_BACKUP_R2_ACCESS_KEY_ID DATABASE_URL
  return "$exit_code"
}

on_signal() {
  local exit_code="$1"
  trap - INT TERM
  exit "$exit_code"
}

trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

source_get() {
  local key="$1"
  local destination="$2"
  if [[ "$SOURCE_MODE" == "filesystem" ]]; then
    cp -- "${AYIN_BACKUP_LOCAL_STORE:?AYIN_BACKUP_LOCAL_STORE is required}/$key" "$destination"
    chmod 600 "$destination"
  else
    ayin_r2 s3api get-object --bucket "$AYIN_BACKUP_R2_BUCKET" --key "$key" "$destination" >/dev/null
    chmod 600 "$destination"
  fi
}

source_get "$OBJECT_KEY" "$ENCRYPTED_FILE"
source_get "${OBJECT_KEY}.sha256" "$CHECKSUM_FILE"
source_get "${OBJECT_KEY}.manifest.json" "$MANIFEST_FILE"

CURRENT_STAGE="integrity"
EXPECTED_CHECKSUM="$(tr -d '[:space:]' < "$CHECKSUM_FILE")"
ACTUAL_CHECKSUM="$(sha256sum "$ENCRYPTED_FILE" | awk '{print $1}')"
[[ "$EXPECTED_CHECKSUM" =~ ^[0-9a-f]{64}$ ]] || ayin_backup_fail "backup checksum sidecar is malformed"
[[ "$ACTUAL_CHECKSUM" == "$EXPECTED_CHECKSUM" ]] || ayin_backup_fail "backup ciphertext checksum mismatch"
jq -e \
  --arg key "$OBJECT_KEY" \
  --arg sha "$EXPECTED_CHECKSUM" \
  '.schemaVersion == 1 and .objectKey == $key and .sha256 == $sha and .encryption == "age" and .archiveFormat == "pg_dump-custom"' \
  "$MANIFEST_FILE" >/dev/null || ayin_backup_fail "backup manifest does not match the selected ciphertext"

CURRENT_STAGE="decrypt"
age --decrypt --identity "$IDENTITY_FILE" --output "$DUMP_FILE" "$ENCRYPTED_FILE"
[[ -s "$DUMP_FILE" ]] || ayin_backup_fail "decrypted backup archive is empty"
pg_restore --list "$DUMP_FILE" >/dev/null

CURRENT_STAGE="target_guard"
EXISTING_DATABASE="$(PGPASSWORD="$PGPASSWORD_TARGET" psql \
  -h "$PGHOST_TARGET" -p "$PGPORT_TARGET" -U "$PGUSER_TARGET" -d "$PGADMIN_DATABASE" \
  -v ON_ERROR_STOP=1 -Atqc "SELECT 1 FROM pg_database WHERE datname = '$RESTORE_DATABASE'" || true)"
[[ "$EXISTING_DATABASE" != "1" ]] || ayin_backup_fail "restore target already exists; refusing to overwrite it"

CURRENT_STAGE="create_database"
PGPASSWORD="$PGPASSWORD_TARGET" createdb \
  -h "$PGHOST_TARGET" -p "$PGPORT_TARGET" -U "$PGUSER_TARGET" \
  --maintenance-db="$PGADMIN_DATABASE" "$RESTORE_DATABASE"
DATABASE_CREATED=1

CURRENT_STAGE="pg_restore"
PGPASSWORD="$PGPASSWORD_TARGET" PGAPPNAME=ayin-restore-drill \
  pg_restore \
    --host="$PGHOST_TARGET" \
    --port="$PGPORT_TARGET" \
    --username="$PGUSER_TARGET" \
    --dbname="$RESTORE_DATABASE" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$DUMP_FILE"

CURRENT_STAGE="postgres_validation"
PGPASSWORD="$PGPASSWORD_TARGET" psql \
  -h "$PGHOST_TARGET" -p "$PGPORT_TARGET" -U "$PGUSER_TARGET" -d "$RESTORE_DATABASE" \
  -v ON_ERROR_STOP=1 -Atqc \
  'SELECT CASE WHEN to_regclass('"'"'public."Account"'"'"') IS NOT NULL AND to_regclass('"'"'public."Video"'"'"') IS NOT NULL AND to_regclass('"'"'public."MediaAsset"'"'"') IS NOT NULL AND to_regclass('"'"'public."_prisma_migrations"'"'"') IS NOT NULL THEN 1 ELSE 0 END;' \
  | grep -qx '1' || ayin_backup_fail "restored database is missing critical AYIN relations"

CURRENT_STAGE="prisma_compatibility"
DATABASE_URL="$(ayin_build_database_url "$PGHOST_TARGET" "$PGPORT_TARGET" "$PGUSER_TARGET" "$PGPASSWORD_TARGET" "$RESTORE_DATABASE")"
export DATABASE_URL
(
  cd "$REPO_ROOT"
  corepack pnpm --filter @ayin/db exec prisma migrate status --schema prisma/schema.prisma >/dev/null
)

CURRENT_STAGE="application_smoke"
SMOKE_OUTPUT="$(cd "$REPO_ROOT" && node deploy/postgres/restore-smoke.mjs)"
jq -e '.status == "ok" and (.prismaMigrations | type == "number")' <<<"$SMOKE_OUTPUT" >/dev/null || \
  ayin_backup_fail "application-level Prisma smoke check failed"

CURRENT_STAGE="report"
DURATION_SECONDS="$(( $(date +%s) - START_EPOCH ))"
REPORT_DIR="$(dirname "$REPORT_PATH")"
install -d -m 700 "$REPORT_DIR"
jq -cn \
  --arg status success \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg objectKey "$OBJECT_KEY" \
  --arg targetDatabase "$RESTORE_DATABASE" \
  --arg releaseSha "$(ayin_release_sha)" \
  --argjson durationSeconds "$DURATION_SECONDS" \
  --argjson cleanupRequested "$( [[ "${AYIN_RESTORE_CLEANUP_DATABASE:-0}" == "1" ]] && printf true || printf false )" \
  '{schemaVersion:1,status:$status,completedAt:$completedAt,objectKey:$objectKey,targetDatabase:$targetDatabase,releaseSha:$releaseSha,durationSeconds:$durationSeconds,checks:{checksum:"ok",decryption:"ok",pgRestore:"ok",postgres:"ok",prismaMigrations:"ok",applicationSmoke:"ok"},cleanupRequested:$cleanupRequested}' \
  > "$REPORT_PATH.tmp"
chmod 600 "$REPORT_PATH.tmp"
mv "$REPORT_PATH.tmp" "$REPORT_PATH"

SUCCESS=1
CURRENT_STAGE="complete"
ayin_backup_log info postgres_restore.verified "$OBJECT_KEY -> $RESTORE_DATABASE"
printf 'Restore report: %s\n' "$REPORT_PATH"
