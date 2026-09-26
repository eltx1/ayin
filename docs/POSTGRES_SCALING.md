# AYIN PostgreSQL Scaling Plan

Task 86 prepares AYIN's existing PostgreSQL primary for higher traffic without introducing replicas, sharding, Redis, Kafka, or specialized stores before measurements justify them.

## Evidence used in Task 86

This task does not claim access to production query latency. The repository does not contain a live production database connection for CI or code review.

The immediate changes are based on:

1. direct inspection of the current query shapes in analytics, discovery/search, watch, media queue and admin/revenue reporting;
2. existing schema/index coverage;
3. clean-PostgreSQL `EXPLAIN (FORMAT JSON)` regression tests for the hot paths changed by this task;
4. live operational counters exposed after deployment through `GET /admin/observability/postgres`.

The Admin PostgreSQL snapshot reports AYIN-role connection counts by `application_name`, active/idle/idle-in-transaction totals, configured pool limits, and timing aggregates from `pg_stat_statements` when that optional extension is available. Query text is deliberately not exposed by the API.

## Query-pattern review

### Discovery and watch

Public discovery and related-video queries repeatedly filter:

- `Video.status = PUBLISHED`
- `Video.visibility = PUBLIC`
- `Video.removedAt IS NULL`
- newest `publishedAt, id`
- existence of a validated MP4 `MediaAsset`.

Task 86 adds:

- partial `video_public_feed_idx(publishedAt DESC, id DESC)` covering only PUBLISHED/PUBLIC/non-removed rows;
- partial `media_asset_playable_video_idx(videoId)` covering only validated, non-removed MP4 source assets.

These are deliberately partial rather than broad composite indexes: the first EXPLAIN run showed PostgreSQL preferred the existing broader indexes. The partial forms are smaller and match the actual hot-path predicates, and the regression test requires PostgreSQL to select them.

Home and My AYIN previously ran video-policy lookups once per discovery section. Task 86 batches all page video IDs and performs one policy/override batch for the whole response, removing that request-level N+1 pattern.

Watch progress itself already uses the unique `(profileId, videoId)` keys and keeps its write transaction intentionally short: progress upsert + history upsert only.

### Trending

The discovery trending query groups `WatchHistory` by `videoId` after filtering a recent `lastWatchedAt` window. Existing indexes were profile-oriented, so Task 86 adds:

- `watch_history_trending_time_idx(lastWatchedAt, videoId)`.

The CI EXPLAIN regression verifies that this time-window query remains indexable.

### Search

PostgreSQL search already has dedicated prefix, trigram and FTS indexes for Video, Channel, Playlist, Creator TV, Movie and Series, including language-aware variants. Candidate counts are bounded.

Task 86 does not add another search store or duplicate search indexes. CI verifies that the existing Video prefix index remains present.

### Analytics

Creator/admin dashboards already read Task 82/83 aggregate tables rather than repeatedly scanning raw events. Channel/day aggregate tables already carry `(channelId, bucketStart)` indexes and period inputs are bounded.

The raw analytics pipeline retains indexes for event/time, channel/time, video/time and pseudonymous cohort use. No replica is introduced for analytics yet.

### Revenue/admin reports

Creator monetization queries filter the ledger by `channelId + currency + occurredAt`. Existing ledger indexes covered channel/time and channel/state/time but not the currency dimension, so Task 86 adds:

- `earnings_channel_currency_time_idx(channelId, currency, occurredAt)`.

Moderation reports already have `(status, createdAt)`; no duplicate index is added.

Admin list pages already cap page size at 100. Task 86 additionally caps deep page numbers at 1,000 so a hostile or accidental request cannot create unbounded OFFSET growth. A future high-volume admin directory should move to keyset cursors rather than raising this cap.

### Media worker queue

Task 85 already supplied the claim index `(status, priority, queuedAt)` plus lease indexes.

Task 86 keeps PostgreSQL as the queue. It reduces claim contention by batching the seven media settings into one query inside the advisory-lock transaction instead of issuing separate setting lookups. This preserves the current pause/global-concurrency decision while keeping the critical transaction compact: one settings read, stale-lease recovery, global active-count enforcement, candidate selection and the atomic claim transition.

## Connection pooling

`@ayin/db` now creates an explicit bounded `pg.Pool` for each Prisma adapter.

Supported settings:

- `DATABASE_POOL_MAX`: 1-50
- `DATABASE_POOL_MIN`: 0-20 and never above max
- `DATABASE_POOL_IDLE_TIMEOUT_MS`: 1s-300s
- `DATABASE_POOL_CONNECT_TIMEOUT_MS`: 0.5s-60s
- `DATABASE_STATEMENT_TIMEOUT_MS`: 0-300s; default 0/off

PM2 applies service-specific default maxima:

- API: 10
- analytics worker: 4
- warehouse worker: 2
- media/privacy worker: 4

The default declared maximum is therefore 20 application connections, before temporary migration/maintenance sessions. Keep operational headroom below PostgreSQL `max_connections`; do not simply raise every process pool when traffic grows.

Each connection uses the AYIN service name as PostgreSQL `application_name`, so live connection pressure is attributable by process.

## Transaction-scope review

Consistency-sensitive transactions remain on the primary and remain intentionally narrow:

- auth/session and account-status mutations;
- financial ledger, reconciliation and payout changes;
- watch progress/history paired writes;
- media queue claim/recovery/finalization;
- warehouse export checkpoints;
- admin mutations plus their audit records.

No network/R2/FFmpeg work is moved into database transactions.

Analytics rollup rebuild transactions remain serialized because partial rollup replacement would be incorrect; they run in a background worker and are not moved to a replica.

## Scaling stages

### Stage 1 — single primary + optimized indexes/pooling

Current target.

Use one PostgreSQL primary with:

- the Task 86 indexes;
- bounded service pools;
- batched hot-path reads;
- bounded pagination;
- existing rollup tables;
- Admin PostgreSQL observability;
- regular `VACUUM/ANALYZE`, backup and restore verification.

Before leaving Stage 1, collect real metrics: CPU, IOPS, buffer-cache behavior, connection saturation, p95/p99 API latency, lock waits and top statement execution time.

### Stage 2 — larger DB resources

Scale the primary vertically when metrics show sustained resource pressure that query/index work does not solve.

Typical evidence:

- sustained CPU/IO saturation;
- memory/cache pressure;
- connection headroom becoming too small even with bounded pools;
- write latency increasing on correctly indexed operations.

Do not add a replica merely because the database is larger.

### Stage 3 — read replica for safe read-heavy workloads

Only after measured read pressure dominates and primary write capacity/latency would benefit.

Possible replica candidates, with explicit staleness tolerance:

- anonymous/public discovery;
- public search;
- historical analytics dashboards/rollups that do not require immediate freshness.

Remain on the primary:

- authentication/session reads used for authorization decisions;
- account/profile mutations;
- watch progress read-after-write paths;
- subscriptions/reactions/comments where immediate consistency matters;
- media worker queue claims/heartbeats/recovery/finalization;
- finance/revenue/payout/reconciliation;
- admin writes and audit logging;
- export checkpoints and any workflow requiring read-your-writes.

AYIN currently has no replica router. Task 86 intentionally does not add one.

### Stage 4 — specialized stores only when metrics justify them

Introduce a specialized search, analytics, cache or queue store only when measured PostgreSQL limits or product requirements justify the operational cost.

Examples of evidence:

- search relevance/latency requirements that PostgreSQL FTS/trigram cannot meet;
- analytics scan/retention volume that aggregate tables and a warehouse boundary cannot serve;
- queue throughput/lock contention that remains problematic after PostgreSQL claim tuning;
- cacheable read volume materially dominating DB resources.

Sharding is not a default stage and should require a concrete data-size/write-throughput boundary plus an ownership/partitioning model.

## Operational checks

After deployment, inspect:

- `GET /admin/observability/postgres`
- total vs `max_connections`
- per-service connections and active sessions
- idle-in-transaction sessions (target: normally zero)
- slow statement timing IDs when `pg_stat_statements` is available
- API p95/p99 for discovery/search/watch/admin
- media queue claim latency and lock waits
- analytics worker runtime.

If `pg_stat_statements` is not installed/preloaded, AYIN remains fully functional. Enable it only as an operational observability decision; it is not a runtime dependency.

## Query-plan regression tests

`apps/api/test/postgres-query-performance.integration.test.ts` runs against disposable PostgreSQL after clean migrations.

It verifies that:

- public discovery can use the new Video and playable-media indexes;
- trending can use the recent-watch index;
- revenue aggregation can use the channel/currency/time index;
- existing search, analytics, media queue and moderation indexes remain present.

These tests guard query/index compatibility. They are not substitutes for production latency/load tests.
