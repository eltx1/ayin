# Task 44 — PostgreSQL backup and tested restore

AYIN production PostgreSQL currently runs on the application EC2 host. This task keeps that topology but moves recovery copies outside the EC2/EBS failure domain into a dedicated private Cloudflare R2 bucket.

## Recovery objectives

- **RPO target:** 24 hours. The timer runs daily with a bounded random delay, so the operational alert threshold is 26 hours since the last verified backup.
- **RTO target:** 4 hours for database recovery to a prepared recovery host, excluding a separate media-object recovery incident.
- **Frequency:** one verified logical backup every day.
- **Retention:** 35 days by default. Cleanup runs only after a new backup has been uploaded and independently verified.
- **Owner:** AYIN production operations / the on-call operator with access to the backup R2 credentials and the separately held age recovery identity.

These are operational targets, not a claim of point-in-time recovery. WAL archiving is not enabled by Task 44, so the RPO remains bounded by the daily logical-backup interval.

## Storage boundary

Database backups MUST use `ayin-production-db-backups`. They MUST NOT use `ayin-production-media` and MUST NOT have `media.ayin.stream`, another custom domain, browser CORS, or public bucket access attached.

The R2 bucket is outside the EC2 failure domain. R2 S3 API transport uses HTTPS. Before upload, every PostgreSQL archive is encrypted client-side with `age`; R2 therefore receives ciphertext only. The production host stores only the age **recipient/public key**. The matching private identity must be held outside the EC2 host so loss of the server does not also destroy the recovery key.

Provision the private bucket with:

```bash
AYIN_CLOUDFLARE_API_TOKEN=... \
  bash deploy/cloudflare/bootstrap-backup-r2-production.sh
```

Then create R2 Object Read & Write credentials restricted only to `ayin-production-db-backups`. Do not reuse the browser/media bucket token.

## Secret files

Production uses:

```text
/home/ayin/env/database.env   existing local DB URL, mode 600
/home/ayin/env/backup.env     backup R2 credentials + age recipient, mode 600
```

Start `backup.env` from `deploy/env/backup.env.example`. Never commit real values. Do not put the age private identity in `backup.env` or anywhere on the production EC2 host.

The backup script does not place the PostgreSQL password on a command line. It reads the fixed loopback `database.env` contract, passes the password through `PGPASSWORD`, and never prints it. R2 credentials are passed to the S3 client through environment variables and are not printed.

## What counts as a successful backup

`pg_dump` exit zero is not enough. `deploy/postgres/backup-production.sh` succeeds only after all of these checks:

1. the expected local AYIN database is reachable;
2. `pg_dump` creates a non-empty custom-format archive;
3. `pg_restore --list` validates the plaintext archive structure before encryption;
4. `age` encrypts the archive;
5. SHA-256 is calculated over the encrypted object;
6. encrypted archive, checksum sidecar and manifest are uploaded under a unique UTC-dated immutable key;
7. the encrypted object is downloaded again from the configured storage;
8. the downloaded ciphertext SHA-256 matches the original checksum;
9. only after verification is the backup marked successful and retention cleanup allowed to run.

The production backup host intentionally cannot decrypt backups because it does not hold the private age identity. Actual decryption and restore are exercised by the restore drill on a separate non-production recovery target and by the isolated CI acceptance test.

Object naming is:

```text
postgresql/daily/YYYY/MM/DD/ayin-postgresql-YYYYMMDDTHHMMSSZ-<release12>.dump.age
```

The script refuses to overwrite an existing key. The `.sha256` and `.manifest.json` sidecars use the same immutable base key.

## Resource safety and failure signaling

The job uses an exclusive `flock`; overlapping backups fail instead of competing for disk/CPU. `pg_dump` runs with lowered CPU and I/O priority and a bounded lock wait. Temporary plaintext exists only in a mode-700 temporary directory and is removed on exit.

The systemd unit also sets low priority, a three-hour execution timeout, `NoNewPrivileges`, private temporary/devices namespaces and restricted writable paths.

Every attempt emits structured journal events and writes:

```text
/home/ayin/backup-status/latest.json
```

A non-zero systemd unit result, `status=failure`, or a stale/missing success older than 26 hours is an alert condition. The timer is persistent, so a missed scheduled run is started after the host returns.

Retention deletion is intentionally conservative: it happens only after a newly uploaded backup passed remote integrity verification, and only keys matching the AYIN backup naming contract older than the configured retention window are eligible.

## Daily automation

After `backup.env` is installed and the dedicated private bucket credentials are verified, run once as root:

```bash
bash /home/ayin/htdocs/current/deploy/postgres/install-backup-timer.sh
```

The installer enables `ayin-postgres-backup.timer`. Default schedule: 03:17 UTC daily plus up to 20 minutes randomized delay.

Verify:

```bash
systemctl status ayin-postgres-backup.timer
systemctl list-timers ayin-postgres-backup.timer
```

Run one controlled initial backup and inspect its status before considering the launch checklist complete:

```bash
systemctl start ayin-postgres-backup.service
systemctl status ayin-postgres-backup.service
cat /home/ayin/backup-status/latest.json
```

## Restore drill

A restore must use a host/database that is not production. The tool refuses the production database name and requires restore database names beginning with `ayin_restore_`. It also refuses an existing target database instead of cleaning or overwriting it.

The recovery operator supplies the private age identity from off-host custody and chooses an exact immutable backup key:

```bash
APP_ENV=recovery \
AYIN_RESTORE_CONFIRM_NON_PRODUCTION=YES \
AYIN_RESTORE_OBJECT_KEY='postgresql/daily/2026/09/08/ayin-postgresql-20260908T031700Z-0123456789ab.dump.age' \
AYIN_RESTORE_AGE_IDENTITY_FILE='/secure/off-host-mounted/ayin-backup-age-key.txt' \
AYIN_RESTORE_PGHOST='127.0.0.1' \
AYIN_RESTORE_PGPORT='5432' \
AYIN_RESTORE_PGUSER='ayin_restore_operator' \
AYIN_RESTORE_PGPASSWORD='...' \
AYIN_RESTORE_DATABASE='ayin_restore_20260908' \
AYIN_RESTORE_REPORT_PATH='/secure/reports/ayin-restore-20260908.json' \
  bash deploy/postgres/restore-drill.sh
```

Do not paste secrets into shell history in real operations; inject them from a protected environment/credential file or interactive secret facility appropriate to the recovery host.

The restore drill:

1. downloads the selected ciphertext, checksum and manifest;
2. validates ciphertext SHA-256 and manifest binding;
3. decrypts with the supplied age identity;
4. verifies the archive with `pg_restore --list`;
5. verifies the target database does not already exist;
6. creates only the `ayin_restore_*` database;
7. restores with `pg_restore --exit-on-error --no-owner --no-privileges`;
8. verifies critical AYIN relations;
9. runs `prisma migrate status` against the restored database;
10. runs an application-level Prisma smoke check over critical models and migration state;
11. writes a JSON restore report listing every completed check.

Automated verification never drops or replaces database `ayin`. Optional cleanup can only act on the already-guarded `ayin_restore_*` target.

## CI restore proof

`.github/workflows/backup-restore.yml` creates an isolated PostgreSQL database, generates an ephemeral age key, applies current Prisma migrations, writes a marker row, executes the same backup path using filesystem storage, restores into a new `ayin_restore_*` database, runs migration/application checks and confirms the marker survived. No production database, R2 credential, backup ciphertext or recovery private key is used by CI.

This CI proof validates the tooling. Production readiness still requires at least one real off-host R2 backup and one restore drill from that real encrypted object into a non-production recovery database.

## Recovery procedure during an incident

1. declare the database incident and stop write traffic if consistency requires it;
2. identify the newest **verified** immutable backup that satisfies the incident boundary;
3. provision/choose a non-production recovery PostgreSQL host with compatible PostgreSQL client/server tooling and the current reviewed AYIN release;
4. obtain the age identity from off-host custody and dedicated backup-bucket read credentials;
5. run `restore-drill.sh` and retain its report;
6. review Prisma migration compatibility and application smoke output;
7. only after a successful drill, follow a separately approved production cutover procedure to replace/repoint the production database;
8. validate API readiness and application smoke checks after cutover;
9. preserve the failed database/storage for investigation until the incident owner authorizes disposal.

The restore verification tool itself never performs step 7.
