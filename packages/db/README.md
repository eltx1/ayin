# @ayin/db

PostgreSQL/Prisma data boundary for AYIN.

Task 02 introduces the initial V1 relational schema, deterministic forward migrations, minimal structural system defaults, and database-focused constraint/bootstrap tests. This package stores application metadata and Cloudflare R2 object references only; creator video bytes are never stored in PostgreSQL.

## Commands

From the repository root:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:seed
```

Set `DATABASE_URL` to the PostgreSQL database you intend to use. The committed example remains a placeholder only.

`pnpm --filter @ayin/db test` validates the Prisma schema and static Task 02 invariants without requiring a live database. To exercise the committed migrations and database constraints against a real clean PostgreSQL database, set `TEST_DATABASE_URL` to a disposable test database and run:

```bash
pnpm --filter @ayin/db test:integration
```

Never point `TEST_DATABASE_URL` at staging or production. The integration test intentionally skips when that variable is absent.

## Seed policy

`prisma/seed.sql` contains only idempotent structural defaults needed by later zero-friction creator provisioning. It must not contain fake users, channels, videos, advertisers, campaigns, revenue, or other production-like content.
