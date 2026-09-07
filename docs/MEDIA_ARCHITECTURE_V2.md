# AYIN Media Architecture V2

Status: Task 39 architecture and contract baseline. No production playback switch is made by this task.

## Purpose

AYIN is evolving from a single canonical progressive MP4 output to a production-grade adaptive streaming architecture while preserving the working MP4 path. The target flow is:

Creator source upload -> validation/probe -> canonical fallback MP4 -> adaptive video renditions -> HLS packaging -> master manifest -> Cloudflare R2 -> `media.ayin.stream` -> AYIN Player adaptive playback.

Task 39 prepares architecture, persistence contracts, object-key contracts and invariants only. It does **not** implement HLS transcoding or change the public playback response/player source selection.

## Pre-change architecture drift audit

This audit was completed against `main` at `46b09bf8001531abe43202912334acef586b071a` before Task 39 code changes. Current code is authoritative where older documents disagree.

1. **FFmpeg processing exists in production code.** Older architecture documents describe direct upload of a playback-ready MP4 and say no transcoding pipeline is implied. Current code has a dedicated media worker, database-backed queue, `ffprobe`, FFmpeg execution, R2 staging/output handling and output verification.
2. **Creator ingest is not MP4-only.** `MediaUploadService` accepts a controlled set of source containers/codecs by MIME/extension, stores a staging source under `channels/{channelId}/media/{assetId}/source.{ext}`, and enqueues processing after R2 verification.
3. **The current canonical playback MP4 is generated.** `MediaProcessingExecutorService` emits H.264/AAC, `yuv420p`, fast-start MP4 and caps the output height without upscaling. The current deterministic canonical key is `channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4`.
4. **Processing already has lease/retry recovery semantics.** `MediaProcessingQueueService` claims jobs under a database advisory lock, maintains leases/heartbeats, requeues retryable failures with backoff, and recovers stale leases. The executor also recognizes and verifies an already-uploaded output before redoing work.
5. **The V1 schema represents only one final processing output per generation.** `MediaProcessingJob` has one `outputR2ObjectKey` and one `finalAssetId`. This is sufficient for the canonical MP4 but not for a master manifest plus multiple rendition playlists/segment namespaces with independent lifecycle state.
6. **Source and canonical roles are currently conflated.** The upload begins as a `SOURCE_VIDEO` `MediaAsset`; after successful processing the canonical MP4 is also written as a validated `SOURCE_VIDEO`, while a distinct staging source may be marked removed and its R2 object deleted. Reprocessing therefore commonly starts from the latest validated canonical MP4 rather than an indefinitely retained original camera/source file.
7. **Public playback is still intentionally MP4-only.** `WatchService` selects a validated `SOURCE_VIDEO` with `video/mp4`; `PublicPlaybackResponse` exposes one source; `AyinPlayer` assigns one `sourceUrl` directly to `<video>` and reports MP4-specific playback errors.
8. **Publishing is gated by canonical MP4 readiness.** Creator publishing requires a validated MP4 and otherwise returns upload/processing/processing-failed states. Task 39 does not change this gate.
9. **R2 remains the production media object store.** The worker uses R2/S3 SigV4 operations for source download, output upload, HEAD verification and cleanup. Local disk is ephemeral processing scratch space only.

These differences are intentional evolution, not a reason to regress the working pipeline. V2 builds on the current queue/worker boundary.

## V2 boundary

The media system remains inside the existing modular monolith plus dedicated worker process:

- API/creator modules own upload and publishing state transitions.
- the existing media queue owns durable job claims, retry and lease recovery;
- the worker owns CPU-intensive probe/transcode/package work;
- media storage adapters and R2 infrastructure own object I/O;
- PostgreSQL stores generation/output state needed for recovery;
- `media.ayin.stream` remains the playback delivery origin;
- AYIN Player remains on the current MP4 source until a later, separately controlled rollout.

No external transcoding microservice is introduced in Task 39.

## Processing generations

A **playback generation** is the atomic distribution set for one video processing generation. Generation numbers continue the existing `MediaProcessingJob.generation` convention.

A V2 playback generation contains:

- one canonical fallback MP4;
- zero or more planned adaptive rendition identities while planning;
- one HLS media playlist per planned rendition;
- one HLS master manifest;
- deterministic segment prefixes per rendition;
- a processing contract version (`2` for this architecture baseline);
- lifecycle state for the generation and every output.

A generation must never be presented as adaptive `READY` while any required output is absent, unverified, failed, or still being produced. Individual objects may exist in R2 before the generation is ready; consumers must trust database readiness, not object existence.

The existing V1 MP4 remains independently usable throughout migration.

## Initial rendition ladder

The initial production ladder is deliberately conservative and limited to 360p/480p/720p/1080p.

| Identity | Target height | H.264 video bitrate | AAC audio bitrate | Pixel format |
| --- | ---: | ---: | ---: | --- |
| `360p` | 360 | 800 kbps | 96 kbps | `yuv420p` |
| `480p` | 480 | 1,400 kbps | 128 kbps | `yuv420p` |
| `720p` | 720 | 2,800 kbps | 128 kbps | `yuv420p` |
| `1080p` | 1080 | 5,000 kbps | 160 kbps | `yuv420p` |

Planning rules:

- never upscale;
- include a rung only when normalized source display height is at least that rung's target height;
- preserve aspect ratio;
- calculate an even output width from the normalized source aspect ratio;
- H.264 video + AAC audio initially;
- HLS uses MPEG-TS segments initially for broad browser/TV compatibility;
- the progressive fallback remains MP4;
- a source below 360p receives no adaptive rung and continues to rely on the canonical MP4 path;
- 1440p/2160p are not production outputs in V2. The identity/storage model can be extended later without changing the namespace model.

Task 40 must make probing rotation-aware before applying the planner so portrait/rotated source dimensions are normalized correctly.

## Deterministic R2 layout

V2 retains AYIN's existing channel/video/generation namespace instead of introducing a second top-level convention.

Current fallback object (unchanged):

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4
```

Future adaptive objects for the same generation:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/master.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/360p/index.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/360p/segment-000001.ts
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/480p/index.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/480p/segment-000001.ts
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/720p/index.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/720p/segment-000001.ts
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/1080p/index.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/1080p/segment-000001.ts
```

Only planned rungs are created. Segment numbers are fixed-width so retries and manifests resolve to deterministic keys. A retry for the same generation writes the same namespace; a deliberate reprocess uses a new generation and therefore a new namespace.

R2 can store `g1.mp4` and objects beneath the independent key prefix `g1/hls/` at the same time, so retaining the existing fallback key does not block the adaptive namespace.

## Domain/storage contracts

Task 39 introduces contracts for:

- rendition identity and ladder parameters;
- normalized width/height planning;
- video/audio bitrate;
- H.264/AAC codecs and `yuv420p` compatibility;
- progressive MP4 vs HLS/MPEG-TS protocol/container roles;
- deterministic fallback, master, playlist and segment-prefix keys;
- source asset/video/generation identity;
- processing contract version;
- output and generation lifecycle state;
- an atomic adaptive-ready predicate.

The contract is intentionally independent of FFmpeg command construction. Task 40 may consume it from the existing executor/worker without changing the public player yet.

## Persistence

The V1 `MediaProcessingJob` row remains unchanged and continues to drive the live MP4 pipeline. V2 adds additive tables for playback-generation and rendition state. There is no backfill requirement and no existing row is rewritten.

The V2 rows are dormant until later code begins creating them. This keeps the Task 39 migration behavior-neutral while giving future packaging enough durable state to distinguish planned, processing, uploaded, verifying, ready and failed outputs.

## Readiness invariant

Adaptive readiness is atomic at the generation boundary:

1. fallback MP4 is `READY`;
2. HLS master manifest is `READY`;
3. at least one rendition is planned;
4. every planned rendition is `READY`;
5. generation lifecycle may then transition to `READY`.

The master manifest must be uploaded/verified only after the referenced rendition playlists and segment sets are complete. A failed or abandoned partial namespace is not discoverable as ready playback.

## Idempotency and recovery

- Same video + generation + rendition identity maps to the same database uniqueness key and R2 namespace.
- Re-running the same generation must HEAD/probe/verify deterministic outputs before replacing work where safe.
- Retryable failures remain under existing queue attempt/lease semantics.
- A retry must not create a new generation. A deliberate reprocess creates the next generation.
- Status moves through explicit lifecycle states; object existence alone never means ready.
- Generation `READY` is a final publication boundary for adaptive metadata, not a statement that every intermediate object was created in one process invocation.
- Superseded generations remain addressable for rollback/cleanup policy; new playback selection must choose only a current ready generation.

## Compatibility and rollout

Task 39 compatibility policy:

- keep the existing canonical MP4 key and generation behavior;
- keep `MediaAsset`/`WatchService` MP4 source selection unchanged;
- keep creator publish gating unchanged;
- keep `PublicPlaybackResponse` unchanged;
- keep `AyinPlayer` source handling unchanged;
- create no HLS objects;
- deploy no behavior-changing media switch.

A later rollout may generate V2 outputs behind a disabled/default-off capability, validate them in production, expose adaptive metadata without selecting it, then enable adaptive player selection separately with instant fallback to canonical MP4.

## Exact Task 40 dependency

Task 40 must implement **generation of V2 adaptive outputs behind a default-off rollout control using the existing media queue/worker**, consuming the Task 39 planner, object-key contracts and persistence model. It must add rotation-aware probe metadata, create only justified 360p/480p/720p/1080p renditions, package HLS, verify every required object, and atomically mark the playback generation ready. It must **not** make AYIN Player prefer HLS until a separate playback-switch step proves output compatibility and rollback behavior.
