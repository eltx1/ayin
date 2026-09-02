#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_OS_USER="ayin"
ENV_DIR="/home/ayin/env"
WEB_ENV="$ENV_DIR/web.env"
API_ENV="$ENV_DIR/api.env"
EXPECTED_DB="ayin"
EXPECTED_DB_USER="ayin_app"
EXPECTED_R2_ACCOUNT="fa824163dbb3aa26f9cfae2a799a809a"
EXPECTED_R2_BUCKET="ayin-production-media"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run this preflight as root"
id "$APP_OS_USER" >/dev/null 2>&1 || fail "Linux user '$APP_OS_USER' is missing"
command -v psql >/dev/null 2>&1 || fail "psql is missing"
command -v python3 >/dev/null 2>&1 || fail "python3 is missing"
command -v curl >/dev/null 2>&1 || fail "curl is missing"

for file in "$WEB_ENV" "$API_ENV"; do
  [[ -f "$file" ]] || fail "$file is missing"
  [[ "$(stat -c '%U:%G' "$file")" == "$APP_OS_USER:$APP_OS_USER" ]] || fail "$file must be owned by ayin:ayin"
  [[ "$(stat -c '%a' "$file")" == "600" ]] || fail "$file must have mode 600"
done
pass "production env files exist with ayin:ayin ownership and mode 600"

# Load only into this process; no values are printed.
set -a
# shellcheck disable=SC1090
source "$API_ENV"
set +a

[[ "${NODE_ENV:-}" == "production" ]] || fail "NODE_ENV must be production"
[[ "${APP_ENV:-}" == "production" ]] || fail "APP_ENV must be production"
[[ "${API_HOST:-}" == "127.0.0.1" ]] || fail "API_HOST must be 127.0.0.1"
[[ "${PORT:-}" == "4000" ]] || fail "PORT must be 4000"
[[ "${CORS_ORIGIN:-}" == "https://ayin.stream" ]] || fail "CORS_ORIGIN is unexpected"
[[ "${WEB_ORIGIN:-}" == "https://ayin.stream" ]] || fail "WEB_ORIGIN is unexpected"
[[ -n "${AUTH_TOKEN_SECRET:-}" && ${#AUTH_TOKEN_SECRET} -ge 32 ]] || fail "AUTH_TOKEN_SECRET is invalid"
[[ -n "${PAYOUT_DATA_ENCRYPTION_KEY:-}" ]] || fail "PAYOUT_DATA_ENCRYPTION_KEY is missing"
[[ -n "${ANALYTICS_HASH_SALT:-}" && ${#ANALYTICS_HASH_SALT} -ge 32 ]] || fail "ANALYTICS_HASH_SALT is invalid"
[[ -n "${UPLOAD_SESSION_SECRET:-}" && ${#UPLOAD_SESSION_SECRET} -ge 32 ]] || fail "UPLOAD_SESSION_SECRET is invalid"
[[ "${R2_ACCOUNT_ID:-}" == "$EXPECTED_R2_ACCOUNT" ]] || fail "R2 account id is unexpected"
[[ "${R2_BUCKET:-}" == "$EXPECTED_R2_BUCKET" ]] || fail "R2 bucket is unexpected"
[[ -n "${R2_ACCESS_KEY_ID:-}" ]] || fail "R2 access key id is missing"
[[ -n "${R2_SECRET_ACCESS_KEY:-}" ]] || fail "R2 secret access key is missing"
[[ "${GAM_PRODUCTION_ENABLED:-0}" == "0" ]] || fail "GAM production must remain disabled for first launch"
pass "production environment values pass structural checks"

# Prisma accepts ?schema=public in DATABASE_URL, while libpq/psql rejects the
# non-libpq `schema` query parameter. Remove only that Prisma-specific option
# for this connectivity probe; the production DATABASE_URL remains unchanged.
PSQL_DATABASE_URL="$(python3 - "$DATABASE_URL" <<'PY'
import sys
import urllib.parse

raw = sys.argv[1]
parts = urllib.parse.urlsplit(raw)
query = [(key, value) for key, value in urllib.parse.parse_qsl(parts.query, keep_blank_values=True) if key != "schema"]
print(urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), parts.fragment)))
PY
)"

DB_RESULT="$(psql "$PSQL_DATABASE_URL" -Atqc "select current_database() || ':' || current_user")" || fail "cannot connect to AYIN PostgreSQL"
[[ "$DB_RESULT" == "$EXPECTED_DB:$EXPECTED_DB_USER" ]] || fail "PostgreSQL identity mismatch"
pass "PostgreSQL accepts the AYIN application connection on the expected database and role"

python3 - <<'PY'
import datetime
import hashlib
import hmac
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

account = os.environ["R2_ACCOUNT_ID"]
bucket = os.environ["R2_BUCKET"]
access = os.environ["R2_ACCESS_KEY_ID"]
secret = os.environ["R2_SECRET_ACCESS_KEY"]

host = f"{account}.r2.cloudflarestorage.com"
canonical_uri = "/" + urllib.parse.quote(bucket, safe="-_.~")
canonical_query = "list-type=2&max-keys=1"
now = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime("%Y%m%dT%H%M%SZ")
datestamp = now.strftime("%Y%m%d")
payload_hash = hashlib.sha256(b"").hexdigest()
canonical_headers = (
    f"host:{host}\n"
    f"x-amz-content-sha256:{payload_hash}\n"
    f"x-amz-date:{amz_date}\n"
)
signed_headers = "host;x-amz-content-sha256;x-amz-date"
canonical_request = "\n".join([
    "GET",
    canonical_uri,
    canonical_query,
    canonical_headers,
    signed_headers,
    payload_hash,
])
algorithm = "AWS4-HMAC-SHA256"
credential_scope = f"{datestamp}/auto/s3/aws4_request"
string_to_sign = "\n".join([
    algorithm,
    amz_date,
    credential_scope,
    hashlib.sha256(canonical_request.encode()).hexdigest(),
])

def sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()

k_date = sign(("AWS4" + secret).encode(), datestamp)
k_region = sign(k_date, "auto")
k_service = sign(k_region, "s3")
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
authorization = (
    f"{algorithm} Credential={access}/{credential_scope}, "
    f"SignedHeaders={signed_headers}, Signature={signature}"
)
url = f"https://{host}{canonical_uri}?{canonical_query}"
request = urllib.request.Request(url, method="GET", headers={
    "Authorization": authorization,
    "x-amz-content-sha256": payload_hash,
    "x-amz-date": amz_date,
})
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"unexpected R2 HTTP status {response.status}")
except urllib.error.HTTPError as exc:
    print(f"FAIL: R2 S3 authentication returned HTTP {exc.code}", file=sys.stderr)
    sys.exit(1)
except Exception as exc:
    print(f"FAIL: R2 S3 authentication failed: {type(exc).__name__}", file=sys.stderr)
    sys.exit(1)
print("PASS: R2 S3 credentials can access the AYIN production bucket")
PY

MEDIA_HTTP="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 10 --max-time 20 https://media.ayin.stream/__ayin_preflight_missing_object__ || true)"
[[ "$MEDIA_HTTP" =~ ^[1-5][0-9][0-9]$ ]] || fail "media.ayin.stream is not reachable over HTTPS yet"
pass "media.ayin.stream resolves and answers over HTTPS (HTTP $MEDIA_HTTP on a deliberately missing object)"

unset DATABASE_URL PSQL_DATABASE_URL AUTH_TOKEN_SECRET PAYOUT_DATA_ENCRYPTION_KEY ANALYTICS_HASH_SALT \
  UPLOAD_SESSION_SECRET R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

echo
echo "AYIN production infrastructure preflight completed successfully."
echo "No secret value was printed."
