# Task 42 — Adaptive streaming rollout and controlled backfill

Task 42 adds operational rollout controls around the HLS generation from Task 40 and the HLS/MP4 player from Task 41. It deliberately does **not** migrate the catalog in one shot and it does **not** delete canonical MP4 playback files.

## Safety controls

AYIN uses independent controls so generation, new-upload adoption, catalog backfill, and playback can be staged separately:

| Control | Default | Purpose |
| --- | --- | --- |
| `mediaHlsEnabled` | `false` | Technical kill switch for HLS generation. |
| `mediaHlsNewUploadsEnabled` | `false` | Allows verified HLS generation for newly processed uploads. |
| `mediaHlsBackfillEnabled` | `false` | Allows explicitly requested catalog backfill jobs. |
| `mediaHlsBackfillPaused` | `true` | Persistent pause for claiming queued backfill work. Already-claimed work may finish safely. |
| `mediaHlsBackfillBatchSize` | `2` | Normal maximum videos considered per operator batch; hard maximum is 20. |
| `mediaHlsBackfillMaxInFlight` | `1` | Maximum queued + active backfill jobs; hard maximum is 4. |
| feature flag `player.hls.enabled` | absent/off | Allows verified adaptive output to be advertised by the public playback contract. |

The existing global media worker concurrency and FFmpeg thread/scratch limits remain authoritative. Backfill jobs use lower queue priority than normal uploads so catalog maintenance cannot starve creator uploads.

## New uploads

Canonical MP4 remains mandatory and is produced/verified first. HLS generation for a new processing job occurs only when both `mediaHlsEnabled` and `mediaHlsNewUploadsEnabled` are on. If adaptive processing fails, the canonical MP4 remains the playback fallback.

The public watch contract advertises HLS only when the playback feature flag is enabled **and** a playback generation is `READY` with a verified fallback, verified HLS master, and at least one verified HLS rendition. Partial output is never advertised.

## Existing-video eligibility

Backfill candidates must be:

- `PUBLISHED`;
- not `PRIVATE`;
- not removed;
- owned by an active, non-removed channel; and
- backed by a validated canonical `video/mp4` source.

Videos with a complete adaptive generation or any active/queued processing generation are skipped idempotently. A backfill job reuses the already-validated canonical MP4 as both input and output, so it does not retranscode or delete the canonical fallback.

## Bounded backfill operations

Operations are exposed through aggregate, typed admin actions under `/admin/media-processing/adaptive-rollout`; raw queue mutation is not exposed.

- `GET /admin/media-processing/adaptive-rollout` — rollout state, catalog state, and metrics.
- `POST .../backfill/run` — enqueue one bounded batch.
- `POST .../backfill/pause` — prevent new backfill claims.
- `POST .../backfill/resume` — allow claims again; it does not automatically flood the queue.
- `POST .../recovery` — one of the predefined recovery modes below.

All mutating operations are admin-audited. The queue itself refuses to claim backfill jobs while generation/backfill is disabled or the durable pause is active. Normal upload jobs remain claimable.

## Operational visibility

The rollout overview reports:

- eligible;
- queued;
- processing;
- adaptive ready;
- failed;
- fallback-only;
- oldest pending; and
- the current rollout controls.

## Recovery modes

Recovery is always bounded by the requested/configured batch ceiling and never deletes the canonical MP4.

- `INCOMPLETE_HLS`: requeues stale incomplete/failed adaptive generations when safe.
- `STALE_PROCESSING`: invokes the existing lease-based stale-worker recovery.
- `VERIFIED_HLS_MISSING_DB`: detects deterministic manifests without corresponding DB generation state. AYIN intentionally creates a new processing generation instead of blindly adopting orphan state.
- `DB_MANIFEST_MISSING`: HEAD-verifies DB-ready manifests, marks missing output failed, and schedules a safe new backfill generation.
- `FAILED_BACKFILL`: resets a bounded set of failed backfill jobs for retry.

## Metrics

The operator overview includes a 30-day adaptive playback view and durable processing/storage measurements:

- HLS startup success (`VIDEO_START` with HLS protocol metadata);
- fatal adaptive failures (`VIDEO_HLS_FATAL`);
- MP4 fallbacks (`VIDEO_FALLBACK`) and fallback rate;
- average adaptive processing duration grouped by source-resolution bucket; and
- accumulated verified HLS output bytes recorded when master, playlists, and segments are remotely verified.

No new user-identifying telemetry is introduced; metrics use the existing privacy-preserving analytics ingestion from Task 41.

## Rollout sequence

1. **Feature off** — deploy code with generation/new-upload/backfill/playback controls off and backfill paused.
2. **Staff/test content** — enable generation only in an explicitly controlled test environment/content set; verify outputs and metrics.
3. **New uploads** — enable `mediaHlsEnabled` + `mediaHlsNewUploadsEnabled` while keeping backfill paused; enable playback only after verified observation.
4. **Small backfill batches** — enable backfill, resume, keep `maxInFlight=1`, and run batches of 1–2 while watching CPU/storage/fallback metrics.
5. **Gradual expansion** — increase batch and in-flight limits conservatively, never above the hard ceilings, while monitoring failures and storage growth.
6. **Default adaptive playback** — only after sustained healthy metrics should `player.hls.enabled` become the default playback path. MP4 remains canonical fallback.

## Deployment state expected from this PR

Merging Task 42 deploys code and database support only. It does not by itself enable production adaptive playback, new-upload HLS, or backfill. Backfill remains paused and no catalog batch is automatically started.
