#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${AYIN_CLOUDFLARE_API_TOKEN:?AYIN_CLOUDFLARE_API_TOKEN is required}"

API_ROOT="https://api.cloudflare.com/client/v4"
ZONE_NAME="ayin.stream"
MEDIA_DOMAIN="media.ayin.stream"
R2_BUCKET_NAME="${AYIN_R2_BUCKET_NAME:-ayin-production-media}"
AUTH_HEADER="Authorization: Bearer ${AYIN_CLOUDFLARE_API_TOKEN}"
CONTENT_HEADER="Content-Type: application/json"
ZONE_ID=""
ACCOUNT_ID=""

api_call() {
  local method="$1"
  local url="$2"
  local payload="${3:-}"
  local output
  output="$(mktemp)"

  if [[ -n "$payload" ]]; then
    curl --fail-with-body --silent --show-error \
      --request "$method" \
      --header "$AUTH_HEADER" \
      --header "$CONTENT_HEADER" \
      --data "$payload" \
      "$url" > "$output"
  else
    curl --fail-with-body --silent --show-error \
      --request "$method" \
      --header "$AUTH_HEADER" \
      "$url" > "$output"
  fi

  jq -e '.success == true' "$output" >/dev/null || {
    jq '{errors, messages}' "$output" >&2
    rm -f "$output"
    return 1
  }

  cat "$output"
  rm -f "$output"
}

verify_token() {
  local response
  response="$(api_call GET "$API_ROOT/user/tokens/verify")"
  jq -e '.result.status == "active"' <<<"$response" >/dev/null || {
    echo "error: Cloudflare API token is not active" >&2
    exit 1
  }
}

discover_scope() {
  local response count
  response="$(api_call GET "$API_ROOT/zones?name=$ZONE_NAME&status=active&per_page=50")"
  count="$(jq --arg name "$ZONE_NAME" '[.result[] | select(.name == $name)] | length' <<<"$response")"
  [[ "$count" == "1" ]] || {
    echo "error: expected exactly one active Cloudflare zone named '$ZONE_NAME', found $count" >&2
    exit 1
  }

  ZONE_ID="$(jq -r --arg name "$ZONE_NAME" '.result[] | select(.name == $name) | .id' <<<"$response")"
  ACCOUNT_ID="$(jq -r --arg name "$ZONE_NAME" '.result[] | select(.name == $name) | .account.id' <<<"$response")"

  [[ "$ZONE_ID" =~ ^[0-9a-fA-F]{32}$ ]] || {
    echo "error: invalid Cloudflare zone id discovered for '$ZONE_NAME'" >&2
    exit 1
  }
  [[ "$ACCOUNT_ID" =~ ^[0-9a-fA-F]{32}$ ]] || {
    echo "error: invalid Cloudflare account id discovered for '$ZONE_NAME'" >&2
    exit 1
  }
}

ensure_bucket() {
  local response count payload
  response="$(api_call GET "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets?name_contains=$R2_BUCKET_NAME&per_page=100")"
  count="$(jq --arg name "$R2_BUCKET_NAME" '[.result.buckets[]? | select(.name == $name)] | length' <<<"$response")"

  if [[ "$count" == "0" ]]; then
    payload="$(jq -cn --arg name "$R2_BUCKET_NAME" '{name:$name,storageClass:"Standard"}')"
    response="$(api_call POST "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets" "$payload")"
    jq -e --arg name "$R2_BUCKET_NAME" '.result.name == $name' <<<"$response" >/dev/null
    echo "R2 bucket created: $R2_BUCKET_NAME"
  elif [[ "$count" == "1" ]]; then
    echo "R2 bucket already exists: $R2_BUCKET_NAME"
  else
    echo "error: multiple exact bucket matches were returned for '$R2_BUCKET_NAME'" >&2
    exit 1
  fi
}

configure_cors() {
  local payload
  payload="$(jq -cn \
    --arg origin "https://ayin.stream" \
    '{rules:[{
      id:"ayin-browser-media",
      allowed:{
        origins:[$origin],
        methods:["GET","PUT","HEAD"],
        headers:["Content-Type","Range"]
      },
      exposeHeaders:["ETag","Content-Length","Content-Range","Accept-Ranges"],
      maxAgeSeconds:3600
    }]}')"

  api_call PUT "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets/$R2_BUCKET_NAME/cors" "$payload" >/dev/null

  local response
  response="$(api_call GET "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets/$R2_BUCKET_NAME/cors")"
  jq -e --arg origin "https://ayin.stream" '
    any(.result.rules[]?;
      .id == "ayin-browser-media"
      and (.allowed.origins | index($origin) != null)
      and (.allowed.methods | index("PUT") != null)
      and (.exposeHeaders | index("ETag") != null)
    )' <<<"$response" >/dev/null
  echo "R2 CORS synchronized for browser uploads and playback."
}

ensure_custom_domain() {
  local response count payload
  response="$(api_call GET "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets/$R2_BUCKET_NAME/domains/custom")"
  count="$(jq --arg domain "$MEDIA_DOMAIN" '[.result.domains[]? | select(.domain == $domain)] | length' <<<"$response")"

  if [[ "$count" == "0" ]]; then
    payload="$(jq -cn \
      --arg domain "$MEDIA_DOMAIN" \
      --arg zoneId "$ZONE_ID" \
      '{domain:$domain,enabled:true,zoneId:$zoneId}')"
    api_call POST "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets/$R2_BUCKET_NAME/domains/custom" "$payload" >/dev/null
    echo "R2 custom domain registration started: $MEDIA_DOMAIN"
  elif [[ "$count" == "1" ]]; then
    echo "R2 custom domain already registered: $MEDIA_DOMAIN"
  else
    echo "error: multiple registrations found for '$MEDIA_DOMAIN'" >&2
    exit 1
  fi

  response="$(api_call GET "$API_ROOT/accounts/$ACCOUNT_ID/r2/buckets/$R2_BUCKET_NAME/domains/custom/$MEDIA_DOMAIN")"
  jq -e --arg domain "$MEDIA_DOMAIN" --arg zoneId "$ZONE_ID" \
    '.result.domain == $domain and .result.enabled == true and .result.zoneId == $zoneId' <<<"$response" >/dev/null

  local ownership ssl
  ownership="$(jq -r '.result.status.ownership // "unknown"' <<<"$response")"
  ssl="$(jq -r '.result.status.ssl // "unknown"' <<<"$response")"
  echo "R2 custom domain state: ownership=$ownership ssl=$ssl"
}

command -v jq >/dev/null || {
  echo "error: jq is required" >&2
  exit 1
}
[[ "$R2_BUCKET_NAME" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || {
  echo "error: invalid R2 bucket name '$R2_BUCKET_NAME'" >&2
  exit 1
}

verify_token
discover_scope
ensure_bucket
configure_cors
ensure_custom_domain

cat <<EOF
AYIN R2 production bootstrap completed successfully.
Bucket: $R2_BUCKET_NAME
Public media domain: https://$MEDIA_DOMAIN
Zone: $ZONE_NAME
S3 endpoint: https://$ACCOUNT_ID.r2.cloudflarestorage.com
Next credential requirement: create an R2 Object Read & Write token restricted to bucket '$R2_BUCKET_NAME'.
EOF
