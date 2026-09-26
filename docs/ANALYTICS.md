# AYIN Analytics

AYIN keeps first-party raw analytics in PostgreSQL and serves Creator/Admin dashboards from deterministic rollups. The system is deliberately **not realtime**.

## Raw event truth

Clients send versioned events to `POST /analytics/events` in batches of at most 100. Every event carries a client-generated UUID, `schemaVersion: 1`, occurrence time, pseudonymous session identity, optional content attribution and bounded telemetry.

`AnalyticsEvent.clientEventId` is unique and ingestion uses `createMany(..., skipDuplicates: true)`. Retried client batches therefore do not create duplicate raw truth.

Raw `AnalyticsEvent` rows remain authoritative for the configured retention period. Rollups can always be rebuilt from those rows while they remain retained.

## Privacy

Raw client session/profile identifiers are never persisted. The API stores HMAC-SHA256 pseudonyms. Production must set an independent `ANALYTICS_HASH_SALT`.

Analytics metadata strips IP/location-like keys and raw IP-looking string values. Country analytics are coarse, trusted-edge country codes only. Search analytics do not store raw search text.

## Task 82 rollups

Task 82 adds these grains:

- hourly video metrics;
- daily video metrics;
- daily channel metrics;
- daily platform metrics;
- daily channel dimensions for device, traffic source, country and playback protocol;
- daily playback-session projections used to preserve cross-day distinct-viewer and retention correctness;
- daily platform-session projections used to preserve 30-day distinct-session correctness.

Rollup counters include applicable views/starts, sampled watch time, completions, playback startup/buffering quality, HLS failures/fallbacks, quality switches, subscribe/like analytics events and ad lifecycle events. Creator ad request/fill telemetry continues to use the existing `AdEvent` truth and is folded into the channel daily rollup without inferring revenue.

### UTC window contract

All bucket boundaries are UTC and are written as exact UTC hour/day instants. Dashboard ranges use **complete UTC calendar days**. The current partial UTC day is intentionally excluded, so no response should be described as realtime.

### Idempotency and reruns

A rollup window is rebuilt with a transactional replace-from-raw operation:

1. delete aggregate rows for the exact deterministic window;
2. re-read authoritative raw events for that same window;
3. insert the recomputed aggregate rows;
4. commit atomically.

Running the same window repeatedly therefore produces the same result and cannot accumulate duplicate counts.

### Late-arriving events

The worker stores a successful processing watermark. On each pass it checks indexed `AnalyticsEvent.receivedAt` and `AdEvent.createdAt` with a bounded overlap around the prior watermark, then reopens the earliest affected closed UTC window. The overlap protects short commit/watermark races. If the worker was offline across one or more boundaries, reconciliation resumes from the UTC hour/day containing the previous successful watermark, so the formerly-open bucket cannot be skipped.

Because reopened windows are recomputed from raw truth rather than incremented, late data revises the aggregate without double counting. Rebuild and cleanup transactions also take a PostgreSQL advisory transaction lock, so worker/manual reruns serialize safely; the successful watermark advances monotonically.

Hourly video buckets are rebuilt only for completed hours. Daily dashboard buckets are rebuilt only for completed UTC days.

## Dashboard query path

Creator Studio reads additive metrics from daily channel/video rollups and dimension rollups. Distinct viewers and retention use the smaller daily playback-session projection instead of rescanning `AnalyticsEvent`.

Admin analytics reads daily platform rollups and the daily platform-session projection. DAU is the last completed UTC day; MAU is distinct pseudonymous sessions across the last 30 completed UTC days.

Subscription totals and gained subscriptions remain sourced from the authoritative product `Subscription` table rather than analytics-event estimates.


## Task 83 cohort analytics

Task 83 adds product-level cohort metrics without extending anonymous tracking. Cross-day D1/D7/D30 cohorts use only the existing HMAC-pseudonymous `profileHash` attached to signed-in profile analytics. Anonymous `sessionHash` values remain session-scoped and are never linked across contexts to manufacture a persistent anonymous identity.

Scheduled rollups now materialize:

- platform daily new-vs-returning signed-in profiles, session frequency and cohort watch time;
- channel daily new-vs-returning signed-in profiles plus return-to-previously-watched-content behavior;
- platform D1/D7/D30 profile-retention cohorts;
- channel D1/D7/D30 audience-retention cohorts, including same-content return behavior;
- pseudonymous subscription episodes and channel D1/D7/D30 subscriber-retention cohorts.

Creator and Admin requests read these aggregate tables rather than repeating large raw-event cohort scans. Cohort rows below `ANALYTICS_COHORT_MIN_SIZE` are not returned. The default is 20 and configuration is clamped to 10-1000. Creators receive channel-level aggregate rows only; no profile hashes, session hashes, or individual viewer histories are returned. Admin receives platform-level cohort aggregates.

A viewer is "new" only relative to the analytics identity lookback still available under the configured raw-event retention policy. AYIN does not persist a pseudonymous first-seen identity beyond that privacy boundary merely to preserve lifetime cohort identity.

### Subscriber-retention scope

Subscription retention is measured from server-side subscription episodes recorded after Task 83 tracking starts. Subscribe/unsubscribe mutations write only the channel id, HMAC-pseudonymous profile identity and lifecycle timestamps. Historical churn that occurred before this tracking boundary is not reconstructed or claimed. Episode-level pseudonyms are removed by the same configured analytics retention cleanup; aggregate cohort rows may remain for long-term trend reporting.

### Cohort semantics

Cohort dates and D1/D7/D30 boundaries are complete UTC calendar days. For a cohort created on day D:

- D1 measures activity on D+1;
- D7 measures activity on D+7;
- D30 measures activity on D+30.

An immature milestone remains null rather than being reported as zero. Retention denominators are the distinct pseudonymous profiles in the original cohort, not joined activity-row counts. Cohort session frequency is sessions per retained profile at the target day, and cohort watch time is measured progress-checkpoint watch time for retained profiles on that target day.

## Operational worker

Production PM2 runs a dedicated `ayin-analytics-worker` process from `dist/analytics-worker.js`.

Configuration:

- `ANALYTICS_ROLLUP_INTERVAL_MS`: default 300000 ms, clamped to 60000-3600000 ms.
- `ANALYTICS_RETENTION_DAYS`: default 400 days, clamped to 30-3650 days.

The worker performs rollup reconciliation first, then checks once per UTC day whether retention cleanup is due. Cleanup atomically removes expired raw `AnalyticsEvent` rows and the session-hash projection rows at the same daily retention boundary. Anonymous aggregate rollups can remain for longer-term trends. The manual Admin cleanup endpoint also reconciles rollups before running the same cleanup path.

Rollup tables are not a replacement for raw truth inside the raw retention window. Session-level rollup projections do not extend pseudonymous identity retention beyond that window. Revenue truth and reconciliation remain owned by the revenue/advertising systems.

## Verification

Task 82 includes PostgreSQL reconciliation tests that compare raw event counts/sums with video/channel/platform aggregates, rerun the same windows to prove no double counting, inject late-arriving events, rerun the affected window, and verify the aggregate changes exactly once while raw rows remain unchanged.
