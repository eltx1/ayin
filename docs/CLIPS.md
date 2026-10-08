# AYIN Clips

AYIN Clips is the short-form vertical video surface. It reuses the existing direct MP4/R2 upload, rights declarations, comments, reactions, subscriptions, history and moderation foundations instead of creating a second media stack.

## Product rules

- A video has an explicit `VideoForm`: `LONG_FORM` or `CLIP`.
- Clip uploads use the same creator upload endpoint and storage adapter. The creator selects `videoForm: "CLIP"`.
- The configurable declared-duration ceiling defaults to 180 seconds. No music catalog or music-license rights are assumed.
- The public `/clips` feed contains only public, published Clips with a ready MP4 on active channels and applies trusted-region VideoPolicy before pagination. Browser-supplied country headers are not trusted.
- Autoplay is muted, only applies to the focused item, and is disabled when reduced motion is requested.
- Existing watch/channel/social APIs remain authoritative. Viewer Like/Subscribe state is read from the server; an unconfirmed mutation is never replayed automatically and requires an explicit read refresh before another write. The Clips feed does not expose a fake comments link when no public comment-list read surface exists.
- Clip analytics have explicit impression/play/swipe/complete/share names so they are measurable separately from long-form viewing.
- Clip ad inventory has its own enable switch and organic-item frequency. Long-form pre/mid/post policy is never inherited implicitly. The V1 feed exposes ad-opportunity boundaries only; a production ad provider is wired separately under the advertising roadmap.

## Admin controls

The existing platform settings control plane exposes `clipsEnabled`, `clipsMaxDurationMs`, `clipsAutoplayEnabled`, `clipsAdsEnabled`, and `clipsAdFrequency`.

## Bounded Web/PWA viewing stage

The dedicated Clips experience reuses the Viewer audience lease and the existing
`useWatchProgress` revision/seek/checkpoint contract. It does not change creator
upload, canonical MP4 transport, trusted-region/Kids policy, monetization or providers.

### Viewing and input contract

- The feed measures its actual route start and the existing shell/navigation/feedback
  rectangles. It no longer subtracts a fixed header allowance from `100dvh`.
  On Clips, language selection moves into the existing navigation menu; other
  Viewer routes retain their language row. Announcements and exits remain visible.
- Native vertical snap selects a card only after it owns at least 70% of the feed.
  Previous/Next and focused-article arrow keys provide non-swipe alternatives. Timeline
  keys and dialog scrolling remain owned by their controls. The feed does not hijack
  browser edge Back, horizontal seeking or pinch zoom.
- Default media remains uncropped `contain`. An opaque control/metadata zone keeps text
  readable over both light and dark footage. Long titles/descriptions have a full Details
  sheet rather than covering the video. At extreme short height/text enlargement, the
  stage retains a minimum usable height and ordinary document scrolling. Short
  landscape uses a two-column media/details layout instead of a squeezed phone stack.
- Authored controls expose actual media-event state, play/pause, mute, elapsed/duration,
  native-range seeking and fullscreen. A visible native-controls fallback remains
  available. Failed playback and rejected autoplay offer explicit recovery; there is
  no automatic next-video progression.
- Opening any native dialog pauses Clips. The Details sheet follows the shared native
  dialog history contract: it creates no history entry; Close/Escape restores focus;
  browser Back follows ordinary route history. Closing resumes only a previously playing
  Clip when current audience, viewport, autoplay and reduced-motion policy still permit it.
  Explicitly paused playback remains paused.

### Resource and lifecycle contract

- Only the selected Clip has a media element/source. At most three lightweight articles
  (previous, current, next) are mounted. Adjacent posters are not speculative video.
- There is no next-video prefetch. Optional Save-Data/very-slow-network hints and the
  explicit data-saving control additionally disable automatic active-video loading/play
  until the viewer presses Play. Unsupported Network Information APIs are not treated
  as a diagnosis of the user's network.
- Retained metadata, progress/preferences and impression IDs are bounded to a 120-item
  session. At the boundary, an explicit fresh-feed action is shown; loaded items are
  not silently evicted while the viewer is navigating backward. A 20,000-character
  description ceiling and existing bounded page/response reads bound item payloads.
- Playback intent is generation-fenced. Selection checkpoints the current authorized
  position through the existing hook before retiring/releasing that element. Deferred
  play resolutions and callbacks from retired items cannot acquire playback/progress
  authority. Playing time updates use the existing 15-second checkpoint guard.
  Completed Clips retain an explicit ended marker: a new selection replays from zero;
  same-owner lifecycle return stays paused until Replay or a deliberate seek. Decoder
  remounts do not manufacture another completion from the final fraction of a second.
- The Viewer lifecycle remains the single suspension owner. The parent snapshots
  authoritative positions/intent before synchronous source release. Identity changes
  conceal content/actions immediately. Same-owner return revalidates loaded pages and
  prunes retained state to fresh eligible IDs before restoration.
- A single bounded, in-memory return capsule preserves selected Clip and positions on
  creator-route Back. It never enters share URLs, local/session storage or service-worker
  caches. No new background audio capability or private/offline media cache is added.

### Real capabilities and fallbacks

Only the active eligible feed item may request existing `readPlayback` capabilities.
The result must match the selected video ID, slug, canonical MP4 key and Kids audience.
Reads are bounded and have a 15-second deadline including the response body. Failure
has an explicit retry and Watch fallback. A server-classified account/profile failure
invalidates the existing Viewer lease immediately; automatic optional-capability reads
stay blocked for that owner until explicit retry, preventing a revalidation loop.
Ordinary unplayable/contract failures do not manufacture identity changes. There is no
offscreen detail-read fan-out.

Verified same-origin VTT tracks can use the caption selector; native cue errors and
unsupported cross-origin tracks are reported honestly with a Watch fallback. This stage
makes no media CORS, CSP or provider change. Track/option DOM is capped at 32; an oversized
capability collection becomes unavailable rather than a silently truncated language list.

Comments continue through the real localized Watch destination, respecting its enabled
slot and current policy. The existing Watch CommentsPanel is not embedded because it
requires a dedicated audience/account-scoped lifecycle adapter before inline Clips reuse.
There are no fabricated comment counts or endpoints. Share uses the localized Watch URL
and preserves explicit Kids mode. Native cancellation is neutral; clipboard failure is
recoverable feedback. A completed native share sheet is not proof of recipient delivery.

The public Watch response still has no `videoForm`, so it cannot prove Clip membership
for a direct Clip-context lookup. This stage retains Watch share/deep-link fallback and
never injects a raw media URL or searches an unbounded feed to manufacture membership.

### Acceptance boundary

Automated decoded-media, ownership, resource, navigation and PWA evidence is distinct
from physical iPhone/Android installed-PWA, safe-area/keyboard, VoiceOver/TalkBack,
Bluetooth/audio interruption, device heat/battery, production codec/provider and store
acceptance. No competitive-superiority or field-performance claim follows from this UI
stage. See the stage-specific evidence record for measured results and remaining gates.
