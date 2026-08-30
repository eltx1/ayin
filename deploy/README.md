# AYIN CloudPanel / AWS deployment

AYIN runs its application tier on the existing AWS EC2 + CloudPanel host while media remains on the Cloudflare R2/media domain. No video objects are copied to EC2.

## Domains and routing

- `https://ayin.stream` -> Next.js web/PWA on `127.0.0.1:3000`.
- `https://api.ayin.stream` -> NestJS API on `127.0.0.1:4000`.
- Studio and Admin stay routes of the web application (`/studio`, `/admin`); they are not separate services.
- R2/media host is configured independently and must never proxy through the Node host.

## Server prerequisites

Install the pinned Node version from `.nvmrc`, Corepack/pnpm, PM2 (or an equivalent CloudPanel process supervisor), PostgreSQL client tooling and Git. CloudPanel/Cloudflare terminate HTTPS; origin certificates and proxy trust must match the actual Cloudflare mode. Keep the Node ports bound to loopback/private interfaces only.

Create a release root such as `/home/ayin/htdocs/releases` and a stable symlink `/home/ayin/htdocs/current`. Environment files live outside the repository, for example `/home/ayin/env/web.env` and `/home/ayin/env/api.env`, with owner-only permissions.

Required application secrets include production database URL, auth/session secrets, canonical web/API origins, media/R2 configuration, analytics pseudonymization secret, and any real mail/ad credentials when those integrations are enabled. Never commit those values.

## Release procedure

Use `deploy/release.sh <git-sha>`. It creates a timestamped release, checks out the exact commit, installs the frozen lockfile, generates Prisma, runs migrations, builds the monorepo, switches the `current` symlink atomically, reloads PM2, and verifies both health endpoints. The previous symlink target is retained for rollback.

Database migrations are forward-applied before the symlink switch. Schema changes therefore need backward-compatible application rollout discipline. Take a PostgreSQL backup/snapshot before production migrations according to the operations policy.

## Rollback

Application rollback is an atomic symlink switch to the previous release followed by `pm2 reload deploy/ecosystem.config.cjs --update-env`. Do not blindly roll back a database migration; restore/forward-fix according to the migration's documented compatibility and backup state.

## Health and recovery

CloudPanel/Nginx should use `/health` for API health and `/` for web liveness. PM2 restarts crashed processes and is persisted with the host's normal startup mechanism. A failed post-deploy health check makes `release.sh` return non-zero and prints the prior release path for rollback.

## CI/CD

`.github/workflows/database.yml` remains the mandatory CI quality gate. `.github/workflows/deploy.yml` provides an optional, manual production CD path and is intentionally inert unless repository variable `AYIN_CD_ENABLED=true` and SSH secrets are configured. This repository does not claim those credentials exist.
