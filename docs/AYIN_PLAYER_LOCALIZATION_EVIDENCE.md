# AYIN player localization and media feedback

## Scope

The shared Web/PWA VOD player now renders its controls, tooltips, accessible names,
ad fallback badge, playback error, and autoplay gesture prompts in English or
Arabic through the existing locale provider and a typed player message catalog.
Watch and Creator TV continue to use the same player. Auth's shared translator,
Watch catalog context, API contracts, player progress ownership, ad cancellation,
native shell bridges, and SDK selection are unchanged by this slice.

Authored video, next-video, chapter, and caption names remain unchanged and use
automatic text direction. Adaptive rendition labels remain source metadata.
Media times and visible speed numbers use locale-aware formatting; range values,
seek offsets, caption IDs, quality IDs, playback rates, and analytics remain
locale-neutral. The timeline, volume, time display, and transport order remain
left-to-right, including Arabic keyboard seek direction. Play/pause icon styling
uses a class instead of an English accessible name.

At narrow widths the transport controls wrap beneath the video instead of hiding
their trailing buttons or covering stage actions. On desktop, transparent control
padding passes pointer events through to stage actions while the actual transport
controls remain interactive. Focused autoplay overlays retain absolute positioning
and their overlay level despite the shared TV focus rule. While a native caption
track is selected, desktop transport also moves below media so paused/focused
controls cannot dim or cover native cues. The native cue palette is white over
88%-black; timing, authored line/position and the browser caption renderer remain
unchanged. A fatal source message
occupies its own row beneath the media controls.
The ad wrapper observes the current native media error and suppresses its
autoplay-policy CTA while a source is broken. A new load or successful canplay
clears that presentation state, retaining the native retry/fallback path. A native
error already present before hydration is displayed without reloading the source
or repeating error telemetry.

## Local acceptance recipe

Use an isolated migrated and seeded TEST_DATABASE_URL, the repository's pinned
Node/pnpm dependencies, Playwright Chromium, and FFmpeg with libx264 and libvpx-vp9.

1. Build packages and API using the normal repository commands.
2. Build the web app with NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001 and
   NEXT_PUBLIC_MEDIA_BASE_URL=http://127.0.0.1:3000.
3. Run pnpm exec playwright test --config playwright.player-localization.config.ts.

The suite creates one owned synthetic video and channel, plus caption/chapter
metadata. It serves the existing Clips VP8 fixture through test-only range routes
and generates two temporary VP9/fMP4 HLS variants plus two H.264/TS variants with
FFmpeg. HLS quality/AUTO and fallback tests use the bundled hls.js and actual
Chromium decoding. The manual quality test requires a decoded 320-pixel frame
after switching and preserves the same media owner and playback position. Each
codec suite checks MediaSource support; unsupported codec cases explicitly skip.
Cleanup
removes only the owned fixture and restores the isolated database's previous HLS
flag enabled/rollout values. Temporary HLS files are removed after the suite.

The reused source is tests/e2e/fixtures/clips-viewport.webm, SHA-256
0d329659ec017e0ea1c4ecadcaa26dc1b74a8bdbf8b5bfc5f99866b9761fca5f.
No customer or provider media is used. Same-origin media is intentional so native
text-track decoding is tested independently of external media/CDN CORS setup.

The EN/AR by 390/1440 viewport cases use native media methods without replacing
their implementations. Only the separately named autoplay-policy cases inject
two NotAllowedError play rejections, then delegate the user retry to the browser's
real play method and require decoded frames.

## Validation record

- Focused locale/SSR, adaptive-playback, progress, consent, advertising lifecycle
  and Creator TV tests: 78 passed.
- Own frozen dependency install: passed; source-map-js 1.2.2 and mysql2 3.23.1
  resolved from this worktree, with the lockfile unchanged.
- Packages/Prisma generation, API build, full Web lint/type checking and production
  build: passed. Full Web unit suite: 816 passed across 121 files.
- Watch browser matrix: 12 passed, 2 explicitly skipped for unsupported AVC.
  VP9/fMP4 HLS selection/AUTO, native VP8 playback, caption decoding, keyboard and
  pointer controls, fullscreen, error/reload and failed-HLS fallback passed in
  EN/AR. Only autoplay-policy rejection is injected in its named cases.
- Combined consent browser replay: 4 passed, including revoked GPT/IMA/DAI/house
  work and preserved content ownership.
- Final focus/caption replay passed on the completed source: 12 player cases
  passed, 2 AVC cases explicitly skipped, and all 4 consent cases passed again.
  Focused autoplay CTA bounds stay inside the stage and pointer hit testing passes.
- Paused/focused EN, AR and JA cues passed in both UI locales at 1440 × 1100.
  Native cue text, 0–30 second timing, authored line 90%, position 50% and center
  alignment remained exact. Transport and media bounds are disjoint, and the cue
  anchor has no page overlay. The declared native cue palette gives 16.56:1
  worst-case contrast over white video (threshold: 4.5:1); this is a palette
  calculation, not a claim of per-pixel measurement.
- Sixteen original PNGs were reviewed, with 18 native-state/contrast JSON
  attachments. Desktop captures use a viewport that contains the whole player and
  reset page scroll so sticky site chrome does not obscure the review image.
- All task-owned PG, API, Web and browser processes exited. No owned postmaster
  PID remained; ports 3000, 3001, 55669, 3197 and 3199 were verified closed.
- No production configuration or publication step was performed.

## Limits

This verifies shared Web/PWA behavior. It does not certify physical phones/TVs,
native shell packaging, live advertising providers, external media CORS, audio
device output, AVC/H.264 decoding in this installed Chromium, or browser-owned
media/menu labels. Those labels belong to the
browser/device locale, not AYIN's message catalog. The codec capability probe
reported false MediaSource support for AVC baseline and true for VP9/AV1; a VP9
fMP4 probe decoded frames without HLS errors. No production codec was changed.
No production configuration,
provider access, credentials, CSP, or deployment changes are part of this slice.

## Release integration

The owning browser workflow now runs the dedicated player suite after building with its same-origin media URL, and retains focused PNG/JSON evidence separately. The integration also restricts its database to loopback `ayin_e2e` and uses Playwright `contextOptions.reducedMotion`, with an actual `matchMedia` assertion. Earlier local playback counts remain evidence for the product source; the exact release CI validates these additional harness corrections.
