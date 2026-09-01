#!/usr/bin/env bash
set -euo pipefail
umask 027

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <git-sha>" >&2
  exit 64
fi

GIT_SHA="$1"
if [[ ! "$GIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "error: git-sha must be a full 40-character hexadecimal commit id" >&2
  exit 64
fi

AYIN_ROOT="${AYIN_ROOT:-/home/ayin/htdocs}"
AYIN_RELEASES_DIR="${AYIN_RELEASES_DIR:-$AYIN_ROOT/releases}"
AYIN_CURRENT_LINK="${AYIN_CURRENT_LINK:-$AYIN_ROOT/current}"
AYIN_REPO_URL="${AYIN_REPO_URL:-https://github.com/eltx1/ayin.git}"
AYIN_WEB_ENV_FILE="${AYIN_WEB_ENV_FILE:-/home/ayin/env/web.env}"
AYIN_API_ENV_FILE="${AYIN_API_ENV_FILE:-/home/ayin/env/api.env}"
AYIN_WEB_HEALTH_URL="${AYIN_WEB_HEALTH_URL:-http://127.0.0.1:3000/}"
AYIN_API_HEALTH_URL="${AYIN_API_HEALTH_URL:-http://127.0.0.1:4000/ready}"
AYIN_API_LIVENESS_URL="${AYIN_API_LIVENESS_URL:-http://127.0.0.1:4000/health}"
AYIN_HEALTH_RETRIES="${AYIN_HEALTH_RETRIES:-12}"
AYIN_HEALTH_DELAY_SECONDS="${AYIN_HEALTH_DELAY_SECONDS:-2}"
AYIN_DEPLOY_LOCK_FILE="${AYIN_DEPLOY_LOCK_FILE:-/home/ayin/.deploy.lock}"

for required in git node corepack pm2 curl flock; do
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
mkdir -p "$(dirname "$AYIN_DEPLOY_LOCK_FILE")"
exec 9>"$AYIN_DEPLOY_LOCK_FILE"
if ! flock -n 9; then
  echo "error: another AYIN deployment is already running" >&2
  exit 75
fi

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

check_rollback_api_health() {
  local attempt
  local status
  for ((attempt = 1; attempt <= AYIN_HEALTH_RETRIES; attempt += 1)); do
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "$AYIN_API_HEALTH_URL" || true)"
    if [[ "$status" =~ ^2[0-9][0-9]$ ]]; then
      echo "rollback api readiness check passed"
      return 0
    fi

    # A release created before /ready existed may legitimately return 404. Only in that compatibility
    # case may rollback fall back to process liveness. A 5xx readiness response never falls back.
    if [[ "$status" == "404" ]] && curl --fail --silent --show-error --max-time 10 "$AYIN_API_LIVENESS_URL" >/dev/null; then
      echo "rollback api liveness check passed because the previous release has no /ready endpoint"
      return 0
    fi
    sleep "$AYIN_HEALTH_DELAY_SECONDS"
  done
  echo "error: rollback api health check failed" >&2
  return 1
}

activate_current_application() {
  export AYIN_CURRENT_DIR="$AYIN_CURRENT_LINK"
  export AYIN_WEB_ENV_FILE AYIN_API_ENV_FILE
  if ! pm2 startOrReload "$AYIN_CURRENT_LINK/deploy/ecosystem.config.cjs" --update-env; then
    echo "error: PM2 could not activate the current application release" >&2
    return 1
  fi
  if ! pm2 save; then
    echo "error: PM2 state could not be persisted" >&2
    return 1
  fi
  return 0
}

rollback_application() {
  if [[ -z "$previous_release" || ! -d "$previous_release" ]]; then
    echo "error: no valid previous application release is available for automatic rollback" >&2
    return 1
  fi

  echo "Rolling application back to $previous_release" >&2
  ln -sfn "$previous_release" "${AYIN_CURRENT_LINK}.rollback"
  mv -Tf "${AYIN_CURRENT_LINK}.rollback" "$AYIN_CURRENT_LINK"

  if ! activate_current_application; then
    echo "error: PM2 could not reactivate the previous application release" >&2
    return 1
  fi

  if ! check_health "rollback web" "$AYIN_WEB_HEALTH_URL" || ! check_rollback_api_health; then
    echo "error: previous application release did not become healthy after rollback" >&2
    return 1
  fi

  echo "Application rollback succeeded. Database migrations were intentionally not rolled back." >&2
  return 0
}

rollback_after_failure() {
  local reason="$1"
  echo "$reason" >&2
  if rollback_application; then
    echo "The previous application release has been restored automatically." >&2
  else
    echo "Automatic application rollback failed or was unavailable; operator intervention is required." >&2
  fi
  exit 70
}

echo "Creating release $release_id"
git clone --filter=blob:none --no-checkout "$AYIN_REPO_URL" "$release_dir"
git -C "$release_dir" fetch --depth=1 origin "$GIT_SHA"
git -C "$release_dir" checkout --detach "$GIT_SHA"

resolved_sha="$(git -C "$release_dir" rev-parse HEAD)"
if [[ "${resolved_sha,,}" != "${GIT_SHA,,}" ]]; then
  echo "error: checked-out commit $resolved_sha does not match requested commit $GIT_SHA" >&2
  exit 65
fi

cd "$release_dir"

required_node_version="$(tr -d '[:space:]' < .nvmrc)"
current_node_version="$(node --version | sed 's/^v//')"
if [[ "$current_node_version" != "$required_node_version" ]]; then
  echo "error: AYIN requires Node $required_node_version but server is running $current_node_version" >&2
  exit 69
fi

corepack enable
corepack prepare pnpm@11.24.0 --activate
command -v pnpm >/dev/null 2>&1 || {
  echo "error: pnpm was not activated by Corepack" >&2
  exit 69
}

node deploy/validate-production-env.cjs "$AYIN_WEB_ENV_FILE" "$AYIN_API_ENV_FILE"
pnpm install --frozen-lockfile
pnpm db:generate
pnpm packages:build

# Build API and Web with isolated environment files. In particular, this prevents API secrets from
# entering the Next.js build environment while ensuring NEXT_PUBLIC_* values are embedded correctly.
node deploy/run-with-env.cjs "$AYIN_API_ENV_FILE" corepack pnpm --filter @ayin/api run build
node deploy/run-with-env.cjs "$AYIN_WEB_ENV_FILE" corepack pnpm --filter @ayin/web run build

# Apply forward-only migrations only after the exact release candidate has built successfully.
node deploy/run-with-env.cjs "$AYIN_API_ENV_FILE" corepack pnpm db:migrate:deploy

ln -sfn "$release_dir" "${AYIN_CURRENT_LINK}.next"
mv -Tf "${AYIN_CURRENT_LINK}.next" "$AYIN_CURRENT_LINK"

if ! activate_current_application; then
  rollback_after_failure "Application activation failed after switching the release symlink."
fi

if ! check_health "web" "$AYIN_WEB_HEALTH_URL" || ! check_health "api readiness" "$AYIN_API_HEALTH_URL"; then
  rollback_after_failure "Deployment health checks failed."
fi

trap - ERR
printf 'Deployed %s to %s\n' "$GIT_SHA" "$release_dir"
printf 'Previous release: %s\n' "${previous_release:-none}"
