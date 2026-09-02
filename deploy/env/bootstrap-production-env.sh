#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_OS_USER="ayin"
ENV_DIR="/home/ayin/env"
DATABASE_ENV="$ENV_DIR/database.env"
WEB_ENV="$ENV_DIR/web.env"
API_ENV="$ENV_DIR/api.env"
R2_ACCOUNT_ID="fa824163dbb3aa26f9cfae2a799a809a"
R2_BUCKET="ayin-production-media"

fail() {
  echo "error: $*" >&2
  exit 1
}

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run this script as root"
id "$APP_OS_USER" >/dev/null 2>&1 || fail "required Linux user '$APP_OS_USER' does not exist"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"
[[ -r "$DATABASE_ENV" ]] || fail "$DATABASE_ENV is missing; bootstrap local PostgreSQL first"

if [[ -e "$WEB_ENV" || -e "$API_ENV" ]]; then
  fail "web.env or api.env already exists; refusing to overwrite production configuration"
fi

DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$DATABASE_ENV" | head -n 1)"
[[ "$DATABASE_URL" == postgresql://ayin_app:*@127.0.0.1:5432/ayin\?schema=public ]] || \
  fail "database.env does not contain the expected loopback AYIN PostgreSQL URL"

read_required() {
  local prompt="$1"
  local var_name="$2"
  local secret="${3:-0}"
  local value

  if [[ "$secret" == "1" ]]; then
    read -r -s -p "$prompt" value </dev/tty
    printf '\n' >/dev/tty
  else
    read -r -p "$prompt" value </dev/tty
  fi

  [[ -n "${value//[[:space:]]/}" ]] || fail "$var_name cannot be empty"
  printf -v "$var_name" '%s' "$value"
}

printf 'Enter the dedicated AYIN R2 object credentials. Nothing is sent to GitHub or ChatGPT.\n'
printf 'R2 account: %s\n' "$R2_ACCOUNT_ID"
printf 'R2 bucket: %s\n' "$R2_BUCKET"
read_required 'R2 access key ID: ' R2_ACCESS_KEY_ID
read_required 'R2 secret access key (hidden): ' R2_SECRET_ACCESS_KEY 1

AUTH_TOKEN_SECRET="$(openssl rand -hex 32)"
PAYOUT_DATA_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\r\n')"
ANALYTICS_HASH_SALT="$(openssl rand -hex 32)"
UPLOAD_SESSION_SECRET="$(openssl rand -hex 32)"

install -d -o "$APP_OS_USER" -g "$APP_OS_USER" -m 700 "$ENV_DIR"

cat > "$WEB_ENV" <<'EOF'
NODE_ENV=production
NEXT_PUBLIC_API_BASE_URL=https://api.ayin.stream
NEXT_PUBLIC_MEDIA_BASE_URL=https://media.ayin.stream
EOF

cat > "$API_ENV" <<EOF
NODE_ENV=production
APP_ENV=production
API_HOST=127.0.0.1
PORT=4000
CORS_ORIGIN=https://ayin.stream
WEB_ORIGIN=https://ayin.stream
DATABASE_URL=$DATABASE_URL

AUTH_TOKEN_SECRET=$AUTH_TOKEN_SECRET
AUTH_SESSION_TTL_SECONDS=604800
AUTH_PASSWORD_RESET_TTL_SECONDS=1800
PAYOUT_DATA_ENCRYPTION_KEY=$PAYOUT_DATA_ENCRYPTION_KEY
ANALYTICS_HASH_SALT=$ANALYTICS_HASH_SALT

R2_ACCOUNT_ID=$R2_ACCOUNT_ID
R2_BUCKET=$R2_BUCKET
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
R2_REGION=auto
R2_UPLOAD_URL_TTL_SECONDS=900
R2_PART_SIZE_BYTES=16777216
R2_MULTIPART_THRESHOLD_BYTES=67108864
UPLOAD_SESSION_SECRET=$UPLOAD_SESSION_SECRET

GAM_NETWORK_CODE=
GAM_PUBLISHER_ID=
GAM_VIDEO_AD_UNIT_PATH=
GAM_DISPLAY_AD_UNIT_PREFIX=
GAM_ADS_TXT_RELATIONSHIP=
GAM_TEST_MODE=1
GAM_PRODUCTION_ENABLED=0
EOF

chown "$APP_OS_USER:$APP_OS_USER" "$WEB_ENV" "$API_ENV"
chmod 600 "$WEB_ENV" "$API_ENV"

unset DATABASE_URL AUTH_TOKEN_SECRET PAYOUT_DATA_ENCRYPTION_KEY ANALYTICS_HASH_SALT \
  UPLOAD_SESSION_SECRET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

printf '\nAYIN production environment files created successfully.\n'
printf '%s\n' "$WEB_ENV" "$API_ENV"
printf 'Both files are owned by ayin with mode 600.\n'
printf 'GAM remains safely disabled for production.\n'
