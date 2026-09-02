#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_OS_USER="ayin"
DB_NAME="ayin"
DB_ROLE="ayin_app"
DB_PASSWORD_FILE="/root/.ayin-postgres-password"
DB_ENV_FILE="/home/ayin/env/database.env"

fail() {
  echo "error: $*" >&2
  exit 1
}

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run this script as root"
id "$APP_OS_USER" >/dev/null 2>&1 || fail "required Linux user '$APP_OS_USER' does not exist"
command -v apt-get >/dev/null 2>&1 || fail "this bootstrap currently supports Ubuntu/Debian hosts with apt-get"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"
command -v systemctl >/dev/null 2>&1 || fail "systemd/systemctl is required"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

command -v psql >/dev/null 2>&1 || fail "psql was not installed"
command -v pg_isready >/dev/null 2>&1 || fail "pg_isready was not installed"

server_version_num="$(runuser -u postgres -- psql -Atqc 'SHOW server_version_num;')"
[[ "$server_version_num" =~ ^[0-9]+$ ]] || fail "could not determine PostgreSQL server version"
server_major="$((server_version_num / 10000))"
if (( server_major < 16 )); then
  fail "AYIN production requires PostgreSQL 16 or newer; found major version $server_major"
fi

echo "PostgreSQL $server_major detected."

# Fail closed to loopback. AYIN's V1 application and database share one EC2 host, so PostgreSQL
# never needs a public or VPC-facing listener.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET listen_addresses = '127.0.0.1';"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET password_encryption = 'scram-sha-256';"
systemctl restart postgresql

for _ in {1..20}; do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 || fail "PostgreSQL did not become ready on 127.0.0.1:5432"

if ss -ltn | awk '{print $4}' | grep -Eq '(^|:)0\.0\.0\.0:5432$|^\[::\]:5432$'; then
  fail "PostgreSQL is listening publicly; refusing to continue"
fi
ss -ltn | awk '{print $4}' | grep -Eq '(^|:)127\.0\.0\.1:5432$' || fail "PostgreSQL is not bound to 127.0.0.1:5432"

install -d -o "$APP_OS_USER" -g "$APP_OS_USER" -m 700 /home/ayin/env

if [[ -f "$DB_PASSWORD_FILE" ]]; then
  DB_PASSWORD="$(tr -d '\r\n' < "$DB_PASSWORD_FILE")"
  [[ "$DB_PASSWORD" =~ ^[0-9a-f]{64}$ ]] || fail "$DB_PASSWORD_FILE is malformed"
else
  DB_PASSWORD="$(openssl rand -hex 32)"
  printf '%s\n' "$DB_PASSWORD" > "$DB_PASSWORD_FILE"
  chmod 600 "$DB_PASSWORD_FILE"
fi

if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_ROLE'" | grep -qx '1'; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE $DB_ROLE WITH LOGIN PASSWORD '$DB_PASSWORD';"
else
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE $DB_ROLE WITH LOGIN PASSWORD '$DB_PASSWORD';"
fi

if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -qx '1'; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE $DB_NAME OWNER TO $DB_ROLE;"
else
  runuser -u postgres -- createdb --owner="$DB_ROLE" "$DB_NAME"
fi

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO $DB_ROLE;
SQL

PGPASSWORD="$DB_PASSWORD" psql \
  "postgresql://$DB_ROLE@127.0.0.1:5432/$DB_NAME?sslmode=disable" \
  -v ON_ERROR_STOP=1 \
  -Atqc 'SELECT current_database(), current_user;' >/dev/null

cat > "$DB_ENV_FILE" <<EOF
DATABASE_URL=postgresql://$DB_ROLE:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public
EOF
chown "$APP_OS_USER:$APP_OS_USER" "$DB_ENV_FILE"
chmod 600 "$DB_ENV_FILE"

printf '\nAYIN local PostgreSQL bootstrap completed successfully.\n'
printf 'Database: %s\n' "$DB_NAME"
printf 'Role: %s\n' "$DB_ROLE"
printf 'Listener: 127.0.0.1:5432 only\n'
printf 'Connection secret written to: %s (mode 600)\n' "$DB_ENV_FILE"
printf 'The database password was not printed.\n'
