#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${AYIN_CLOUDFLARE_API_TOKEN:?AYIN_CLOUDFLARE_API_TOKEN is required}"

API_ROOT="https://api.cloudflare.com/client/v4"
ZONE_NAME="ayin.stream"
BACKUP_BUCKET="${AYIN_BACKUP_R2_BUCKET_NAME:-ayin-production-db-backups}"
MEDIA_BUCKET="ayin-production-media"
AUTH_HEADER="Authorization: Bearer ${AYIN_CLOUDFLARE_API_TOKEN}"
CONTENT_HEADER="Content-Type: application/json"
ACCOUNT_ID=""

fail() {
  echo "error: $*" >&2
  exit 1
}

api_call() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local output
  output="$(mktemp)"
  trap 'rm -f "$output"' RETURN

  if [[ -n "$payload" ]]; then
    curl --fail-with-body --silent --show-error \
      --request "$method" --header "$AUTH_HEADER" --header "$CONTENT_HEADER" \
      --data "$payload" "$url" > "$output"
  else
    curl --fail-with-body --silent --show-error \
      --request "$method" --header "$AUTH_HEADER" "$url" > "$output"
  fi

  jq -e '.success == true' "$output" >/dev/null || {
    jq '{errors, messages}' "$output" >&2
    return 1
  }
  cat "$output"
}

command -v curl >/dev/null || fail "curl is required"
command -v jq >/dev/null || fail "jq is required"
[[ "$BACKUP_BUCKET" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "invalid backup bucket name"
[[ "$BACKUP_BUCKET" != "$MEDIA_BUCKET" ]] || fail "database backups must never use the media bucket"

verify="$(api_call GET "$API_ROOT/user/tokens/verify")"
jq -e '.result.status == "active"' <<<"$verify" >/dev/null || fail "Cloudflare API token is not active"

zones="$(api_call GET "$API_ROOT/zones?name=$ZONE_NAME&status=active&per_page=50")"
ACCOUNT_ID="$(jq -r --arg name "$ZONE_NAME" '.result[] | select(.name == $name) | .account.id' <<<"$zones")"
[[ "$ACCOUNT_ID" =~ ^[0-9a-fA-F]{32}$ ]] || fail "could not resolve the Cloudflare account for $ZONE_NAME"

buckets="$(api_call GET "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets?name_contains=$BACKUP_BUCKET&per_page=100")"
count="$(jq --arg name "$BACKUP_BUCKET" '[.result.buckets[]? | select(.name == $name)] | length' <<<"$buckets")"
if [[ "$count" == "0" ]]; then
  payload="$(jq -cn --arg name "$BACKUP_BUCKET" '{name:$name,storageClass:"Standard"}')"
  created="$(api_call POST "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets" "$payload")"
  jq -e --arg name "$BACKUP_BUCKET" '.result.name == $name' <<<"$created" >/dev/null
elif [[ "$count" != "1" ]]; then
  fail "unexpected exact bucket match count: $count"
fi

# No custom domain is created here. Backups are accessed only through authenticated S3 API calls.
domains="$(api_call GET "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets/$BACKUP_BUCKET/domains/custom")"
jq -e '[.result.domains[]?] | length == 0' <<<"$domains" >/dev/null || \
  fail "backup bucket has a custom public domain; remove it before using this bucket"

cat <<EOF
AYIN private database-backup bucket is ready.
Bucket: $BACKUP_BUCKET
Account: $ACCOUNT_ID
Public media bucket: $MEDIA_BUCKET (not used)
No custom domain is attached.
Next: create R2 Object Read & Write credentials restricted only to '$BACKUP_BUCKET'.
EOF
