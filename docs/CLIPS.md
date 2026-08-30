# AYIN Clips

AYIN Clips is the short-form vertical video surface. It reuses the existing direct MP4/R2 upload, rights declarations, comments, reactions, subscriptions, history and moderation foundations instead of creating a second media stack.

## Product rules

- A video has an explicit `VideoForm`: `LONG_FORM` or `CLIP`.
- Clip uploads use the same creator upload endpoint and storage adapter. The creator selects `videoForm: "CLIP"`.
- The configurable declared-duration ceiling defaults to 180 seconds. No music catalog or music-license rights are assumed.
- The public `/clips` feed contains only public, published Clips with a ready MP4 on active channels.
- Autoplay is muted, only applies to the focused item, and is disabled when reduced motion is requested.
- Existing watch/comment/channel surfaces remain the source of truth for social actions and moderation.
- Clip analytics have explicit impression/play/swipe/complete/share names so they are measurable separately from long-form viewing.
- Clip ad inventory has its own enable switch and organic-item frequency. Long-form pre/mid/post policy is never inherited implicitly. The V1 feed exposes ad-opportunity boundaries only; a production ad provider is wired separately under the advertising roadmap.

## Admin controls

The existing platform settings control plane exposes `clipsEnabled`, `clipsMaxDurationMs`, `clipsAutoplayEnabled`, `clipsAdsEnabled`, and `clipsAdFrequency`.
