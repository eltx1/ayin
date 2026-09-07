#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_USER="ayin"
RELEASE_ROOT="/home/ayin/htdocs/current"
BACKUP_ENV="/home/ayin/env/backup.env"
DATABASE_ENV="/home/ayin/env/database.env"
UNIT_SOURCE="$RELEASE_ROOT/deploy/postgres/systemd"

fail() {
  echo "error: $*" >&2
  exit 1
}

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run this script as root"
id "$APP_USER" >/dev/null 2>&1 || fail "required Linux user '$APP_USER' does not exist"
[[ -d "$RELEASE_ROOT" ]] || fail "$RELEASE_ROOT is missing"
[[ -f "$UNIT_SOURCE/ayin-postgres-backup.service" && -f "$UNIT_SOURCE/ayin-postgres-backup.timer" ]] || fail "backup systemd units are missing from the active release"

for command in age aws flock ionice jq pg_dump pg_restore psql systemctl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    case "$command" in
      age|aws|jq)
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get install -y age awscli jq
        break
        ;;
      *)
        fail "required command '$command' is missing"
        ;;
    esac
  fi
done

for file in "$DATABASE_ENV" "$BACKUP_ENV"; do
  [[ -f "$file" ]] || fail "$file is missing"
  mode="$(stat -c '%a' "$file")"
  [[ "$mode" == "600" || "$mode" == "400" ]] || fail "$file must have mode 600 or 400"
done

backup_bucket="$(grep -m1 '^R2_BACKUP_BUCKET=' "$BACKUP_ENV" | cut -d= -f2- || true)"
[[ "$backup_bucket" == "ayin-production-db-backups" ]] || fail "backup.env must target ayin-production-db-backups"
[[ "$backup_bucket" != "ayin-production-media" ]] || fail "refusing to use the media bucket for database backups"

install -d -o "$APP_USER" -g "$APP_USER" -m 700 /home/ayin/backup-runtime /home/ayin/backup-status
install -m 644 "$UNIT_SOURCE/ayin-postgres-backup.service" /etc/systemd/system/ayin-postgres-backup.service
install -m 644 "$UNIT_SOURCE/ayin-postgres-backup.timer" /etc/systemd/system/ayin-postgres-backup.timer

systemctl daemon-reload
systemctl enable --now ayin-postgres-backup.timer
systemctl is-enabled --quiet ayin-postgres-backup.timer
systemctl is-active --quiet ayin-postgres-backup.timer

printf 'AYIN PostgreSQL daily backup timer installed and active.\n'
printf 'Next run: '
systemctl show ayin-postgres-backup.timer --property=NextElapseUSecRealtime --value
printf 'Run one controlled backup now with: systemctl start ayin-postgres-backup.service\n'
