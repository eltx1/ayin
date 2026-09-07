# Task 40 — Feature-gated multi-rendition HLS transcoding

Task 40 implements the first real adaptive VOD output pipeline defined by `MEDIA_ARCHITECTURE_V2.md` and ADR-015. It does **not** switch public playback to HLS. The canonical MP4 remains the production playback source until Task 41 performs the explicit player/API rollout.

## Processing flow

```text
PROBE
  -> CANONICAL / FALLBACK PREPARATION
  -> RENDITION GENERATION
  -> HLS PACKAGING
  -> R2 UPLOAD
  -> OUTPUT VERIFICATION
  -> ADAPTIVE GENERATION READY
```

The existing database-backed media queue, lease ownership, heartbeat, retry budget and stale-worker recovery remain authoritative. HLS work is performed inside the same claimed processing generation after the canonical MP4 has been produced or safely recovered and verified.

## Probe and rendition planning

The worker probes media with bounded `ffprobe` execution and records enough information to make safe planning decisions:

- duration;
- encoded width and height;
- display width and height after 90/270-degree rotation metadata;
- video codec;
- audio codec;
- whether an audio stream exists.

The initial ladder remains 360p, 480p, 720p and 1080p. A rung is emitted only when the display source height can support it. AYIN never upscales. Administrators may further disable rungs or lower the maximum output height, but Task 40 never permits output above 1080p.

## Encoding and packaging

Each planned variant is encoded as H.264 video with AAC audio when audio exists, `yuv420p`, predictable H.264 profile/level settings and MPEG-TS HLS segments. FFmpeg is invoked through argument arrays with shell execution disabled, an explicit timeout and bounded stderr capture. Admin settings never accept arbitrary FFmpeg command strings.

The master playlist is deterministic and is uploaded **last**, only after every planned rendition playlist and segment has been uploaded and verified.

## R2 layout

The canonical fallback key is unchanged:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}.mp4
```

Adaptive output uses the Task 39 namespace:

```text
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/master.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/{identity}/index.m3u8
channels/{channelId}/videos/{videoId}/playback/g{generation}/hls/{identity}/segment-{sequence}.ts
```

Segment sequences are deterministic zero-padded integers. Original filenames and user-controlled paths are never used.

## Readiness and partial-output safety

R2 object existence alone never means adaptive playback is ready. `MediaPlaybackGeneration` may reach `READY` only when:

1. the canonical MP4 fallback is `READY`;
2. every planned `MediaPlaybackRendition` is `READY`;
3. the HLS master is `READY`;
4. all required R2 objects have passed size/content-type checks and manifest verification.

A rendition failure may mark the adaptive generation failed only while the same processing job is still owned by the active, unexpired worker lease. The worker does not destructively delete deterministic HLS objects from its failure path because a stale worker could race a replacement worker using the same namespace. The canonical MP4 is always preserved. Partial or stale HLS objects are harmless because database readiness—not R2 object presence—controls whether an adaptive generation is usable.

## Retry and recovery

Retries reuse the same `(videoId, generation)` rows and deterministic R2 keys. They do not create a second adaptive generation for the same processing job.

A rendition previously marked `READY` is reusable only after its remote VOD playlist passes structural validation and every referenced deterministic segment is re-verified. Segment numbering must be contiguous from `000001`, and the playlist must contain the required VOD structure including a positive target duration and media durations. A generation previously marked `READY` is reusable only after the fallback, every rendition and the exact deterministic master manifest are re-verified. An arbitrary or mutated `master.m3u8` is not accepted as recovery evidence.

Failure-state transitions are lease-owned. If a worker has lost or expired its processing lease, it cannot mark the shared adaptive generation or rendition failed after another worker has reclaimed the job.

The database lifecycle remains the source of truth. Operators must never repair adaptive readiness by manually uploading a master manifest or changing R2 objects without matching verified database state.

## Resource controls

Task 40 uses typed platform settings for operational bounds:

- `mediaHlsEnabled` — adaptive generation kill switch, default `false`;
- per-rung enable flags for 360p/480p/720p/1080p;
- per-rung video bitrate targets;
- per-rung audio bitrate targets;
- `mediaHlsSegmentDurationSeconds`;
- `mediaHlsMaxOutputHeight`, capped at 1080;
- `mediaProcessingScratchMaxBytesPerJob`;
- existing `mediaProcessingConcurrentJobs`;
- existing `mediaProcessingFfmpegThreadsPerJob`;
- existing controlled FFmpeg preset setting.

The worker local slot count is also bounded by the configured global processing concurrency. Per-rendition scratch estimates and actual packaged bytes are checked against the job scratch budget. Rendition temporary directories are removed on success and failure, and the executor removes the whole job scratch directory in its existing `finally` path.

## Automatic thumbnails

Canonical-MP4 automatic thumbnail generation remains in the existing executor path. HLS generation is added after canonical verification/thumbnail handling and does not replace or disable thumbnail creation.

## Production rollout and rollback

Merging Task 40 must not enable HLS automatically. `mediaHlsEnabled` defaults to `false`, so current production behavior remains canonical MP4 processing/playback.

When adaptive generation is deliberately enabled for a controlled validation population, rollback is immediate at the processing layer: set `mediaHlsEnabled=false`. Existing canonical MP4 upload, publish and playback paths continue to work. Already generated HLS objects may remain in R2, but they are not selected by the Task 40 player/API path.

If an adaptive job fails, inspect the `MediaProcessingJob`, `MediaPlaybackGeneration` and `MediaPlaybackRendition` lifecycle records first. Do not infer readiness from the presence of `master.m3u8`. A normal queue retry re-enters the same deterministic generation and verifies reusable outputs before continuing. Do not manually delete deterministic HLS objects to recover a lease race; the replacement worker safely overwrites and verifies the same deterministic keys.

## Task 41 boundary

Task 41 may consume only adaptive generations whose durable state is `READY`, expose the verified HLS master through the playback API and teach AYIN Player to prefer adaptive playback with MP4 fallback. Task 40 intentionally makes none of those public playback changes.
