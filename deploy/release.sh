#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <git-sha>" >&2
  exit 64
fi

GIT_SHA="$1"
if [[ ! "$GIT_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "error: git-sha must be a 7-40 character hexadecimal commit id" >&2
  exit 64
fi

AYIN_ROOT="${AYIN_ROOT:-/home/ayin/htdocs}"
AYIN_RELEASES_DIR="${AYIN_RELEASES_DIR:-$AYIN_ROOT/releases}"
AYIN_CURRENT_LINK="${AYIN_CURRENT_LINK:-$AYIN_ROOT/current}"
AYIN_REPO_URL="${AYIN_REPO_URL:-git@github.com:eltx1/ayin.git}"
AYIN_WEB_ENV_FILE="${AYIN_WEB_ENV_FILE:-/home/ayin/env/web.env}"
AYIN_API_ENV_FILE="${AYIN_API_ENV_FILE:-/home/ayin/env/api.env}"
AYIN_WEB_HEALTH_URL="${AYIN_WEB_HEALTH_URL:-http://127.0.0.1:3000/}"
AYIN_API_HEALTH_URL="${AYIN_API_HEALTH_URL:-http://127.0.0.1:4000/ready}"
AYIN_HEALTH_RETRIES="${AYIN_HEALTH_RETRIES:-12}"
AYIN_HEALTH_DELAY_SECONDS="${AYIN_HEALTH_DELAY_SECONDS:-2}"

for required in git corepack pm2 curl; do
  command -v "$required" >/dev/null 2>&1 || {
    echo "error: required command '$required' is missing" >&2
    exit 69
  }
done

for env_file in "$AYIN_WEB_ENV_FILE" "$AYIN_API_ENV_FILE"; do
  [[ -r "$env_file" ]] || {
    echo "error: required environment file is not readable: $env_file" >&2
    exit 78
  }
done

mkdir -p "$AYIN_RELEASES_DIR"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-${GIT_SHA:0:12}"
release_dir="$AYIN_RELEASES_DIR/$release_id"
previous_release=""
if [[ -L "$AYIN_CURRENT_LINK" ]]; then
  previous_release="$(readlink -f "$AYIN_CURRENT_LINK" || true)"
fi

cleanup_failed_release() {
  if [[ -d "$release_dir" && "$(readlink -f "$AYIN_CURRENT_LINK" 2>/dev/null || true)" != "$release_dir" ]]; then
    rm -rf "$release_dir"
  fi
}
trap cleanup_failed_release ERR

echo "Creating release $release_id"
git clone --filter=blob:none --no-checkout "$AYIN_REPO_URL" "$release_dir"
git -C "$release_dir" fetch --depth=1 origin "$GIT_SHA"
git -C "$release_dir" checkout --detach "$GIT_SHA"

cd "$release_dir"
corepack enable
corepack prepare pnpm@11.24.0 --activate
command -v pnpm >/dev/null 2>&1 || {
  echo "error: pnpm was not activated by Corepack" >&2
  exit 69
}
pnpm install --frozen-lockfile
pnpm db:generate

# Build the exact release before any production database mutation. The existing API environment
# remains available to build-time validation without copying secrets into the release directory.
set -a
# shellcheck disable=SC1090
source "$AYIN_API_ENV_FILE"
set +a
pnpm build

# Only apply forward, backward-compatible migrations after the release candidate has built.
pnpm db:migrate:deploy

ln -sfn "$release_dir" "${AYIN_CURRENT_LINK}.next"
mv -Tf "${AYIN_CURRENT_LINK}.next" "$AYIN_CURRENT_LINK"

export AYIN_CURRENT_DIR="$AYIN_CURRENT_LINK"
export AYIN_WEB_ENV_FILE AYIN_API_ENV_FILE
pm2 startOrReload "$AYIN_CURRENT_LINK/deploy/ecosystem.config.cjs" --update-env
pm2 save

check_health() {
  local name="$1"
  local url="$2"
  local attempt
  for ((attempt = 1; attempt <= AYIN_HEALTH_RETRIES; attempt += 1)); do
    if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
      echo "$name health check passed"
      return 0
    fi
    sleep "$AYIN_HEALTH_DELAY_SECONDS"
  done
  echo "error: $name health check failed: $url" >&2
  return 1
}

rollback_application() {
  if [[ -z "$previous_release" || ! -d "$previous_release" ]]; then
    echo "error: no valid previous application release is available for automatic rollback" >&2
    return 1
  fi

  echo "Rolling application back to $previous_release" >&2
  ln -sfn "$previous_release" "${AYIN_CURRENT_LINK}.rollback"
  mv -Tf "${AYIN_CURRENT_LINK}.rollback" "$AYIN_CURRENT_LINK"

  export AYIN_CURRENT_DIR="$AYIN_CURRENT_LINK"
  export AYIN_WEB_ENV_FILE AYIN_API_ENV_FILE
  if ! pm2 startOrReload "$AYIN_CURRENT_LINK/deploy/ecosystem.config.cjs" --update-env; then
    echo "error: PM2 could not reload the previous application release" >&2
    return 1
  fi
  if ! pm2 save; then
    echo "error: PM2 state could not be persisted after rollback" >&2
    return 1
  fi

  if ! check_health "rollback web" "$AYIN_WEB_HEALTH_URL" || ! check_health "rollback api" "$AYIN_API_HEALTH_URL"; then
    echo "error: previous application release did not become healthy after rollback" >&2
    return 1
  fi

  echo "Application rollback succeeded. Database migrations were intentionally not rolled back." >&2
  return 0
}

if ! check_health "web" "$AYIN_WEB_HEALTH_URL" || ! check_health "api readiness" "$AYIN_API_HEALTH_URL"; then
  echo "Deployment health checks failed." >&2
  if rollback_application; then
    echo "The previous application release has been restored automatically." >&2
  else
    echo "Automatic application rollback failed or was unavailable; operator intervention is required." >&2
  fi
  exit 70
fi

trap - ERR
printf 'Deployed %s to %s\n' "$GIT_SHA" "$release_dir"
printf 'Previous release: %s\n' "${previous_release:-none}"
