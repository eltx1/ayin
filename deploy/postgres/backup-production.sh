#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/postgres/backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

for command in age date flock git ionice jq mktemp nice node pg_dump pg_restore psql sha256sum stat; do
  ayin_require_command "$command"
done

STORAGE_MODE="${AYIN_BACKUP_STORAGE_MODE:-r2}"
if [[ "$STORAGE_MODE" == "filesystem" ]]; then
  [[ "${APP_ENV:-}" == "test" ]] || ayin_backup_fail "filesystem backup storage is allowed only with APP_ENV=test"
else
  [[ "$STORAGE_MODE" == "r2" ]] || ayin_backup_fail "unsupported backup storage mode '$STORAGE_MODE'"
  ayin_require_command aws
fi

if [[ "${APP_ENV:-production}" == "test" ]]; then
  ayin_load_test_database
  AYIN_BACKUP_AGE_RECIPIENT="${AYIN_BACKUP_AGE_RECIPIENT:-}"
  AYIN_BACKUP_RETENTION_DAYS="${AYIN_BACKUP_RETENTION_DAYS:-35}"
  [[ "$AYIN_BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{20,}$ ]] || ayin_backup_fail "AYIN_BACKUP_AGE_RECIPIENT is required for test backups"
else
  ayin_load_production_database
  ayin_load_backup_storage
fi

RUNTIME_DIR="${AYIN_BACKUP_RUNTIME_DIR:-/home/ayin/backup-runtime}"
STATUS_DIR="${AYIN_BACKUP_STATUS_DIR:-/home/ayin/backup-status}"
if [[ "${APP_ENV:-production}" == "test" ]]; then
  RUNTIME_DIR="${AYIN_BACKUP_RUNTIME_DIR:-${RUNNER_TEMP:-/tmp}/ayin-backup-runtime}"
  STATUS_DIR="${AYIN_BACKUP_STATUS_DIR:-${RUNNER_TEMP:-/tmp}/ayin-backup-status}"
fi
install -d -m 700 "$RUNTIME_DIR" "$STATUS_DIR"

exec 9>"$RUNTIME_DIR/postgres-backup.lock"
if ! flock -n 9; then
  ayin_backup_log error postgres_backup.locked "another backup is already running" >&2
  exit 75
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ayin-postgres-backup.XXXXXX")"
DUMP_FILE="$WORK_DIR/source.dump"
ENCRYPTED_FILE="$WORK_DIR/backup.dump.age"
REMOTE_VERIFY_FILE="$WORK_DIR/remote.dump.age"
REMOTE_VERIFY_DUMP="$WORK_DIR/remote-verified.dump"
CHECKSUM_FILE="$WORK_DIR/backup.sha256"
MANIFEST_FILE="$WORK_DIR/manifest.json"
CURRENT_STAGE="initializing"
SUCCESS=0
OBJECT_KEY=""
START_EPOCH="$(date +%s)"

write_status() {
  local status="$1"
  local report="$STATUS_DIR/latest.json"
  local completed_at duration
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration="$(( $(date +%s) - START_EPOCH ))"
  jq -cn \
    --arg status "$status" \
    --arg completedAt "$completed_at" \
    --arg stage "$CURRENT_STAGE" \
    --arg objectKey "$OBJECT_KEY" \
    --arg releaseSha "$(ayin_release_sha)" \
    --argjson durationSeconds "$duration" \
    '{schemaVersion:1,status:$status,completedAt:$completedAt,stage:$stage,objectKey:$objectKey,releaseSha:$releaseSha,durationSeconds:$durationSeconds}' \
    > "$report.tmp"
  chmod 600 "$report.tmp"
  mv "$report.tmp" "$report"
}

cleanup() {
  local exit_code=$?
  rm -rf "$WORK_DIR"
  unset AYIN_PGPASSWORD AYIN_BACKUP_R2_SECRET_ACCESS_KEY AYIN_BACKUP_R2_ACCESS_KEY_ID
  if (( SUCCESS == 1 )); then
    write_status success || true
  else
    write_status failure || true
    ayin_backup_log error postgres_backup.failed "$CURRENT_STAGE" >&2
  fi
  return "$exit_code"
}
trap cleanup EXIT INT TERM

CURRENT_STAGE="database_preflight"
PGPASSWORD="$AYIN_PGPASSWORD" PGAPPNAME=ayin-backup \
  psql -h "$AYIN_PGHOST" -p "$AYIN_PGPORT" -U "$AYIN_PGUSER" -d "$AYIN_PGDATABASE" \
  -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database(), pg_is_in_recovery();' >/dev/null

CURRENT_STAGE="dump"
ayin_backup_log info postgres_backup.dump_started
PGPASSWORD="$AYIN_PGPASSWORD" PGAPPNAME=ayin-backup \
  nice -n 10 ionice -c2 -n7 \
  pg_dump \
    --host="$AYIN_PGHOST" \
    --port="$AYIN_PGPORT" \
    --username="$AYIN_PGUSER" \
    --dbname="$AYIN_PGDATABASE" \
    --format=custom \
    --compress=6 \
    --lock-wait-timeout=30000 \
    --no-password \
    --file="$DUMP_FILE"
[[ -s "$DUMP_FILE" ]] || ayin_backup_fail "pg_dump produced an empty archive"
pg_restore --list "$DUMP_FILE" >/dev/null

CURRENT_STAGE="encrypt"
age --encrypt --recipient "$AYIN_BACKUP_AGE_RECIPIENT" --output "$ENCRYPTED_FILE" "$DUMP_FILE"
[[ -s "$ENCRYPTED_FILE" ]] || ayin_backup_fail "age produced an empty encrypted archive"
rm -f "$DUMP_FILE"

CHECKSUM="$(sha256sum "$ENCRYPTED_FILE" | awk '{print $1}')"
[[ "$CHECKSUM" =~ ^[0-9a-f]{64}$ ]] || ayin_backup_fail "could not calculate encrypted archive checksum"
printf '%s\n' "$CHECKSUM" > "$CHECKSUM_FILE"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DATE_PATH="$(date -u +%Y/%m/%d)"
RELEASE_SHA="$(ayin_release_sha)"
if [[ "${APP_ENV:-production}" != "test" && ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  ayin_backup_fail "production backup cannot determine the active release SHA"
fi
RELEASE_LABEL="${RELEASE_SHA:0:12}"
OBJECT_KEY="postgresql/daily/$DATE_PATH/ayin-postgresql-${TIMESTAMP}-${RELEASE_LABEL}.dump.age"
CHECKSUM_KEY="${OBJECT_KEY}.sha256"
MANIFEST_KEY="${OBJECT_KEY}.manifest.json"
ENCRYPTED_SIZE="$(stat -c '%s' "$ENCRYPTED_FILE")"
PG_DUMP_VERSION="$(pg_dump --version | tr '\n' ' ')"

jq -cn \
  --arg objectKey "$OBJECT_KEY" \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg database "$AYIN_PGDATABASE" \
  --arg releaseSha "$RELEASE_SHA" \
  --arg sha256 "$CHECKSUM" \
  --arg pgDumpVersion "$PG_DUMP_VERSION" \
  --argjson encryptedBytes "$ENCRYPTED_SIZE" \
  '{schemaVersion:1,objectKey:$objectKey,createdAt:$createdAt,database:$database,releaseSha:$releaseSha,sha256:$sha256,encryptedBytes:$encryptedBytes,pgDumpVersion:$pgDumpVersion,encryption:"age",archiveFormat:"pg_dump-custom"}' \
  > "$MANIFEST_FILE"

store_put() {
  local key="$1"
  local source="$2"
  if [[ "$STORAGE_MODE" == "filesystem" ]]; then
    local root="${AYIN_BACKUP_LOCAL_STORE:?AYIN_BACKUP_LOCAL_STORE is required for filesystem mode}"
    local destination="$root/$key"
    [[ ! -e "$destination" ]] || ayin_backup_fail "immutable backup object already exists: $key"
    install -d -m 700 "$(dirname "$destination")"
    install -m 600 "$source" "$destination"
  else
    if ayin_r2 s3api head-object --bucket "$AYIN_BACKUP_R2_BUCKET" --key "$key" >/dev/null 2>&1; then
      ayin_backup_fail "immutable backup object already exists: $key"
    fi
    ayin_r2 s3api put-object \
      --bucket "$AYIN_BACKUP_R2_BUCKET" \
      --key "$key" \
      --body "$source" \
      --content-type application/octet-stream \
      --cache-control no-store >/dev/null
  fi
}

store_get() {
  local key="$1"
  local destination="$2"
  if [[ "$STORAGE_MODE" == "filesystem" ]]; then
    cp -- "${AYIN_BACKUP_LOCAL_STORE:?}/$key" "$destination"
    chmod 600 "$destination"
  else
    ayin_r2 s3api get-object --bucket "$AYIN_BACKUP_R2_BUCKET" --key "$key" "$destination" >/dev/null
    chmod 600 "$destination"
  fi
}

CURRENT_STAGE="upload"
store_put "$OBJECT_KEY" "$ENCRYPTED_FILE"
store_put "$CHECKSUM_KEY" "$CHECKSUM_FILE"
store_put "$MANIFEST_KEY" "$MANIFEST_FILE"

CURRENT_STAGE="remote_integrity_verification"
store_get "$OBJECT_KEY" "$REMOTE_VERIFY_FILE"
REMOTE_CHECKSUM="$(sha256sum "$REMOTE_VERIFY_FILE" | awk '{print $1}')"
[[ "$REMOTE_CHECKSUM" == "$CHECKSUM" ]] || ayin_backup_fail "remote encrypted archive checksum does not match local checksum"
age --decrypt --identity /dev/null "$REMOTE_VERIFY_FILE" >/dev/null 2>&1 && ayin_backup_fail "encrypted archive unexpectedly decrypts without an identity"

if [[ "${APP_ENV:-production}" == "test" ]]; then
  TEST_IDENTITY="${AYIN_BACKUP_TEST_AGE_IDENTITY_FILE:?AYIN_BACKUP_TEST_AGE_IDENTITY_FILE is required in test mode}"
  ayin_require_private_file "$TEST_IDENTITY"
  age --decrypt --identity "$TEST_IDENTITY" --output "$REMOTE_VERIFY_DUMP" "$REMOTE_VERIFY_FILE"
else
  # Production backup hosts intentionally keep only the public age recipient. Full decryption is
  # performed by the restore drill on a separate recovery host. pg_restore archive validity was
  # already checked before encryption; the remote ciphertext itself is re-downloaded and checksummed.
  cp "$MANIFEST_FILE" "$STATUS_DIR/latest-manifest.json"
  chmod 600 "$STATUS_DIR/latest-manifest.json"
fi

if [[ -f "$REMOTE_VERIFY_DUMP" ]]; then
  pg_restore --list "$REMOTE_VERIFY_DUMP" >/dev/null
fi

CURRENT_STAGE="retention"
if [[ "$STORAGE_MODE" == "r2" ]]; then
  CUTOFF_EPOCH="$(( $(date +%s) - AYIN_BACKUP_RETENTION_DAYS * 86400 ))"
  while IFS=$'\t' read -r key modified; do
    [[ -n "$key" && -n "$modified" ]] || continue
    [[ "$key" =~ ^postgresql/daily/[0-9]{4}/[0-9]{2}/[0-9]{2}/ayin-postgresql-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.(dump\.age|dump\.age\.sha256|dump\.age\.manifest\.json)$ ]] || continue
    modified_epoch="$(date -d "$modified" +%s 2>/dev/null || printf '0')"
    if (( modified_epoch > 0 && modified_epoch < CUTOFF_EPOCH )); then
      ayin_r2 s3api delete-object --bucket "$AYIN_BACKUP_R2_BUCKET" --key "$key" >/dev/null
    fi
  done < <(ayin_r2 s3api list-objects-v2 --bucket "$AYIN_BACKUP_R2_BUCKET" --prefix postgresql/daily/ --output json | jq -r '.Contents[]? | [.Key,.LastModified] | @tsv')
fi

CURRENT_STAGE="complete"
SUCCESS=1
ayin_backup_log info postgres_backup.verified "$OBJECT_KEY"
