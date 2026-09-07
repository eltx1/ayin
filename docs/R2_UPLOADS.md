# AYIN Cloudflare R2 uploads and media object lifecycle

Task 06 established direct browser-to-R2 upload. The repository has since evolved: creator source uploads still bypass `apps/web` and API request bodies, but a dedicated media worker now downloads verified R2 source objects to bounded ephemeral scratch space for `ffprobe`/FFmpeg processing and uploads canonical and, when explicitly enabled, adaptive playback output back to R2.

Cloudflare R2 remains the only **durable** AYIN creator-video object store. PostgreSQL stores metadata, lifecycle and R2 object keys only.

## Required production environment

```text
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET=<private-ayin-media-bucket>
R2_ACCESS_KEY_ID=<r2-s3-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-s3-secret-access-key>
R2_REGION=auto
UPLOAD_SESSION_SECRET=<random-secret-at-least-32-characters>
```

Optional tuning:

```text
R2_UPLOAD_URL_TTL_SECONDS=900
R2_PART_SIZE_BYTES=16777216
R2_MULTIPART_THRESHOLD_BYTES=67108864
```

The API credentials stay server-side. They are used to sign operation-specific URLs and perform R2 control-plane/worker operations. A creator never receives permanent R2 credentials.

When production R2 configuration is absent, AYIN selects its explicit development adapter and must never report fake production connectivity.

## R2 browser CORS

The private bucket must allow browser `PUT` from AYIN web origins and expose `ETag`, because multipart completion needs the ETag returned for each uploaded part.

Example:

```json
[
  {
    "AllowedOrigins": ["https://ayin.stream"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use exact production/staging origins rather than `*`.

## Current source upload keys

Creator source objects use server-generated stable identifiers and retain the accepted source extension:

```text
channels/{channelId}/media/{mediaAssetId}/source.{ext}
```

Original filenames are never used in R2 keys.

The current ingest allow-list is broader than MP4 and is enforced by `MediaUploadService`. Browser selection is not authoritative; the server verifies MIME/extension/session state and the worker probes the uploaded media before producing playback output.

Large files use multipart upload. Small files use one short-lived presigned PUT. `MediaAsset.status` remains `PENDING` until R2 completion is verified, then becomes `UPLOADED` and processing is enqueued. Repeated completion is designed to be recoverable/idempotent.

## Canonical MP4 processing

The baseline production media path is:

```text
Creator browser
  -> direct R2 source upload
  -> API verifies object and enqueues MediaProcessingJob
  -> media worker claims job with lease/heartbeat
  -> worker downloads source to ephemeral local scratch
  -> ffprobe validates dimensions/duration/codecs/rotation
  -> FFmpeg produces H.264/AAC yuv420p fast-start MP4
  -> worker uploads canonical MP4 to R2
  -> worker HEAD/probes output
  -> canonical fallback remains available to publish/playback
```

The deterministic canonical object key is:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4
```

The worker may temporarily hold input/output files under its configured processing scratch directory. That scratch space is not authoritative storage, is cleaned after work, and must not become a durable creator-media repository. Web/API upload handlers still never proxy creator video bodies.

If a verified canonical object for the same deterministic generation already exists, the executor can validate/reuse it during recovery instead of blindly duplicating work.

## Media Architecture V2 adaptive namespace

Task 39 reserved the adaptive persistence contracts and deterministic namespace. Task 40 is the first implementation that can actually generate these HLS objects, but only when the typed platform kill switch `mediaHlsEnabled` is explicitly enabled. Its default is `false`.

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4
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

Only renditions justified by display source resolution are planned. V2 supports 360p/480p/720p/1080p H.264/AAC `yuv420p`; it never upscales and does not emit 1440p/4K production renditions.

Task 40 uploads and verifies every planned rendition before it writes the master playlist. The master is therefore the final R2 object in a successful adaptive build, but its existence is still **not** readiness evidence by itself.

A partial R2 namespace is never sufficient evidence of readiness. Adaptive selection must depend on durable `MediaPlaybackGeneration` / `MediaPlaybackRendition` state and may mark a generation `READY` only after the fallback, master manifest and every planned rendition are verified.

### Retry and verification

Retries reuse the same generation namespace. A rendition already marked `READY` is reused only after its remote VOD playlist passes structural validation and every referenced deterministic segment passes verification again. Segment numbering must be contiguous from `000001`. A previously ready generation is reused only when the fallback, all renditions and the exact expected deterministic master manifest pass verification.

Adaptive failure-state transitions are conditional on the same active, unexpired media-worker lease that owns the processing job. A stale worker that has already lost its lease cannot mark the shared adaptive generation failed after another worker reclaims it. The HLS failure path also avoids destructive R2 cleanup of deterministic adaptive keys, because a stale worker and its replacement intentionally share the same generation namespace. Partial variant or master objects may remain and are safely overwritten/re-verified on retry; they are harmless because public playback does not select HLS in Task 40 and database readiness never derives from object presence alone. The canonical MP4 fallback is preserved.

## Source retention and reprocessing reality

Current lifecycle code may mark the staging source removed and delete its R2 object after canonicalization. The canonical validated MP4 can therefore become the source for a later reprocess generation. Task 40 preserves this existing behavior rather than introducing a new original-master retention policy.

Future retention policy may choose to preserve original sources, but that is a separate product/cost decision.

## Abandoned upload cleanup

`MediaUploadService.cleanupAbandonedUploads(olderThan)` is the cleanup entry point for stale `PENDING` uploads. It aborts stale multipart uploads, removes partial/single objects when appropriate and marks stale metadata rejected/removed. R2 lifecycle rules remain a secondary cleanup safety net.

## Playback compatibility

Production playback remains the validated canonical MP4 served from `media.ayin.stream`. `WatchService`, the public playback response and AYIN Player are **not** switched to HLS by Task 40.

Merging Task 40 does not enable adaptive generation automatically. Operators can immediately stop new HLS work by setting `mediaHlsEnabled=false`; the MP4 processing/playback path remains intact.

See `docs/MEDIA_ARCHITECTURE_V2.md`, `docs/TASK40_HLS_TRANSCODING.md` and ADR-015 in `docs/DECISIONS.md` for the adaptive architecture, implementation and rollout semantics.
