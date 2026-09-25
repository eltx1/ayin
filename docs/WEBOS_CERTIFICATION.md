# AYIN Task 79 — LG webOS TV hardening and certification status

Task 79 hardens AYIN's existing LG hosted Web app while keeping the product UI, player, Creator TV and live business logic shared with the Web product.

## Official baseline

AYIN declares **webOS TV 25 and webOS TV 26** as its current zero-configuration webOS baseline.

LG currently documents these Web engines:

- webOS TV 26 (2026): Chromium 132
- webOS TV 25 (2025): Chromium 120
- webOS TV 24 (2024): Chromium 108

AYIN currently uses Next.js 16, whose documented zero-configuration browser baseline is Chrome 111+. For that reason Task 79 does **not** claim webOS TV 24 or older without a future explicit compatibility/polyfill program.

Sources:

- https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine
- https://nextjs.org/docs/app/guides/upgrading/version-16

## Package architecture and appinfo.json

AYIN remains an LG **hosted web app**. The installable package contains only the LG metadata, icons and local startup bootstrap. The bootstrap navigates the top-level app to:

`https://ayin.stream/?platform=webos&hosted=1`

This follows LG's hosted-app architecture rather than introducing a webOS-specific AYIN UI fork.

`appinfo.json` keeps the required `id`, `title`, `type`, `main`, `icon` and `version` fields, plus the required package icons. The small icon is 80×80 PNG and the large icon is 130×130 PNG. AYIN declares 1920×1080 graphics resolution.

`requiredMemory` is intentionally not set. LG defines that field as a **minimum memory requirement**, not a memory budget or cap; inventing a value would not prove memory fitness.

Sources:

- https://webostv.developer.lge.com/develop/getting-started/web-app-types
- https://webostv.developer.lge.com/develop/references/appinfo-json
- https://webostv.developer.lge.com/develop/getting-started/app-resources

## Remote input and focus

The shared AYIN TV runtime consumes the LG remote keyboard codes documented by LG:

- D-pad: 37/38/39/40
- OK: 13
- Back: 461
- Play: 415
- Pause: 19
- Fast-forward: 417
- Rewind: 412

Media Stop (413) is intentionally not mapped to Pause.

The runtime translates those events into AYIN's existing `ayin:native-remote` contract. Focus remains handled by the shared `TvFocusScope`; Task 79 adds no webOS-specific product focus implementation.

Source:

- https://webostv.developer.lge.com/develop/guides/magic-remote

## Back and exit behavior

`disableBackHistoryAPI` is set to `true` so AYIN owns Back behavior consistently:

1. If video is fullscreen, Back exits fullscreen.
2. On a non-home AYIN route, Back navigates to the previous route.
3. On the AYIN home route, Back opens the shared TV exit confirmation.
4. Confirming exit on webOS calls `window.close()`.

LG explicitly documents `window.close()` for apps that provide their own exit popup.

Source:

- https://webostv.developer.lge.com/develop/guides/back-button

## Lifecycle

`handlesRelaunch` remains `false`, allowing the platform to foreground AYIN automatically. The shared TV bridge listens for `webOSLaunch`, `webOSRelaunch`, `visibilitychange` and `pagehide`, maps them onto AYIN's shared lifecycle contract, pauses active media while suspended and resumes media that was playing when foregrounded.

Source:

- https://webostv.developer.lge.com/develop/guides/app-lifecycle-management

## Media, HLS, captions, autoplay and fullscreen

LG documents HLS support on physical webOS TVs and MSE support on current webOS TV releases. AYIN keeps its shared adaptive playback path:

- native HLS when the TV advertises it;
- shared hls.js/MSE fallback when needed;
- bounded VOD/live buffers and bounded live reconnect retries;
- MP4 fallback behavior owned by the shared player;
- shared WebVTT `<track>` captions;
- shared autoplay-blocked UI instead of assuming `play()` always succeeds;
- shared Fullscreen API path and Back-to-exit-fullscreen behavior.

LG documents WebVTT support on webOS TV 26 on device, Simulator and Emulator. HLS/DRM capabilities still require physical-device acceptance for the exact production encoding/DRM combination.

Sources:

- https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm
- https://webostv.developer.lge.com/develop/specifications/video-audio-260

## Memory behavior

Task 79 does not invent a webOS memory quota. AYIN instead keeps bounded HLS buffers, pauses media on suspension, destroys HLS sessions on teardown and explicitly releases HTML media resources by pausing, removing the source and reloading the element.

Final memory acceptance must be measured on physical LG hardware with LG Resource Monitor or `ares-device --resource-monitor`.

Sources:

- https://webostv.developer.lge.com/develop/tools/resource-monitor-introduction
- https://webostv.developer.lge.com/develop/tools/cli-dev-guide

## Network reconnect

The local hosted bootstrap does not navigate away while `navigator.onLine === false`; it waits for a one-shot `online` recovery before opening hosted AYIN.

Inside the hosted product, AYIN already uses the shared browser `online`/`offline` path and the live player reconnect state machine. Task 79 does not add a permanent Luna Connection Manager dependency because standard Web connectivity events are enough for this product path. Device verification remains required because network transition behavior is hardware/runtime dependent.

LG also exposes Connection Manager for explicit native connection status when a future requirement needs it:
- https://webostv.developer.lge.com/develop/references/connection-manager

## Ads / IMA / GAM

Task 79 does not create a webOS-specific advertising fork. AYIN retains the shared HTML5 ad container and playback integration.

Google's IMA HTML5 release notes include smart-TV/WebOS fixes, but Google's additional-platform guidance says LG TV support is model-dependent and directs developers to their Google account representative. Therefore Task 79 **does not claim IMA/GAM device certification** until it is validated on the target LG hardware and confirmed for the applicable Google account/integration.

Sources:

- https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/release-notes
- https://developers.google.com/interactive-media-ads/docs/sdks/other

## Creator TV and live

Creator TV and live remain shared product features. Task 79 only feeds LG remote, lifecycle and network signals into the existing runtime. Live HLS keeps the shared live-edge, DVR, captions, ad container and bounded reconnect behavior.

## Test / certification matrix

Repository checks and LG hardware/store certification are deliberately separate.

- Repository manifest/bootstrap/unit validation — GitHub Actions — required before merge; not hardware certification.
- Official LG CLI IPK packaging — `@webos-tools/cli` / `ares-package` — required before merge; not device certification.
- webOS TV 25 Simulator — Simulator 1.4.4 — **NOT VERIFIED**.
- webOS TV 26 Simulator — Simulator 1.5.0 — **NOT VERIFIED**.
- Current-version Emulator — not provided by LG from webOS TV 22 onward — **NOT AVAILABLE / NOT CLAIMED**.
- Legacy Emulator ≤ webOS TV 6.0 — deprecated — **NOT VERIFIED** and outside AYIN baseline.
- Physical webOS TV 25 — real TV — **NOT VERIFIED**.
- Physical webOS TV 26 — real TV — **NOT VERIFIED**.
- LG Seller Lounge submitted — **NO**.
- LG store approved — **NO**.

LG's current Simulator downloads list 1.4.4 for TV 25 and 1.5.0 for TV 26. LG documents that Emulator is no longer provided from webOS TV 22 onward.

Sources:

- https://webostv.developer.lge.com/develop/tools/simulator-installation
- https://webostv.developer.lge.com/develop/tools/emulator-dev-guide
- https://webostv.developer.lge.com/develop/tools/cli-introduction

No statement in this document implies Seller Lounge submission or LG store approval.
