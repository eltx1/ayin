#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_OS_USER="ayin"
API_ENV="/home/ayin/env/api.env"
EXPECTED_ACCOUNT_ID="fa824163dbb3aa26f9cfae2a799a809a"
EXPECTED_BUCKET="ayin-production-media"

fail() {
  echo "error: $*" >&2
  exit 1
}

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run this script as root"
id "$APP_OS_USER" >/dev/null 2>&1 || fail "required Linux user '$APP_OS_USER' does not exist"
[[ -f "$API_ENV" ]] || fail "$API_ENV is missing"
[[ "$(stat -c '%U:%G' "$API_ENV")" == "$APP_OS_USER:$APP_OS_USER" ]] || fail "$API_ENV ownership is not ayin:ayin"
[[ "$(stat -c '%a' "$API_ENV")" == "600" ]] || fail "$API_ENV mode is not 600"
grep -qx "R2_ACCOUNT_ID=$EXPECTED_ACCOUNT_ID" "$API_ENV" || fail "unexpected R2 account id in api.env"
grep -qx "R2_BUCKET=$EXPECTED_BUCKET" "$API_ENV" || fail "unexpected R2 bucket in api.env"

read -r -p 'New R2 access key ID: ' R2_ACCESS_KEY_ID </dev/tty
[[ -n "${R2_ACCESS_KEY_ID//[[:space:]]/}" ]] || fail "R2 access key ID cannot be empty"
read -r -s -p 'New R2 secret access key (hidden): ' R2_SECRET_ACCESS_KEY </dev/tty
printf '\n' >/dev/tty
[[ -n "${R2_SECRET_ACCESS_KEY//[[:space:]]/}" ]] || fail "R2 secret access key cannot be empty"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

awk \
  -v access="$R2_ACCESS_KEY_ID" \
  -v secret="$R2_SECRET_ACCESS_KEY" '
  BEGIN { seen_access = 0; seen_secret = 0 }
  /^R2_ACCESS_KEY_ID=/ {
    print "R2_ACCESS_KEY_ID=" access
    seen_access = 1
    next
  }
  /^R2_SECRET_ACCESS_KEY=/ {
    print "R2_SECRET_ACCESS_KEY=" secret
    seen_secret = 1
    next
  }
  { print }
  END {
    if (!seen_access || !seen_secret) exit 42
  }
' "$API_ENV" > "$TMP" || fail "api.env does not contain the expected R2 credential fields"

chown "$APP_OS_USER:$APP_OS_USER" "$TMP"
chmod 600 "$TMP"
mv -f "$TMP" "$API_ENV"
trap - EXIT

unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

echo "AYIN R2 application credentials rotated successfully."
echo "$API_ENV remains owned by ayin with mode 600."
echo "No credential value was printed."
