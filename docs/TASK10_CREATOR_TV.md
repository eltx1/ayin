# Task 10 — Creator TV V1

## Product boundary

Creator TV V1 is an application-level linear experience generated from a creator's eligible published MP4 library. It does not introduce HLS packaging, transcoding, live ingest, SSAI, or true FAST infrastructure.

Every registered channel continues to receive its `CreatorTvChannel` during the existing atomic registration flow. A TV exists even with zero eligible videos.

## Eligibility

A video enters the automatic rotation without manual scheduling when all of these are true:

- it belongs to the Creator TV's channel;
- `Video.status = PUBLISHED`;
- `Video.visibility = PUBLIC`;
- it is not removed;
- it has an active `SOURCE_VIDEO` asset in `UPLOADED` or `VALIDATED` state;
- the source asset MIME type is `video/mp4`;
- the creator has not explicitly excluded it from that TV;
- the platform and channel automatic-TV switches are enabled.

This means a newly published eligible MP4 is visible to the next schedule calculation immediately. Creators do not need to create schedule rows.

## Deterministic automatic schedule

The automatic schedule is computed on request rather than persisted as repeating `AUTO` rows.

Inputs:

- stable epoch: `CreatorTvChannel.createdAt`;
- current eligible library;
- creator video preferences;
- platform rotation policy;
- real video duration where available;
- configurable fallback duration when duration metadata is unavailable.

Default deterministic ordering is:

1. higher creator priority first;
2. explicit creator `sortOrder` when supplied;
3. platform fallback order (`PRIORITY_ORDER_OLDEST` by default, with a configurable newest-first alternative);
4. stable video ID tie-break.

The ordered library forms one cycle. The scheduler sums effective video durations, calculates the current cycle and offset using modulo arithmetic, then emits current and future occurrences through the rolling guide window. The library repeats as many times as required.

The platform settings controlling V1 are:

- `autoAddPublishedUploadsToCreatorTv`;
- `creatorTvFallbackProgramDurationMs`;
- `creatorTvGuideWindowMinutes`;
- `creatorTvRotationMode`.

Channel settings `autoAddPublishedToTv` and `tvAutoScheduleEnabled` remain respected.

## Zero-video / off-air behavior

A TV with no eligible video returns a normal branded TV response with `state = OFF_AIR` and `offAirReason = NO_ELIGIBLE_VIDEOS`. The public page renders the channel's name, avatar/banner/accent and explains that programming starts automatically after the first eligible publication.

Disabled, explicitly off-air, or automation-disabled TVs use the same branded surface rather than failing or pretending to have a program.

## Viewer schedule and playback

Public API:

- `GET /public/channels/:handle/tv`

The response includes:

- channel branding;
- TV state;
- `nowPlaying`;
- `upNext`;
- a rolling guide;
- start/end wall-clock times;
- the conceptual current-program playback offset;
- the ad-break extension result.

Public web page:

- `/c/:handle/tv`

It uses the existing playback-ready R2 MP4 object, native browser video controls, muted autoplay, a best-effort seek to the wall-clock offset, and schedule refresh on program completion so playback continues through scheduled content.

### V1 synchronization limitation

The schedule and conceptual offset are deterministic. Progressive MP4 playback is not a true synchronized linear transport. Browser autoplay policy, HTTP range behavior, MP4 keyframe placement, network latency, and seek precision mean V1 cannot guarantee frame-accurate mid-file synchronization across all viewers.

AYIN therefore reports `exactMidProgramSynchronization = false` and does not claim otherwise. The client performs a best-effort seek to the calculated wall-clock offset. Future HLS/FAST infrastructure can replace delivery without changing the Creator TV product model.

## Creator controls

Creator management page:

- `/channel/tv`

Creator API:

- `GET /creator/channels/:channelId/tv`
- `PUT /creator/tv/:tvChannelId/videos/:videoId`

Controls are optional. A creator can:

- include/exclude an otherwise eligible video;
- set an integer priority;
- set an optional explicit order.

No manual scheduling is required for the normal flow.

Preferences are stored in `CreatorTvVideoPreference` with one row per `(tvChannelId, videoId)`.

## Admin service hooks

`CreatorTvService` exposes server-authorized admin operations for later Admin UI use:

- enable/disable TV;
- create an `ADMIN` `TvScheduleItem` override window;
- cancel an admin override;
- set video-level preferences through the shared permission boundary.

Admin mutations are audit logged.

Automatic schedules remain computed. Existing `TvScheduleItem` is used only for explicit override/manual concepts rather than materializing infinite repeating automatic schedules.

### Schedule override overlay

Active `ADMIN` rows overlay the calculated automatic guide. Automatic segments before/after the override remain available so the linear guide can resume. Admin content must still be an eligible published public MP4 from the same channel.

## Advertising extension point

`CreatorTvAdBreakHook` is a narrow service boundary. Task 10 provides a no-op implementation returning no breaks. Future advertising work can replace it with house/direct/programmatic break decisions without rewriting the schedule engine.

Task 10 does not insert ads itself.

## Schedule recalculation behavior

V1 uses the current eligible library on each schedule request. Publishing, removing, excluding, including, or re-prioritizing a video therefore affects subsequent schedule calculations immediately. The stable TV creation epoch keeps a given library/config/time deterministic, while a deliberate library/config change produces a new deterministic rotation.
