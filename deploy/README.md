# AYIN production deployment on AWS + CloudPanel

AYIN V1 uses the existing AWS EC2 host as the application infrastructure. CloudPanel/Nginx, Next.js, NestJS, PM2 and PostgreSQL run on that host under AYIN-specific boundaries. Cloudflare R2 is the only required external storage service and the only home for creator media objects.

This runbook intentionally preserves the zero-additional-service launch architecture from the Master Plan, `docs/ARCHITECTURE.md`, and ADR-008. AWS RDS, Cloudflare Stream, Workers, a separate cache service, transcoding, HLS/FAST infrastructure and other paid runtime services are not launch dependencies.

## Production topology

- `https://ayin.stream` -> CloudPanel/Nginx -> Next.js web/PWA on `127.0.0.1:3000`.
- `https://api.ayin.stream` -> CloudPanel/Nginx -> NestJS API on `127.0.0.1:4000`.
- PostgreSQL -> local EC2 service on `127.0.0.1:5432`, never publicly exposed.
- `https://media.ayin.stream` -> Cloudflare R2 delivery layer, never the EC2 application host.
- Creator video bytes travel browser -> R2 directly and never pass through Node, Nginx, EBS or PostgreSQL.
- Studio and Admin remain routes of the main web application (`/studio`, `/admin`).

The Node and PostgreSQL ports must remain bound to loopback. Only CloudPanel/Nginx should reach ports 3000 and 4000; only local AYIN application/migration processes should reach PostgreSQL.

## Required server software

The repository pins the application runtime in `.nvmrc` and `package.json`. A production release refuses to proceed when the server Node version differs from `.nvmrc`.

Verify:

```bash
node -v
corepack --version
git --version
pm2 -v
curl --version
flock --version
psql --version
```

For the zero-budget launch, PostgreSQL Server 16 or newer runs locally on the EC2 host. The repository contains an idempotent bootstrap at:

```text
deploy/postgres/bootstrap-local-production.sh
```

It installs the distribution PostgreSQL packages when needed, forces the server to `127.0.0.1:5432`, requires PostgreSQL 16+, creates database `ayin` and role `ayin_app`, generates a random database password without printing it, validates a real password-authenticated connection, and writes `/home/ayin/env/database.env` with mode `600`.

## Server filesystem

Use the dedicated AYIN account and keep releases separate from secrets:

```text
/home/ayin/htdocs/releases/     immutable release directories
/home/ayin/htdocs/current       symlink to the active release
/home/ayin/env/database.env     local PostgreSQL connection generated on-server
/home/ayin/env/web.env          public/build-time web settings
/home/ayin/env/api.env          server-only production settings and secrets
/home/ayin/.deploy.lock         deployment concurrency lock
```

Environment files must be readable only by their owner:

```bash
chmod 600 /home/ayin/env/database.env
chmod 600 /home/ayin/env/web.env
chmod 600 /home/ayin/env/api.env
```

The production validator rejects broader group/other permissions for the files it consumes.

## Production environment files

Start from:

- `deploy/env/web.env.example`
- `deploy/env/api.env.example`

Do not commit real values.

### Web environment

The production web build requires:

```text
NODE_ENV=production
NEXT_PUBLIC_API_BASE_URL=https://api.ayin.stream
NEXT_PUBLIC_MEDIA_BASE_URL=https://media.ayin.stream
```

`NEXT_PUBLIC_*` values are embedded into browser-accessible code during `next build`. Passwords, private keys, tokens, R2 credentials and all other secrets are forbidden from `web.env`.

### API environment

Production must set at least:

```text
NODE_ENV=production
APP_ENV=production
API_HOST=127.0.0.1
PORT=4000
CORS_ORIGIN=https://ayin.stream
WEB_ORIGIN=https://ayin.stream
DATABASE_URL=postgresql://ayin_app:...@127.0.0.1:5432/ayin?schema=public
AUTH_TOKEN_SECRET=...
PAYOUT_DATA_ENCRYPTION_KEY=...
ANALYTICS_HASH_SALT=...
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
UPLOAD_SESSION_SECRET=...
```

Generate independent secrets on the server. For example:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

`PAYOUT_DATA_ENCRYPTION_KEY` must decode to exactly 32 bytes. The auth, analytics and upload-session secrets must be at least 32 characters and should be independently generated.

The local PostgreSQL URL intentionally does not use `sslmode=require`: the TCP connection never leaves loopback on the same host. PostgreSQL must not listen on the public interface and port `5432` must not be opened in the EC2 Security Group.

## R2 fail-closed production behavior

Production startup requires a complete R2 configuration. AYIN deliberately refuses to fall back to development storage when `APP_ENV=production`.

All four credentials must be supplied together:

```text
R2_ACCOUNT_ID
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`UPLOAD_SESSION_SECRET` is also mandatory in production. R2 credentials remain server-only and must never be copied to `web.env` or exposed as `NEXT_PUBLIC_*` values.

Before public launch verify the live bucket configuration:

- CORS permits only required AYIN origins/methods/headers;
- presigned URLs use short expirations;
- credentials are least privilege;
- abandoned/multipart objects have an appropriate lifecycle policy;
- object completion validates expected metadata/size;
- `media.ayin.stream` delivers directly from R2 rather than EC2;
- HTTP range requests work for progressive MP4 playback.

## Production environment preflight

Every release automatically runs:

```bash
node deploy/validate-production-env.cjs /home/ayin/env/web.env /home/ayin/env/api.env
```

It validates file permissions, production modes, HTTPS origins, PostgreSQL URL shape, required secrets, payout-key length, complete R2 settings and GAM safety settings. Deployment stops before package installation, build or database migration if validation fails.

The parser reads env values literally instead of shell-sourcing them, so characters such as `$` and `#` in secrets are not expanded by the shell.

## CloudPanel / Nginx

CloudPanel remains the source of truth for live vhosts and certificates. The two application reverse proxies are:

```text
ayin.stream      -> http://127.0.0.1:3000
api.ayin.stream  -> http://127.0.0.1:4000
```

Reference snippets live in:

- `deploy/nginx/ayin.stream.conf.example`
- `deploy/nginx/api.ayin.stream.conf.example`

Media uploads are direct-to-R2, so do not raise API body limits to accommodate video files.

The API trusts only the local Nginx hop for forwarded client addresses. When Cloudflare proxying is enabled, configure CloudPanel/Nginx real-IP handling using Cloudflare's published proxy ranges before depending on application IP rate limiting. Do not make Fastify blindly trust arbitrary forwarding headers.

## First deployment

The default repository URL is public HTTPS:

```text
https://github.com/eltx1/ayin.git
```

Deploy only an exact reviewed Git commit SHA. GitHub Actions bootstraps the trusted `deploy/release.sh` to a brand-new host, so the first deployment does not require an existing `/home/ayin/htdocs/current` symlink.

## What release.sh guarantees

`deploy/release.sh` performs the following sequence:

1. validates arguments and required server commands;
2. takes an exclusive AYIN deployment lock;
3. clones and checks out the exact requested commit;
4. verifies the server Node version exactly matches `.nvmrc`;
5. activates the pinned pnpm version;
6. validates production environment files and permissions;
7. installs the frozen lockfile and generates Prisma;
8. builds shared packages;
9. builds the API using only `api.env`;
10. builds Web using only `web.env`;
11. applies forward PostgreSQL migrations only after the release candidate built successfully;
12. atomically switches `/home/ayin/htdocs/current`;
13. starts/reloads PM2;
14. checks web liveness and database-backed API readiness;
15. restores the previous application release automatically if activation/health checks fail.

Application rollback never automatically reverses database migrations.

## PM2 process isolation

`deploy/ecosystem.config.cjs` loads each environment file independently:

- `ayin-web` receives only `web.env` and listens on `127.0.0.1:3000`.
- `ayin-api` receives only `api.env` and listens on `127.0.0.1:4000`.

API secrets therefore do not need to exist in the web process environment. After the first successful deployment enable PM2 startup persistence for the AYIN user and verify a controlled server reboot.

## Health and readiness

- `GET /health` checks API process liveness and intentionally does not require PostgreSQL.
- `GET /ready` performs a minimal database-backed readiness check and returns `503` without exposing database details when PostgreSQL is unavailable.

Production release acceptance uses:

```bash
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:4000/health
curl --fail http://127.0.0.1:4000/ready
```

Also verify listeners:

```bash
ss -lntp
```

Expected application/database listeners are loopback-only. Ports `3000`, `4000` and `5432` must never be public listeners.

## PostgreSQL backup / recovery gate

Local PostgreSQL is the zero-budget launch topology, but local-only backups are not sufficient recovery protection. Before production data is at risk:

- define RPO and RTO;
- automate logical backups and, when justified, WAL-based recovery;
- keep at least one recoverable copy off the EC2/EBS host;
- the already-approved Cloudflare R2 account may hold encrypted database backups under separate least-privilege credentials/prefix or bucket, avoiding a new runtime service;
- verify a real restore into an isolated database before calling backup readiness complete;
- capture a recoverable point before migrations carrying material data risk.

A successful backup command is not proof that recovery works. Restore testing is the acceptance criterion.

## Google Ad Manager safety

Keep:

```text
GAM_TEST_MODE=1
GAM_PRODUCTION_ENABLED=0
```

until real production identifiers are available. The environment validator refuses production GAM enablement when required network/ad-unit fields are blank or test mode remains enabled. Do not guess identifiers.

## Cloudflare phase

Cloudflare DNS/proxy/WAF is an edge layer around the existing EC2 application. It does not introduce Workers, Stream or another application runtime.

When enabling it:

- use Full (strict) TLS with a valid origin certificate path;
- configure Cloudflare real-client-IP handling in Nginx;
- add WAF/rate limits for auth, Admin, finance and abuse-sensitive routes;
- keep 3000/4000/5432 private;
- preserve direct-to-R2 media delivery;
- `media.ayin.stream` belongs to R2 and must never be rewritten to the EC2 origin.

## CI/CD

`.github/workflows/database.yml` validates deployment helpers, local-PostgreSQL bootstrap syntax and a production-env preflight fixture in addition to formatting, audit, lint, typecheck, tests, integration tests, migrations and production builds.

`.github/workflows/deploy.yml` is intentionally manual for the first production deployment. It accepts only an exact SHA that is proven to have a successful `Task quality gates` run on `main`, uses the dedicated AYIN SSH key, verifies the pinned server fingerprint and refuses a deployment account that can write to `/home/horusapp`.

`.github/workflows/cloudflare-production.yml` is also manual initially. It is scoped to the `ayin.stream` zone and synchronizes only `ayin.stream` and `api.ayin.stream`; `media.ayin.stream` is intentionally excluded because R2 owns it.

After the first controlled deployment, end-to-end verification and rollback test succeed, automation may be enabled without changing the application architecture.
