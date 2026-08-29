# Task 11 — AYIN Player and watch progress

Task 11 introduces one reusable progressive-MP4 player for AYIN web/PWA surfaces.

## Playback architecture

- Media remains on Cloudflare R2 and is delivered through `media.ayin.stream` / `NEXT_PUBLIC_MEDIA_BASE_URL`.
- The browser receives the MP4 URL directly and uses normal HTML media loading and HTTP Range requests for seek/scrub. The API never proxies video bytes.
- `AyinPlayer` owns custom content controls for play/pause, seek, volume/mute, speed, fullscreen, PiP, captions, chapters, ten-second jumps and next/up-next.
- Task 10 Creator TV now consumes the reusable player rather than maintaining a second native-control player implementation.
- Task 05 `TvFocusScope` wraps the player control surface so remote/arrow-key focus behavior remains shared with the rest of the TV UX.

## Captions and chapters

Uploaded `MediaAsset(kind=CAPTION)` WebVTT assets are exposed as player caption tracks. The current schema does not yet persist chapter metadata, so the player accepts typed chapter cue arrays and renders/seeks them whenever a caller has chapter data; the Task 11 public playback response returns an empty chapter list until such metadata exists.

## Watch progress

Authenticated playback writes `WatchProgress` and updates `WatchHistory` through `/watch/progress/:videoId`.

- profile ownership is resolved server-side from the authenticated account;
- callers may select one of their own viewer profiles, while another account's profile is rejected;
- routine writes are throttled in the client and forced only at meaningful lifecycle points such as pause/end/page hide;
- the configured `watchProgressSaveIntervalSeconds` controls routine checkpoint frequency;
- `watchCompletionThresholdPercent` controls when progress is marked complete;
- `WatchProgress(profileId, videoId)` remains the efficient source for future Continue Watching queries.

## Resume

The player reads the current profile's saved position before playback. Tiny positions, completed videos and positions within five seconds of the known end restart from zero instead of creating a poor resume experience.

## Advertising boundary

`AyinPlayer` always exposes a dedicated ad container and accepts an external `adMode` state. When ad mode locks controls, content seeking/play controls and watch-progress writes are suspended. Task 17 can attach Google IMA to this boundary without replacing the content player architecture.

## Analytics boundary

Player events are emitted through the `AyinPlayerAnalytics` interface. Task 11 ships a no-op implementation; a later analytics/event pipeline can inject a real sink without changing player controls.

## V1 limitations

- Progressive MP4 only; no HLS/DASH/transcoding.
- PiP is used only where the browser exposes the standard Picture-in-Picture API.
- Chapter persistence/creator editing is not invented in Task 11 because the current schema has no chapter model.
