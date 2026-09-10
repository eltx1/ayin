# Captions + Chapters v1

Task 52 adds creator-managed WebVTT captions/subtitles and chapter navigation to AYIN's existing playback stack.

## Caption lifecycle

Caption bodies are never stored in the primary database. The API creates an internal `MediaAsset(kind=CAPTION)` and a short-lived direct-to-media-storage `text/vtt` upload URL. Finalization verifies object size, MIME type, UTF-8, WebVTT structure, cue ordering, and known video duration before the track becomes playable. Invalid replacement uploads are rejected without replacing the currently validated asset.

A track has a canonical BCP 47 language, optional creator label (falling back to the canonical language code), `CAPTIONS` or `SUBTITLES` kind, enabled/default state, and deterministic creation-order playback. `(video, language, kind)` is unique and only one track can be default per video. Creator ownership is resolved from the authenticated account's channel membership; clients cannot supply an ownership account ID.

## Chapters

Chapters reuse Task 51 `VideoCreatorMetadata.chapters`. They remain optional and are validated as strictly increasing, non-negative integer start times inside known video duration. The public playback contract converts them to stable player chapter IDs and milliseconds. No second chapter schema is introduced.

## Web + TV player

AYIN uses the same `AyinPlayer` for browser and TV/remote-focus playback. Caption and chapter selectors participate in `TvFocusScope`, while existing HLS-to-MP4 fallback, IMA ad lock behavior, progress persistence, keyboard shortcuts, fullscreen and accessibility labels remain intact. `C` toggles the selected/default timed-text track. Chapter selection seeks through the normal guarded seek path.

## Analytics and privacy

User-driven caption changes emit `VIDEO_CAPTION_CHANGE`; chapter navigation emits `VIDEO_CHAPTER_SEEK` in addition to the existing generic seek event. Caption analytics contain only track ID, canonical language, kind and playback protocol. Chapter analytics contain only chapter ID/start position and protocol. Cue text, caption labels, object keys/URLs and file contents are never sent as analytics metadata. Existing ad-mode analytics suppression remains unchanged.

## Rollback

The feature is additive. Removing caption rows/assets leaves video media and Task 51 metadata untouched. Existing videos with no caption tracks or chapters preserve their previous playback response and controls.
