# AYIN V1 Analytics

Task 22 adds a first-party, PostgreSQL-backed analytics pipeline. It is intentionally a V1 operational analytics system, not a realtime warehouse.

## Event contract

Clients send versioned events to `POST /analytics/events` in batches of at most 100. Every event has a client-generated UUID for idempotency, `schemaVersion: 1`, an occurrence time, a session identifier, optional profile/content identifiers, source/device metadata, and a bounded payload. The API validates every batch and uses `createMany(..., skipDuplicates: true)` so retrying the same client event does not double count it.

Tracked V1 event families cover app/session open, content impression/click, playback start/progress/complete/pause/seek/buffer, search and search clicks, subscribe/like/comment/share, Creator TV starts, upload lifecycle, and video ad request/start/quartile/complete/click/error.

## Sampling and batching

Playback progress is emitted from the existing player checkpoint cadence rather than every second. The web client queues events, flushes after 20 events or roughly three seconds, and attempts a keepalive/beacon flush when the page is hidden or unloaded. Analytics failure never blocks playback, upload, social actions, or advertising.

Watch time uses bounded `VIDEO_PROGRESS.durationDeltaMs` samples. The first checkpoint is capped to the normal 15-second cadence so resuming far into a video cannot incorrectly credit the entire seek position as watch time.

## Privacy

Raw client session/profile identifiers are never persisted. The API stores HMAC-SHA256 pseudonyms. Production must set a stable, secret `ANALYTICS_HASH_SALT`; `AUTH_TOKEN_SECRET` is only a compatibility fallback and the repository local default is for development/test only. Do not put email addresses, names, raw search terms, IP addresses, cookies, tokens, or other direct identifiers in analytics metadata.

Search analytics records query length and result count, not the raw search text.

## Storage and indexes

`AnalyticsEvent` is indexed by occurrence time, event+time, session+time, channel+time, video+time, and account+time. `clientEventId` is unique. This supports the V1 Creator Studio and Admin query patterns without introducing a warehouse prematurely.

Creator Studio metrics are calculated at request time for a bounded period: views, sampled watch time, average view duration, completion rate, top videos, and current subscriber count. Admin metrics provide approximate DAU/MAU by pseudonymous session, 30-day watch hours, uploads, Creator TV starts, ad-event volume, and tracked errors.

These endpoints are **query-time metrics**, not realtime streaming dashboards.

## Retention

`POST /admin/analytics/cleanup` deletes events older than a configured retention period. The V1 default is 400 days and the accepted range is 30–3650 days. Production operations should schedule this endpoint or an equivalent maintenance job after selecting the legal/product retention policy. A later warehouse/rollup migration can aggregate older data before deletion if long-term trend retention becomes necessary.

## Operational notes

- Server timestamps are bounded to reject materially stale/future client timestamps.
- Referenced video/channel IDs are validated; video events derive channel attribution from the database rather than trusting client channel attribution.
- No analytics response is represented as revenue. Revenue attribution belongs to Task 23.
- Existing advertising event storage remains intact; Task 22 additionally mirrors supported player-ad lifecycle events into the analytics event stream for product metrics.
