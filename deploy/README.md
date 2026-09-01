# AYIN production deployment on AWS + CloudPanel

AYIN runs the application tier on AWS EC2 behind CloudPanel/Nginx. PostgreSQL should be an external production database such as AWS RDS. Creator media remains direct-to-Cloudflare R2 and must never be proxied, stored, transcoded, or streamed through the EC2 Node processes.

## Production topology

- `https://ayin.stream` -> CloudPanel/Nginx -> Next.js web/PWA on `127.0.0.1:3000`.
- `https://api.ayin.stream` -> CloudPanel/Nginx -> NestJS API on `127.0.0.1:4000`.
- `https://media.ayin.stream` -> Cloudflare/R2 delivery layer, never the EC2 application host.
- Studio and Admin remain routes of the main web application (`/studio`, `/admin`).
- PostgreSQL is reached privately by the API/migration tooling and must not be publicly exposed.

The Node ports must remain bound to loopback. Only CloudPanel/Nginx should be able to reach ports 3000 and 4000.

## Required server software

The repository pins the runtime in `.nvmrc` and `package.json`. A production release refuses to proceed when the server Node version differs from `.nvmrc`.

Install and verify:

```bash
node -v
corepack --version
git --version
pm2 -v
curl --version
flock --version
```

PostgreSQL client tooling (`psql`) is strongly recommended for connectivity diagnostics even when the database runs on AWS RDS.

## Server filesystem

Use the dedicated AYIN account and keep releases separate from secrets:

```text
/home/ayin/htdocs/releases/     immutable release directories
/home/ayin/htdocs/current       symlink to the active release
/home/ayin/env/web.env          public/build-time web settings
/home/ayin/env/api.env          server-only production settings and secrets
/home/ayin/.deploy.lock         deployment concurrency lock
```

Create the directories before the first deployment and keep them owned by the AYIN deployment user.

Environment files must be readable only by their owner:

```bash
chmod 600 /home/ayin/env/web.env
chmod 600 /home/ayin/env/api.env
```

The production validator rejects broader group/other permissions.

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

`NEXT_PUBLIC_*` values are embedded into browser-accessible code during `next build`. Passwords, private keys, tokens, R2 credentials, and any other secrets are forbidden from `web.env`.

### API environment

Production must set at least:

```text
NODE_ENV=production
APP_ENV=production
API_HOST=127.0.0.1
PORT=4000
CORS_ORIGIN=https://ayin.stream
WEB_ORIGIN=https://ayin.stream
DATABASE_URL=postgresql://...
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

`PAYOUT_DATA_ENCRYPTION_KEY` must decode to exactly 32 bytes. The auth, analytics, and upload-session secrets must be at least 32 characters and should be independently generated.

For AWS RDS, use an encrypted PostgreSQL connection such as `sslmode=require` in the production URL and keep the database Security Group restricted to the EC2 application Security Group.

## R2 fail-closed production behavior

Production startup requires a complete R2 configuration. AYIN deliberately refuses to fall back to development storage when `APP_ENV=production`.

All four credentials must be supplied together:

```text
R2_ACCOUNT_ID
R2_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`UPLOAD_SESSION_SECRET` is also mandatory in production. R2 credentials must remain server-only and must never be copied to `web.env` or exposed as `NEXT_PUBLIC_*` values.

Before public launch verify the live bucket configuration:

- CORS permits only required AYIN origins/methods/headers.
- presigned URLs use short expirations;
- credentials are least privilege;
- abandoned/multipart objects have an appropriate lifecycle policy;
- object completion validates expected metadata/size;
- `media.ayin.stream` delivers directly from the media layer rather than EC2.

## Production environment preflight

Every release automatically runs:

```bash
node deploy/validate-production-env.cjs /home/ayin/env/web.env /home/ayin/env/api.env
```

It validates file permissions, production modes, HTTPS origins, PostgreSQL URL shape, required secrets, payout-key length, complete R2 settings, and GAM safety settings. Deployment stops before package installation, build, or database migration if validation fails.

The parser reads env values literally instead of shell-sourcing them, so characters such as `$` and `#` in secrets are not expanded by the shell.

## CloudPanel / Nginx

CloudPanel remains the source of truth for live vhosts and certificates. Create two reverse-proxy sites:

```text
ayin.stream      -> http://127.0.0.1:3000
api.ayin.stream  -> http://127.0.0.1:4000
```

Reference snippets live in:

- `deploy/nginx/ayin.stream.conf.example`
- `deploy/nginx/api.ayin.stream.conf.example`

They preserve host and forwarding information, keep ordinary request bodies small, and hide unnecessary server metadata. Media uploads are direct-to-R2, so do not raise API body limits to accommodate video files.

The API trusts only the local Nginx hop for forwarded client addresses. When Cloudflare proxying is enabled later, configure CloudPanel/Nginx real-IP handling using Cloudflare's published proxy ranges before depending on application IP rate limiting. Do not make Fastify blindly trust arbitrary forwarding headers.

## First deployment

The default repository URL is public HTTPS:

```text
https://github.com/eltx1/ayin.git
```

This avoids requiring a GitHub deploy key for the current public repository. If the repository becomes private, set `AYIN_REPO_URL` to an authenticated private clone URL or install a dedicated least-privilege deploy key.

Deploy an exact reviewed Git commit SHA:

```bash
/home/ayin/htdocs/current/deploy/release.sh <git-sha>
```

For a brand-new host with no `current` release yet, bootstrap a temporary checkout of the repository, create the environment files, and invoke that checkout's `deploy/release.sh` with the exact SHA. After success, `/home/ayin/htdocs/current` becomes the stable entry point for future releases.

## What release.sh guarantees

`deploy/release.sh` performs the following sequence:

1. validates arguments and required server commands;
2. takes an exclusive deployment lock so two releases cannot race;
3. clones and checks out the exact requested commit;
4. verifies the server Node version exactly matches `.nvmrc`;
5. activates the pinned pnpm version;
6. validates production environment files and permissions;
7. installs the frozen lockfile and generates Prisma;
8. builds shared packages;
9. builds the API using only `api.env`;
10. builds the Web app using only `web.env`;
11. applies forward PostgreSQL migrations only after the release candidate built successfully;
12. atomically switches `/home/ayin/htdocs/current`;
13. starts/reloads PM2;
14. checks web liveness and database-backed API readiness;
15. automatically restores the previous application release if activation/health checks fail.

Separating build environments prevents API secrets from leaking into the Next.js build while ensuring `NEXT_PUBLIC_API_BASE_URL` and the media origin are embedded correctly.

## PM2 process isolation

`deploy/ecosystem.config.cjs` loads each environment file independently:

- `ayin-web` receives only `web.env` and listens on `127.0.0.1:3000`.
- `ayin-api` receives only `api.env` and listens on `127.0.0.1:4000`.

API secrets therefore do not need to exist in the web process environment. After the first successful deployment enable PM2 startup persistence for the AYIN user and verify a controlled server reboot.

## Health and readiness

- `GET /health` checks API process liveness and intentionally does not require PostgreSQL.
- `GET /ready` performs a minimal database-backed readiness check and returns `503` without exposing database details when PostgreSQL is unavailable.

Production release acceptance uses `/ready`:

```bash
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:4000/health
curl --fail http://127.0.0.1:4000/ready
```

Also verify listening addresses:

```bash
ss -lntp
```

Expected application listeners are `127.0.0.1:3000` and `127.0.0.1:4000`, never `0.0.0.0:3000` or `0.0.0.0:4000`.

## Rollback and database migrations

Application rollback does not mean database rollback. The release script can restore the previous application symlink and PM2 processes, but it intentionally never reverses PostgreSQL migrations automatically.

Production migrations must therefore remain backward compatible with the immediately previous application release. Destructive or incompatible schema changes require an explicit multi-release migration plan.

## PostgreSQL backup / recovery gate

Do not treat production as ready until the database has a tested recovery path. At minimum:

- define RPO and RTO;
- enable automated backups and point-in-time recovery or an equivalent tested strategy;
- keep backup storage isolated from the application host;
- confirm a recoverable point before migrations carrying material data risk;
- periodically restore into a separate environment and record actual recovery time.

A successful backup operation is not proof that recovery works. Restore testing is the acceptance criterion.

## Google Ad Manager safety

Keep:

```text
GAM_TEST_MODE=1
GAM_PRODUCTION_ENABLED=0
```

until real production identifiers are available. The environment validator refuses a production GAM enablement when required network/ad-unit fields are blank or test mode is still enabled. Do not guess identifiers.

## Cloudflare phase

Cloudflare proxy/WAF is intentionally a later edge step, after origin deployment works directly. When enabling it:

- use Full (strict) TLS with a valid origin certificate path;
- configure Cloudflare real-client-IP handling in Nginx;
- add WAF/rate limits for auth, Admin, finance, and abuse-sensitive routes;
- keep 3000/4000/5432 private;
- preserve direct-to-R2 media delivery;
- only after verification consider restricting the origin to Cloudflare proxy ranges.

## CI/CD

`.github/workflows/database.yml` validates deployment helper syntax and runs a production-env preflight fixture in addition to formatting, audit, lint, typecheck, tests, integration tests, migrations, and production builds.

`.github/workflows/deploy.yml` provides an optional manual exact-SHA production deployment. The deploy job remains inert unless repository variable `AYIN_CD_ENABLED=true` and the required SSH secrets are configured.

Protect `main`, require successful quality checks, and deploy only reviewed exact commit SHAs.
