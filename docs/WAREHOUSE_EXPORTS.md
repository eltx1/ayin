# AYIN Warehouse Export Boundary

Task 84 adds a provider-neutral boundary for exporting AYIN analytics and revenue data to a future warehouse. AYIN does **not** require a warehouse to run.

The built-in adapter is `DISABLED`. No BigQuery, Snowflake, object-storage vendor, replication product, or other provider is selected without an operational requirement.

## Architecture

The boundary separates source extraction from delivery:

1. `WarehouseExportService` reads one incremental page from each versioned dataset.
2. Source rows are converted into privacy-reviewed export records.
3. Records are grouped into UTC partition dates.
4. A deterministic SHA-256 `batchId` is computed from the dataset, schema version, checkpoint, partition and records.
5. The configured `WarehouseExportAdapter` writes each batch.
6. The dataset checkpoint advances only after every partition batch in that page succeeds.

An adapter must treat `batchId` as an idempotency key. A failed delivery leaves the checkpoint unchanged, so the next pass retries the same source window. If an earlier partition had already succeeded, its deterministic `batchId` lets the adapter safely deduplicate the retry.

Checkpoint updates are monotonic. Concurrent/replayed exporters cannot move a dataset checkpoint backwards.

The adapter capability model is intentionally generic and can represent:

- object batches;
- batch files;
- database export/replication bridges;
- direct warehouse APIs.

A future provider adapter can implement one or more of these patterns without changing the exported schemas.

## Versioned datasets

All Task 84 contracts use `schemaVersion: 1`.

### `analytics_facts` v1

Source: `AnalyticsEvent`.

Cursor: `receivedAt + id`, so late-arriving events are still exportable.

Partition: UTC date of `occurredAt`.

Includes event/content attribution, existing `sessionHash` / optional `profileHash`, bounded playback values, and only the already-sanitized coarse `countryCode`, traffic-source category and playback protocol.

It does **not** export `accountId`, client event identifiers, raw metadata, raw search text, raw IPs, or any new cross-context identity.

### `content_dimensions` v1

Source: `Video`.

Cursor and partition: `updatedAt + id`.

Includes stable video/channel IDs, content type/form, lifecycle state, visibility, duration and timestamps.

It deliberately excludes title, description and slug because they are not required for the warehouse analytics boundary.

### `channel_dimensions` v1

Source: `Channel`.

Cursor and partition: `updatedAt + id`.

Includes stable channel ID, lifecycle state, platform-owned flag and timestamps.

It deliberately excludes channel name, handle and description.

### `ad_facts` v1

Source: `AdEvent`.

Cursor: `createdAt + id`.

Partition: UTC date of `occurredAt`.

Raw `profileId` and `sessionId` are converted with the same HMAC pseudonymization policy used by analytics before export. Request IDs and arbitrary ad metadata are not exported.

### `revenue_facts` v1

Source: `EarningsLedgerEntry`, the revenue ledger truth.

Cursor: `COALESCE(finalizedAt, createdAt) + id`.

Partition: UTC date of `occurredAt`.

A ledger row can therefore be exported again when it is finalized. Warehouses should upsert by `recordId` and regard `sourceUpdatedAt` as the source version.

The schema includes monetary facts, attribution IDs, revenue-share basis points and accounting period timestamps. It excludes memo text, source idempotency keys, creator account data, payout destinations, legal names and encrypted payout material.

## Privacy boundary

Warehouse export does not create a new identity system.

- Existing analytics hashes remain hashed.
- Raw ad viewer/session IDs are HMAC-pseudonymized at the boundary.
- No account email, legal name, payout destination, auth/session secret, encryption key or provider credential is exported.
- No arbitrary analytics/ad metadata is forwarded.
- Anonymous analytics identities are not linked beyond the existing privacy-safe design.

Any future schema version that adds fields requires an explicit privacy review and a version bump.

## Incrementality, retries and partitions

Each dataset/version owns a `WarehouseExportCheckpoint` with:

- `cursorAt`;
- `cursorId`;
- last successful `batchId`;
- last success timestamp.

Source indexes support the export cursors.

Exports are page-bounded by `WAREHOUSE_EXPORT_PAGE_SIZE` (default 1000, clamped 10-10000) and scheduled by the dedicated worker using `WAREHOUSE_EXPORT_INTERVAL_MS` (default 15 minutes, clamped 1 minute to 24 hours).

The current disabled adapter causes `exportOnce()` to return immediately without touching the database, so AYIN remains fully functional when no warehouse is configured.

## Adapter contract

A future adapter implements `WarehouseExportAdapter` and must:

- declare whether it is configured;
- declare one or more supported patterns;
- accept versioned partition batches;
- honor `batchId` idempotency;
- throw on incomplete/failed delivery so the checkpoint does not advance;
- never mutate source truth.

Provider-specific credentials belong only inside that adapter's secure runtime configuration and must never be serialized into export records.

## Verification

Task 84 fixture tests validate every v1 schema and verify excluded sensitive/direct fields. Delivery tests verify deterministic batch IDs, retry behavior, checkpoint non-advancement on failure, and the zero-dependency disabled path. Repository CI also applies the checkpoint/index migration to a clean PostgreSQL database.
