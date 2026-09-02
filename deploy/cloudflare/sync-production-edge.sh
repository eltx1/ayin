#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${AYIN_CLOUDFLARE_API_TOKEN:?AYIN_CLOUDFLARE_API_TOKEN is required}"
: "${AYIN_ORIGIN_IPV4:?AYIN_ORIGIN_IPV4 is required}"

API_ROOT="https://api.cloudflare.com/client/v4"
ZONE_NAME="ayin.stream"
AUTH_HEADER="Authorization: Bearer ${AYIN_CLOUDFLARE_API_TOKEN}"
CONTENT_HEADER="Content-Type: application/json"
AYIN_CLOUDFLARE_ZONE_ID=""

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

discover_zone() {
  local response count
  response="$(api_call GET "$API_ROOT/zones?name=$ZONE_NAME&status=active&per_page=50")"
  count="$(jq --arg name "$ZONE_NAME" '[.result[] | select(.name == $name)] | length' <<<"$response")"
  [[ "$count" == "1" ]] || {
    echo "error: expected exactly one active Cloudflare zone named '$ZONE_NAME', found $count" >&2
    exit 1
  }

  AYIN_CLOUDFLARE_ZONE_ID="$(jq -r --arg name "$ZONE_NAME" '.result[] | select(.name == $name) | .id' <<<"$response")"
  [[ "$AYIN_CLOUDFLARE_ZONE_ID" =~ ^[0-9a-fA-F]{32}$ ]] || {
    echo "error: Cloudflare returned an invalid zone id for '$ZONE_NAME'" >&2
    exit 1
  }
}

upsert_a_record() {
  local name="$1"
  local lookup record_id payload response

  lookup="$(api_call GET "$API_ROOT/zones/$AYIN_CLOUDFLARE_ZONE_ID/dns_records?type=A&name=$name")"
  record_id="$(jq -r '.result[0].id // empty' <<<"$lookup")"
  payload="$(jq -cn \
    --arg type "A" \
    --arg name "$name" \
    --arg content "$AYIN_ORIGIN_IPV4" \
    '{type:$type,name:$name,content:$content,ttl:1,proxied:true}')"

  if [[ -n "$record_id" ]]; then
    response="$(api_call PUT "$API_ROOT/zones/$AYIN_CLOUDFLARE_ZONE_ID/dns_records/$record_id" "$payload")"
  else
    response="$(api_call POST "$API_ROOT/zones/$AYIN_CLOUDFLARE_ZONE_ID/dns_records" "$payload")"
  fi

  jq -e --arg expected "$AYIN_ORIGIN_IPV4" \
    '.result.content == $expected and .result.proxied == true' <<<"$response" >/dev/null
  echo "Cloudflare DNS synchronized: $name -> $AYIN_ORIGIN_IPV4 (proxied)"
}

set_zone_setting() {
  local setting="$1"
  local value="$2"
  local payload response
  payload="$(jq -cn --arg value "$value" '{value:$value}')"
  response="$(api_call PATCH "$API_ROOT/zones/$AYIN_CLOUDFLARE_ZONE_ID/settings/$setting" "$payload")"
  jq -e --arg expected "$value" '.result.value == $expected' <<<"$response" >/dev/null
  echo "Cloudflare setting synchronized: $setting=$value"
}

set_bot_fight_mode_off() {
  local payload response
  payload='{"fight_mode":false}'
  response="$(api_call PUT "$API_ROOT/zones/$AYIN_CLOUDFLARE_ZONE_ID/bot_management" "$payload")"
  jq -e '.result.fight_mode == false' <<<"$response" >/dev/null
  echo "Cloudflare Bot Fight Mode synchronized: off"
}

command -v jq >/dev/null || {
  echo "error: jq is required" >&2
  exit 1
}

verify_token
discover_zone

# AYIN application origins only. media.ayin.stream is intentionally NOT touched here because
# it belongs to the Cloudflare R2 delivery layer and must never point at the EC2 application host.
upsert_a_record "ayin.stream"
upsert_a_record "api.ayin.stream"

set_zone_setting "ssl" "strict"
set_zone_setting "always_use_https" "on"

# AYIN exposes a browser-consumed API and public R2 media. Cloudflare reputation/BIC/Bot Fight
# challenges must not intercept API calls, media requests, crawlers, or synthetic health checks.
# These settings affect only the dedicated ayin.stream zone. Cloudflare proxying, TLS and automatic
# DDoS protection remain enabled.
set_zone_setting "browser_check" "off"
set_zone_setting "security_level" "essentially_off"
set_bot_fight_mode_off

echo "AYIN Cloudflare production edge sync completed successfully."
