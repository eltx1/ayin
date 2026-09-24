# AYIN Task 78 — Samsung Tizen TV certification baseline

Task 78 hardens the existing Samsung TV package while keeping AYIN product UI, account/session, media players, advertising, Creator TV, and live-streaming logic in the shared Web application.

The Samsung-specific layer is deliberately thin:

1. a packaged local Tizen shell owns Samsung/Tizen APIs;
2. the shared AYIN Web application is rendered inside a remote iframe;
3. the local shell forwards remote, lifecycle, and network signals through a small postMessage bridge;
4. shared AYIN focus/player code remains authoritative.

This replaces the previous direct hosted-page redirect. Samsung documents that hosted applications normally require prior Content Manager approval and do not have access to Tizen APIs for security reasons. Because AYIN still renders substantial remote content, Seller Office classification must still be confirmed with Samsung before submission.

## Supported baseline

AYIN's declared minimum is **Tizen 9.0**.

| Samsung TV platform | Model year | Web engine | AYIN Task 78 status |
| --- | ---: | --- | --- |
| Tizen 10.0 | 2026 | Chromium 130 | Package baseline targeted; no Samsung emulator/real-device verification completed |
| Tizen 9.0 | 2025 | Chromium 120 | Minimum package/API baseline; no Samsung emulator/real-device verification completed |
| Tizen 8.0 and older | 2024 and older | Chromium 108 or older | Not in the supported Task 78 baseline |

The current AYIN Web stack is Next.js 16 / React 19. Task 78 intentionally avoids claiming compatibility with older Samsung Web engines that have not been exercised against the current production application.

The Tizen configuration sets both required_version=9.0 and Samsung development API metadata 9.0.

## Package and network policy

The package uses the tv-samsung profile, maximized landscape mode, background-support disabled, hardware key events enabled, and pointing-device support disabled for the remote-first baseline.

Privileges are limited to Internet and TVInputDevice. WARP access is HTTPS-only for AYIN and the Google advertising origins already used by the shared Web CSP.

A final Samsung launcher/store icon is intentionally not invented in Task 78 and remains a release prerequisite.

## Packaged shell instead of hosted redirect

The old package immediately redirected its top-level document to https://ayin.stream. Task 78 replaces that with local index.html, shell.js, shell.css, and a full-screen AYIN iframe.

The iframe loads https://ayin.stream/?platform=tizen&ayin_tizen_embed=1.

AYIN ordinary pages remain protected by CSP frame-ancestors 'none' and X-Frame-Options DENY. Only the Tizen embed marker/cookie receives a narrowly-scoped framing exception that permits local packaged ancestor schemes file: and tizen-widget:. The embedded response does not receive X-Frame-Options DENY.

The local shell has its own restrictive CSP and can frame only https://ayin.stream.

## Remote keys, focus, Back and Exit

The local package registers MediaPlayPause, MediaPlay, MediaPause, MediaRewind, and MediaFastForward. It does not register Back or Exit.

Samsung requires long-press Exit to retain platform default termination behavior. Task 78 therefore ignores Exit key code 10182.

Remote signals are forwarded to the shared AYIN runtime. Direction/select signals reuse TvFocusScope; media keys reuse the shared AYIN player controls. No Tizen-specific product focus graph or player UI is added.

Samsung Return/Exit policy is implemented as follows:

- detail route Back goes to previous AYIN history;
- home Back requests an exit confirmation from the local package;
- only Yes calls tizen.application.getCurrentApplication().exit();
- long-press Exit remains platform-owned.

## Media playback

AYIN continues to use HTML5 video and the existing adaptive playback abstraction. Samsung documents HTML5 video, HLS, MSE, H.264/AAC MP4, and external WebVTT support on the current platforms.

AYIN already prefers native HLS when canPlayType() reports support, so no Tizen-only media player is added. Task 75/76 Creator TV output uses conservative HLS v3 and does not require EXT-X-INDEPENDENT-SEGMENTS, which Samsung documents as unsupported.

Captions remain the shared WebVTT track implementation. Autoplay remains best-effort; the iframe grants autoplay and AYIN preserves user-start fallback if play() is rejected.

The packaged iframe occupies the full TV surface and grants fullscreen. Shared AYIN fullscreen controls remain authoritative.

## IMA / Google Ad Manager

AYIN retains the existing HTML5 IMA path and content-safe fallback. Google's current IMA HTML5 compatibility matrix does not list Samsung Tizen TV as an officially supported platform, so Task 78 does not claim official client-side IMA support on Samsung TV.

Real IMA/GAM ad rendering, skip focus, consent, no-fill, error recovery, and measurement require physical Samsung TV validation. Creator TV may use Task 76 server-side Google DAI when configured because the stitched output is ordinary HLS from the player's perspective.

## Lifecycle, memory and network

Samsung requires visibilitychange handling. The local shell forwards pause/resume lifecycle state to the shared runtime. The shared runtime pauses media that was playing and restores only that media when visible again.

AYIN player teardown follows the Samsung-recommended HTML5 decoder cleanup sequence: pause, remove src, then load().

The local shell forwards browser online/offline state into the existing AYIN network path. Real cable/Wi-Fi loss and resume behavior remain physical-TV acceptance items.

## Login and session

Login/session remains AYIN's existing HTTPS cookie/session implementation inside the AYIN iframe. A Secure SameSite=None marker cookie is used only to preserve the Tizen framing policy across full document navigations.

Actual session persistence across TV suspend/reboot/uninstall remains a real-device validation item. Samsung also requires login data to be gone after uninstall.

## Validation matrix

| Stage | Environment | Task 78 status |
| --- | --- | --- |
| Static package/config validation | GitHub CI | **Pending current PR CI** |
| Packaged shell adapter simulation | Node sandbox in GitHub CI | **Pending current PR CI** |
| Shared Web unit/integration/browser tests | repository quality/browser CI | **Pending current PR CI** |
| Samsung TV Simulator | Samsung TV Simulator | **Not verified** |
| Samsung TV Emulator | Tizen 9/10 emulator | **Not verified** |
| Real Samsung TV | Tizen 9.0 retail hardware | **Not verified — no hardware attached** |
| Real Samsung TV | Tizen 10.0 retail hardware | **Not verified — no hardware attached** |
| Seller Office submitted | Samsung Seller Office | **No** |
| Store approved | Samsung Seller Office | **No** |

Samsung notes that remote-source iframe behavior on the emulator can differ from a TV. An emulator pass would therefore not replace real-device testing for this architecture.

## Why no emulator claim in CI

Samsung TV Extension 7.0.1+ requires a Samsung certificate even for emulator installation. The repository intentionally contains no Samsung signing certificate/profile or password. CI creates only an unsigned payload archive for structural inspection; it is not represented as an installable or store-ready WGT.

## Required real-device acceptance

Before changing any status to real-device verified, run on representative Tizen 9.0 and Tizen 10.0 TVs:

- cold launch and relaunch;
- login/logout/session persistence;
- D-pad traversal and visible focus;
- Enter/select;
- Back from details and exit confirmation from home;
- long-press Exit default behavior;
- media Play/Pause/Rewind/Fast-Forward;
- HLS VOD and MP4 fallback;
- Creator TV HLS/DAI where configured;
- live HLS/reconnect;
- WebVTT captions;
- autoplay and user-start fallback;
- fullscreen enter/exit;
- IMA/GAM content-safe failure path and ad behavior if monetization is enabled;
- suspend/resume via Smart Hub/input switch;
- low-memory/background recovery;
- network disconnect/reconnect;
- HTTPS/certificate failure behavior.

## Official references used

- https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html
- https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/retrieving-platform-information.html
- https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html
- https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-video-elements.html
- https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html
- https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html
- https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-emulator/application-install-policy.html
- https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/compatibility
