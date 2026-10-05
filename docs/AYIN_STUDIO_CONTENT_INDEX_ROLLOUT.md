# Studio Content index: rollout and recovery

Scope: migration `20261005210000_studio_content_cursor` only. Its index remains the
non-unique B-tree `video_studio_content_cursor_idx` on `Video(channelId, updatedAt, id)`.
This guidance does not authorize production operations, change database settings, or
alter application behavior. The migration was still unapplied in production when amended.

## Why the build is concurrent

`deploy/release.sh` runs `pnpm db:migrate:deploy` after building the release but before
switching the current symlink and restarting the API/media worker. Existing writers
therefore remain live. Ordinary `CREATE INDEX` takes a SHARE lock that blocks their
writes for the build. `CREATE INDEX CONCURRENTLY` permits normal writes, at the cost
of additional scans and possible waits for existing transactions. It can still consume
CPU/I/O and conflict with other schema operations. Production duration is not inferred
from the local proof below.

Keep this migration as one concurrent index command, outside `BEGIN`/`COMMIT`. Do not
add `IF NOT EXISTS`: a same-name invalid or different index must not count as success.
Do not add an unconditional pre-drop that would remove an already valid index.

The repository pins Prisma CLI 7.10.0. `packages/db/package.json` directly runs
`prisma migrate deploy`; `deploy/run-with-env.cjs` only launches the process. The pinned
engine revision `0edf323efd1d98336f3f0a68684b56f689b900d3` splits PostgreSQL migration
statements and executes them separately, explicitly supporting concurrent index builds.
The disposable test exercised that actual CLI, not a substitute SQL runner. Prisma 8's
new transactional migration runner is a different implementation; recheck this contract
before an ORM upgrade.

Sources:

- [PostgreSQL 17 concurrent index creation](https://www.postgresql.org/docs/17/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
- [PostgreSQL 17 lock modes](https://www.postgresql.org/docs/17/explicit-locking.html)
- [Pinned Prisma engine implementation](https://raw.githubusercontent.com/prisma/prisma-engines/0edf323efd1d98336f3f0a68684b56f689b900d3/schema-engine/connectors/sql-schema-connector/src/flavour/postgres/connector/native/mod.rs)
- [Prisma 7 production recovery](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/patching-and-hotfixing)

## Observe and verify

Use the already authorized database connection and release environment. The repository
uses schema `public`; stop if the selected database/schema is different from the intended
target. Do not log credentials. Do not terminate unrelated sessions to force progress.

Inspect an active build:

```sql
SELECT pid, command, phase, lockers_total, lockers_done, current_locker_pid
FROM pg_stat_progress_create_index
WHERE datname = current_database()
  AND relid = 'public."Video"'::regclass;
```

Inspect the named index, including its table, method, exact definition, and validity:

```sql
SELECT c.oid, n.nspname AS schema_name, t.relname AS table_name,
       a.amname AS access_method, i.indisvalid, i.indisready, i.indislive,
       i.indisunique, i.indisprimary,
       i.indexprs IS NULL AS no_expression,
       i.indpred IS NULL AS no_predicate,
       pg_get_indexdef(c.oid) AS definition
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am a ON a.oid = c.relam
WHERE c.relname = 'video_studio_content_cursor_idx'
  AND n.nspname = 'public';

SELECT migration_name, started_at, finished_at, rolled_back_at,
       applied_steps_count, logs
FROM "_prisma_migrations"
WHERE migration_name = '20261005210000_studio_content_cursor'
ORDER BY started_at;
```

Successful completion requires the intended non-unique, non-primary B-tree with exactly
`channelId`, `updatedAt`, `id` in that order, no expression or predicate, and all three
flags `indisvalid`, `indisready`, `indislive` true. The successful migration record must
have `finished_at` set. PostgreSQL renders the definition as:

```sql
CREATE INDEX video_studio_content_cursor_idx ON public."Video" USING btree ("channelId", "updatedAt", id)
```

A name match alone is insufficient. `prisma migrate deploy` does not detect arbitrary
schema drift, so verify the catalog rather than relying only on a zero exit code.

## Recover a failed or interrupted attempt

First inspect both the catalog and migration ledger, and confirm that this build and
its migration process have stopped. An active build normally has an invalid index
while it is working; that is not permission to drop it.

1. **Index absent; migration failed:** fix the failure cause, mark this failed migration
   rolled back, then retry the unchanged migration.
2. **Index invalid; exact expected object confirmed:** remove only this index with the
   standalone command below. Wait for the drop to complete and verify absence. Then mark
   the failed migration rolled back and retry. Do not use a regular blocking drop.
3. **Exact intended index already valid; migration acknowledgment missing:** after verifying
   every expected property above, resolve this migration as applied. Preserve the valid
   index instead of dropping and rebuilding it.
4. **Unexpected table, definition, constraints, schema, or ledger state:** stop for review.
   Do not silently drop, rename, skip, or mark it applied.

The invalid-index cleanup must run alone, without an explicit transaction:

```sql
DROP INDEX CONCURRENTLY "public"."video_studio_content_cursor_idx";
```

For cases 1 and 2, run these pinned repository commands from the existing authorized
release environment, after cleanup verification:

```bash
corepack pnpm --filter @ayin/db exec prisma migrate resolve --rolled-back 20261005210000_studio_content_cursor
corepack pnpm db:migrate:deploy
```

For case 3 only:

```bash
corepack pnpm --filter @ayin/db exec prisma migrate resolve --applied 20261005210000_studio_content_cursor
```

`migrate resolve` updates bookkeeping; it does not remove or repair an index. After any
recovery, re-run the catalog/ledger checks. A subsequent normal deploy must be a no-op
for this migration. A migration failure keeps the release script from activating the
new application; preserve that behavior rather than ignoring the error.

[Concurrent drop semantics](https://www.postgresql.org/docs/17/sql-dropindex.html),
[index validity flags](https://www.postgresql.org/docs/17/catalog-pg-index.html), and
[Prisma 7 deploy behavior](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)
are documented by their respective maintainers.

## Disposable proof: 2026-10-05

Base: published PR250 head `06484b6e9934e5efb195a8ab9ed94cbbe38a7449`, tree
`66fe01ed32626e14ba9f32b92e49ab21f9f14d59`. No application or CI workflow source changed.
The amended migration SHA-256 was
`dac1f2730a3481203298e4592db932242df4816870c85af3283dd8e2db822e2f`.

Environment: Node 24.19.0, Prisma CLI 7.10.0, PostgreSQL 17.10 on a newly initialized,
loopback-only disposable cluster. The test URL was guarded to the exact local database
`ayin_migration_proof` and port 55479. All earlier repository migrations were applied
from an external baseline directory that omitted only this index migration. The amended
migration and recovery then ran against the actual worktree's `prisma.config.ts`.

Observed in the final successful run, 21:32:00–21:32:06 UTC:

- 10,000 existing `Video` rows before the index; target index absent.
- A held writer on one row kept the concurrent build observable in
  `waiting for writers before build`. The builder held `ShareUpdateExclusiveLock`.
- A different connection completed an UPDATE of another row plus an INSERT in 4.332 ms
  while the build remained active. This measures that controlled wait phase, not
  production latency or scan-phase throughput.
- Canceling only the test's known builder produced exit 1 / PostgreSQL `57014`, an invalid
  index (`indisvalid=false`, `indisready=false`, `indislive=true`), and a failed Prisma row.
- An unchanged blind deploy retry failed closed with `P3009`.
- Standalone `DROP INDEX CONCURRENTLY`, verified absence, actual
  `prisma migrate resolve --rolled-back`, and actual `prisma migrate deploy` recovered it.
- The rebuilt index had the exact expected definition and all validity flags true.
  Ledger history showed one rolled-back failed attempt and one successful attempt.
- A repeat actual deploy reported no pending migrations and preserved index OID 19695.
  All 10,001 rows and the independent writer's committed update remained intact.
- The disposable PostgreSQL server was stopped; no production connection or persistent
  database setting was used.

Terminal evidence was retained separately from the source-only change: `terminal.log`,
`summary.json`, `01-baseline.log` through `06-repeat-deploy.log`, the guarded reproduction
harness, and an SHA-256 manifest. Final terminal log SHA-256:
`a0ddef99f6bd6cbda613ad6e1ce2cb3489c3d72d38b9282b6b57a52c7e2f6e18`.
Final summary SHA-256:
`6f4a37e7a1c364fdc6a98a4e7c3a5b792ad7c29323d6f900e1823a9acc3ecd6a`.
An initial harness assertion compared PostgreSQL's bigint text representation with a
JavaScript number; that assertion alone was corrected, its failed log retained, and the
entire proof repeated on a fresh cluster. This was not an application or migration failure.

The valid-index/missing-acknowledgment recovery branch is documented from Prisma's
supported recovery contract; it was not separately fault-injected in this bounded run.
