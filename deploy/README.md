# AYIN CloudPanel / AWS deployment

AYIN runs its application tier on the existing AWS EC2 + CloudPanel host while media remains on the Cloudflare R2/media domain. No video objects are copied to EC2 and the release process must not introduce a media proxy, transcoder, HLS pipeline, Worker, or alternate storage path.

## Domains and routing

- `https://ayin.stream` -> Next.js web/PWA on `127.0.0.1:3000`.
- `https://api.ayin.stream` -> NestJS API on `127.0.0.1:4000`.
- Studio and Admin stay routes of the web application (`/studio`, `/admin`); they are not separate services.
- R2/media is configured independently and must never proxy through the Node host.

## Server prerequisites

Install the pinned Node version from `.nvmrc`, Corepack/pnpm, PM2 (or an equivalent CloudPanel process supervisor), PostgreSQL client tooling and Git. CloudPanel/Cloudflare terminate HTTPS; origin certificates and proxy trust must match the actual Cloudflare mode. Keep the Node ports bound to loopback/private interfaces only.

Create a release root such as `/home/ayin/htdocs/releases` and a stable symlink `/home/ayin/htdocs/current`. Environment files live outside the repository, for example `/home/ayin/env/web.env` and `/home/ayin/env/api.env`, with owner-only permissions.

Required application secrets include production database URL, auth/session secrets, canonical web/API origins, media/R2 configuration, analytics pseudonymization secret, `PAYOUT_DATA_ENCRYPTION_KEY`, and any real mail/ad credentials when those integrations are enabled. Never commit those values. Production secret backups and key-rotation procedures must preserve the ability to decrypt payout snapshots that still need operational access.

## Release procedure

Use `deploy/release.sh <git-sha>`. The script creates a timestamped release, checks out the exact commit, installs the frozen lockfile, generates Prisma, **builds the release candidate before mutating the database**, applies forward migrations, switches the `current` symlink atomically, reloads PM2, and verifies web liveness plus API database-backed readiness.

The build-before-migrate ordering is intentional: a compile or production build failure must never leave the production schema upgraded while the old application remains active.

Database migrations are still forward-applied before the symlink switch. Every production migration therefore needs backward-compatible rollout discipline. Application rollback does not imply database rollback.

## Health, readiness and graceful shutdown

- `GET /health` is process liveness. It intentionally does not depend on PostgreSQL.
- `GET /ready` is release/readiness health. It executes a minimal database query and returns `503` without exposing database error details when PostgreSQL is unavailable.
- Production release acceptance uses `/ready`, not `/health`.
- Nest shutdown hooks are enabled so PM2/system termination signals allow providers such as Prisma to close connections cleanly before process exit.

CloudPanel/Nginx may use `/health` for simple process monitoring, but traffic admission and release checks should use `/ready` whenever database availability matters.

## Automatic application rollback

If the newly activated release fails web liveness or API readiness, `release.sh` automatically repoints `current` to the previous valid release, reloads PM2, persists the PM2 state, and verifies the rolled-back application again.

The script **never automatically reverses a PostgreSQL migration**. If a migration has already been applied, the previous application must remain compatible with that schema. Destructive or non-backward-compatible migrations require a separately designed multi-release migration plan.

If no previous release exists, or if the previous release also fails health checks, the deployment exits non-zero and requires operator intervention.

## PostgreSQL backup and recovery gate

Do not perform the first production deployment until a real backup/recovery policy exists outside this repository. At minimum:

- define production RPO and RTO;
- enable a backup strategy capable of point-in-time recovery, normally a tested base-backup plus continuous WAL archive or an equivalent managed PostgreSQL capability;
- ensure the backup destination is isolated from the application host and protected with least-privilege credentials;
- verify backup artifacts with the PostgreSQL tooling appropriate to the chosen backup method;
- perform periodic restore drills into a separate environment and record the actual recovery time;
- take or confirm a recoverable backup point before production migrations with material data risk.

A successful backup command is not proof of recoverability. Restore testing is the acceptance criterion.

## Edge and reverse-proxy security gate

Before public production traffic:

- enforce HTTPS-only access and HSTS at the actual TLS termination layer after the certificate/redirect path is verified;
- apply edge or reverse-proxy rate limits to authentication, Admin and finance-sensitive endpoints in addition to application-level controls;
- set request/body limits appropriate for the non-media API; creator media uploads remain direct-to-R2 and must not be enlarged through the API proxy;
- preserve the exact trusted proxy chain and do not blindly trust client-supplied forwarding headers;
- add request/correlation IDs to production logs and retain security/audit logs according to the operations policy;
- keep database and Node ports private/loopback-only.

## R2 production gate

The existing direct-to-R2 architecture remains unchanged. Before production, verify the live bucket configuration rather than changing the architecture:

- CORS allows only the required AYIN web origins, methods and headers;
- presigned upload URLs use the shortest practical expiry and are treated as bearer credentials;
- signed uploads constrain expected content type/metadata where supported;
- upload completion validates object metadata/size and reconciles abandoned or orphaned objects;
- lifecycle rules clean temporary/abandoned objects where appropriate;
- API/R2 credentials are least privilege and never reach the browser.

## CI/CD

`.github/workflows/database.yml` is the repository quality gate and also validates `deploy/release.sh` with `bash -n`. `.github/workflows/deploy.yml` provides an optional manual production CD path and is intentionally inert unless repository variable `AYIN_CD_ENABLED=true` and SSH secrets are configured. This repository does not claim those credentials exist.

Before enabling CD, protect `main` and require the relevant quality/browser checks and review policy in GitHub branch/ruleset settings. Deployment automation must consume an exact reviewed commit SHA.
