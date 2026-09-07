#!/usr/bin/env bash
set -euo pipefail

ayin_backup_fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

ayin_backup_log() {
  local level="$1"
  local event="$2"
  local detail="${3:-}"
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -n "$detail" ]]; then
    printf '{"timestamp":"%s","level":"%s","service":"ayin-postgres-backup","event":"%s","detail":"%s"}\n' \
      "$timestamp" "$level" "$event" "$(printf '%s' "$detail" | tr '\n\r"' '   ')"
  else
    printf '{"timestamp":"%s","level":"%s","service":"ayin-postgres-backup","event":"%s"}\n' \
      "$timestamp" "$level" "$event"
  fi
}

ayin_require_command() {
  command -v "$1" >/dev/null 2>&1 || ayin_backup_fail "required command '$1' is missing"
}

ayin_read_env_value() {
  local file="$1"
  local key="$2"
  local line
  [[ -r "$file" ]] || ayin_backup_fail "required configuration file '$file' is not readable"
  line="$(grep -m1 -E "^${key}=" "$file" || true)"
  [[ -n "$line" ]] || ayin_backup_fail "required key '$key' is missing from $file"
  printf '%s' "${line#*=}"
}

ayin_require_private_file() {
  local file="$1"
  [[ -f "$file" && -r "$file" ]] || ayin_backup_fail "required private file '$file' is missing or unreadable"
  local mode
  mode="$(stat -c '%a' "$file")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || ayin_backup_fail "$file must have mode 600 or 400"
}

ayin_release_sha() {
  local candidate="${AYIN_RELEASE_SHA:-}"
  if [[ ! "$candidate" =~ ^[0-9a-fA-F]{40}$ ]] && [[ -d /home/ayin/htdocs/current/.git ]]; then
    candidate="$(git -C /home/ayin/htdocs/current rev-parse HEAD 2>/dev/null || true)"
  fi
  if [[ "$candidate" =~ ^[0-9a-fA-F]{40}$ ]]; then
    printf '%s' "${candidate,,}"
  else
    printf 'unknown'
  fi
}

ayin_load_production_database() {
  local database_env="${AYIN_DATABASE_ENV_FILE:-/home/ayin/env/database.env}"
  ayin_require_private_file "$database_env"
  local database_url
  database_url="$(ayin_read_env_value "$database_env" DATABASE_URL)"
  if [[ "$database_url" =~ ^postgresql://ayin_app:([0-9a-fA-F]{64})@127\.0\.0\.1:5432/ayin\?schema=public$ ]]; then
    AYIN_PGHOST="127.0.0.1"
    AYIN_PGPORT="5432"
    AYIN_PGUSER="ayin_app"
    AYIN_PGDATABASE="ayin"
    AYIN_PGPASSWORD="${BASH_REMATCH[1]}"
  else
    ayin_backup_fail "production database.env does not match the expected loopback AYIN database contract"
  fi
}

ayin_load_test_database() {
  [[ "${APP_ENV:-}" == "test" ]] || ayin_backup_fail "test database override is allowed only with APP_ENV=test"
  AYIN_PGHOST="${AYIN_BACKUP_PGHOST:-127.0.0.1}"
  AYIN_PGPORT="${AYIN_BACKUP_PGPORT:-5432}"
  AYIN_PGUSER="${AYIN_BACKUP_PGUSER:-ayin}"
  AYIN_PGDATABASE="${AYIN_BACKUP_PGDATABASE:-}"
  AYIN_PGPASSWORD="${AYIN_BACKUP_PGPASSWORD:-}"
  [[ "$AYIN_PGHOST" == "127.0.0.1" || "$AYIN_PGHOST" == "localhost" ]] || ayin_backup_fail "CI backup database must be local"
  [[ "$AYIN_PGPORT" =~ ^[0-9]{2,5}$ ]] || ayin_backup_fail "invalid PostgreSQL port"
  [[ "$AYIN_PGUSER" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || ayin_backup_fail "invalid PostgreSQL user"
  [[ "$AYIN_PGDATABASE" =~ ^ayin_backup_[A-Za-z0-9_]{1,48}$ ]] || ayin_backup_fail "CI backup database must use the ayin_backup_ prefix"
  [[ -n "$AYIN_PGPASSWORD" ]] || ayin_backup_fail "AYIN_BACKUP_PGPASSWORD is required in test mode"
}

ayin_load_backup_storage() {
  local backup_env="${AYIN_BACKUP_ENV_FILE:-/home/ayin/env/backup.env}"
  ayin_require_private_file "$backup_env"
  AYIN_BACKUP_R2_ACCOUNT_ID="$(ayin_read_env_value "$backup_env" R2_BACKUP_ACCOUNT_ID)"
  AYIN_BACKUP_R2_BUCKET="$(ayin_read_env_value "$backup_env" R2_BACKUP_BUCKET)"
  AYIN_BACKUP_R2_ACCESS_KEY_ID="$(ayin_read_env_value "$backup_env" R2_BACKUP_ACCESS_KEY_ID)"
  AYIN_BACKUP_R2_SECRET_ACCESS_KEY="$(ayin_read_env_value "$backup_env" R2_BACKUP_SECRET_ACCESS_KEY)"
  AYIN_BACKUP_AGE_RECIPIENT="$(ayin_read_env_value "$backup_env" BACKUP_AGE_RECIPIENT)"
  AYIN_BACKUP_RETENTION_DAYS="$(grep -m1 '^BACKUP_RETENTION_DAYS=' "$backup_env" | cut -d= -f2- || true)"
  AYIN_BACKUP_RETENTION_DAYS="${AYIN_BACKUP_RETENTION_DAYS:-35}"

  [[ "$AYIN_BACKUP_R2_ACCOUNT_ID" =~ ^[0-9a-fA-F]{32}$ ]] || ayin_backup_fail "invalid R2 backup account id"
  [[ "$AYIN_BACKUP_R2_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || ayin_backup_fail "invalid R2 backup bucket name"
  [[ "$AYIN_BACKUP_R2_BUCKET" != "ayin-production-media" ]] || ayin_backup_fail "database backups must never use the public media bucket"
  [[ -n "$AYIN_BACKUP_R2_ACCESS_KEY_ID" && -n "$AYIN_BACKUP_R2_SECRET_ACCESS_KEY" ]] || ayin_backup_fail "dedicated R2 backup credentials are incomplete"
  [[ "$AYIN_BACKUP_AGE_RECIPIENT" =~ ^age1[0-9a-z]{20,}$ ]] || ayin_backup_fail "BACKUP_AGE_RECIPIENT is not a valid age recipient"
  [[ "$AYIN_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || ayin_backup_fail "BACKUP_RETENTION_DAYS must be an integer"
  (( AYIN_BACKUP_RETENTION_DAYS >= 7 && AYIN_BACKUP_RETENTION_DAYS <= 3650 )) || ayin_backup_fail "BACKUP_RETENTION_DAYS must be between 7 and 3650"
}

ayin_r2() {
  AWS_ACCESS_KEY_ID="$AYIN_BACKUP_R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$AYIN_BACKUP_R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  AWS_EC2_METADATA_DISABLED=true \
    aws --endpoint-url "https://${AYIN_BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com" "$@"
}

ayin_build_database_url() {
  AYIN_URL_HOST="$1" AYIN_URL_PORT="$2" AYIN_URL_USER="$3" AYIN_URL_PASSWORD="$4" AYIN_URL_DATABASE="$5" \
    node -e '
      const host = process.env.AYIN_URL_HOST;
      const port = process.env.AYIN_URL_PORT;
      const user = process.env.AYIN_URL_USER;
      const password = process.env.AYIN_URL_PASSWORD;
      const database = process.env.AYIN_URL_DATABASE;
      const url = new URL("postgresql://localhost");
      url.hostname = host;
      url.port = port;
      url.username = user;
      url.password = password;
      url.pathname = `/${database}`;
      url.searchParams.set("schema", "public");
      process.stdout.write(url.toString());
    '
}
