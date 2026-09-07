# AYIN Cloudflare R2 uploads and media object lifecycle

Task 06 established direct browser-to-R2 upload. The repository has since evolved: creator source uploads still bypass `apps/web` and API request bodies, but a dedicated media worker now downloads verified R2 source objects to bounded ephemeral scratch space for `ffprobe`/FFmpeg processing and uploads canonical playback output back to R2.

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

## Current canonical MP4 processing

The current production media path is:

```text
Creator browser
  -> direct R2 source upload
  -> API verifies object and enqueues MediaProcessingJob
  -> media worker claims job with lease/heartbeat
  -> worker downloads source to ephemeral local scratch
  -> ffprobe validates dimensions/duration
  -> FFmpeg produces H.264/AAC yuv420p fast-start MP4
  -> worker uploads canonical MP4 to R2
  -> worker HEAD/probes output
  -> lifecycle marks canonical MediaAsset validated and job READY
```

The deterministic canonical object key is:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4
```

The worker may temporarily hold input/output files under its configured processing scratch directory. That scratch space is not authoritative storage, is cleaned after work, and must not become a durable creator-media repository. Web/API upload handlers still never proxy creator video bodies.

If a verified canonical object for the same deterministic generation already exists, the executor can validate/reuse it during recovery instead of blindly duplicating work.

## Task 39 Media Architecture V2 namespace

Task 39 does not generate HLS. It reserves deterministic adaptive namespaces that extend the existing generation convention without moving the working MP4 fallback:

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

Only renditions justified by source resolution are planned. V2 initially supports 360p/480p/720p/1080p H.264/AAC `yuv420p`; it never upscales and does not emit 1440p/4K production renditions yet.

A partial R2 namespace is never sufficient evidence of readiness. Adaptive selection must depend on durable database lifecycle state and may mark a generation `READY` only after the fallback, master manifest and every planned rendition are verified.

## Source retention and reprocessing reality

Current V1 lifecycle code may mark the staging source removed and delete its R2 object after canonicalization. The canonical validated MP4 can therefore become the source for a later reprocess generation. Task 39 records this existing behavior rather than pretending an original camera master is retained forever.

Future retention policy may choose to preserve original sources, but that is a separate product/cost decision and is not introduced by Task 39.

## Abandoned upload cleanup

`MediaUploadService.cleanupAbandonedUploads(olderThan)` is the cleanup entry point for stale `PENDING` uploads. It aborts stale multipart uploads, removes partial/single objects when appropriate and marks stale metadata rejected/removed. R2 lifecycle rules remain a secondary cleanup safety net.

## Playback compatibility

Production playback remains the validated canonical MP4 served from `media.ayin.stream`. `WatchService`, the public playback response and AYIN Player are not switched to HLS by Task 39.

See `docs/MEDIA_ARCHITECTURE_V2.md` and ADR-015 in `docs/DECISIONS.md` for the adaptive architecture contract and rollout semantics.
