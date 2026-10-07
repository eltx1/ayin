#!/usr/bin/env bash
set -euo pipefail

candidate="${1:?Usage: acquire-ssh-host-key.sh CANDIDATE_PATH}"

# Retry acquisition only. The caller must verify the pinned fingerprint before
# promoting this candidate to known_hosts or making any SSH connection.
# Each attempt has a 15-second scanner timeout and a 20-second wall-clock bound
# (plus at most 2 seconds to kill), for at most 70 seconds including backoff.
for attempt in 1 2 3; do
  scan_status=0
  timeout --kill-after=2s 20s \
    ssh-keyscan -T 15 -p "$SSH_PORT" -t ed25519 "$DEPLOY_HOST" > "$candidate" || scan_status=$?

  if [[ -s "$candidate" ]]; then
    # Never retry past received key material, including partial failed scans.
    # A successful scan continues to the existing fail-closed pin verification.
    if [[ "$scan_status" -ne 0 ]]; then
      echo "SSH host key acquisition failed after receiving candidate data (exit $scan_status)." >&2
      exit "$scan_status"
    fi
    exit 0
  fi

  echo "No SSH host key acquired (attempt $attempt/3, exit $scan_status)." >&2
  if [[ "$attempt" -lt 3 ]]; then
    sleep 2
  fi
done

echo "SSH host key acquisition exhausted 3 bounded attempts; refusing deployment." >&2
exit 1
