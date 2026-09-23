# AYIN Task 78 — Samsung Tizen certification baseline

Task 78 hardens the existing Samsung TV Web Application package without forking AYIN product UI or media business logic.

## Declared runtime support

AYIN currently uses Next.js 16.3.3. Next.js 16 supports Chrome 111+ without a custom browser target. Samsung's current TV Web engines are:

| Model year | Tizen | Samsung Web engine | AYIN package status |
| --- | --- | --- | --- |
| 2026 | 10.0 | Chromium M130 | declared compatible baseline |
| 2025 | 9.0 | Chromium M120 | declared compatible baseline |
| 2024 | 8.0 | Chromium M108 | not declared; below Next.js 16 default Chrome baseline |
| 2023 and older | 7.0 and older | Chromium M94 and older | not declared |

`config.xml` therefore uses `required_version="9.0"`. This is a compatibility floor, not a claim that every 2025/2026 retail model has been device-certified.

## Package configuration

`platforms/tizen/config.xml` now defines:

- Samsung TV profile;
- packaged `index.html` entrypoint;
- package icon;
- 1920x1080 screen-size feature;
- Tizen 9.0 minimum;
- internet privilege;
- TV input-device privilege;
- Samsung `adinfo` privilege because AYIN has in-app advertising;
- HTTPS-only AYIN web/API/media origins;
- the current Google IMA/GAM network origins used by the shared web application;
- disabled pointing-device support for remote-first TV UX;
- landscape/maximized application mode.

AYIN does not request `drmplay`, TV audio, TV window, microphone, billing, SSO, or other privileges that the current shared HTML5 media path does not use.

## Hosted-app boundary

The current Tizen package is a hosted-app launcher: packaged local code opens `https://ayin.stream/?platform=tizen`.

Samsung documents two important limits:

1. hosted/cloud TV applications require advance approval from the Samsung Content Manager / partner group;
2. Tizen APIs are not available inside the hosted page.

Task 78 does not hide those limits.

The packaged local bootstrap registers optional playback remote keys before navigating to AYIN. Arrow/D-pad, Enter and Back do not require explicit registration. The hosted AYIN runtime also detects `?platform=tizen`, so focus, Back policy and shared TV behavior remain active even when the `window.tizen` object is no longer exposed.

APIs that require a continuing local Tizen context—most importantly `tizen.application.exit()` and runtime `webapis.adinfo`/TIFA access—remain certification blockers for this hosted architecture until Samsung approves an acceptable integration architecture. Task 78 does not fabricate TIFA or claim Seller Office readiness around it.

## Remote keys and focus

The local bootstrap registers MediaPlayPause, MediaPlay, MediaPause, MediaRewind and MediaFastForward. The shared `tv-platform-runtime` normalizes Samsung remote key codes into AYIN's existing `ayin:native-remote` contract.

D-pad focus remains the shared `TvFocusScope` / `@ayin/ui` implementation. No Tizen-specific navigation tree was introduced.

## Return / Back / Exit

Samsung policy requires Return to navigate back from detail pages and to present exit confirmation from the app home screen.

Task 78 implements that policy in the shared TV adapter:

- fullscreen exits first;
- when there is in-app history, Return calls browser history back;
- at app root, the shared TV exit confirmation dialog is shown;
- if the local Tizen Application API is available, confirming exit calls `tizen.application.getCurrentApplication().exit()`;
- in the hosted page, where Samsung does not expose that API, the dialog explicitly instructs the user to long-press Return/Exit.

The final hosted-app Seller Office path therefore still needs Samsung confirmation for compliant one-click Return exit from the hosted root. Long-press Exit remains the platform force-exit behavior and is not registered or overridden.

## HTTPS / network

The manifest allows only HTTPS origins used by AYIN and its current IMA/GAM integration. Cleartext `http://` access origins are rejected by repository validation.

Any additional external VAST/advertising/CDN origin added later must be explicitly reviewed and added to the package policy. Samsung states that hosted applications loading external scripts require Content Manager permission.

## HLS and HTML5 media

AYIN continues to use the shared HTML5 `<video>` / hls.js / native-HLS decision path. Task 78 does not add AVPlay or a Tizen media fork.

Samsung documents HTML5 video and MSE support on Tizen 9/10. HLS is supported, but tag support is version-specific. Samsung currently documents `EXT-X-INDEPENDENT-SEGMENTS` as unsupported, so provider manifests must be tested before physical release.

Creator TV's Task 75/76 owned linear profile deliberately does not require that tag. Other provider HLS manifests, especially live output, still require actual Tizen validation.

## MP4 fallback

Progressive MP4 remains AYIN's shared content-safe fallback for VOD/Creator TV where already implemented. No Tizen-only MP4 fallback logic was added.

## Captions

AYIN keeps the shared HTML5 text-track caption path. Samsung recommends out-of-band WebVTT for HLS. Actual font rendering, language switching and accessibility presentation still require emulator/device acceptance.

## Autoplay

Samsung documents HTML5 `autoplay` and `loop` support. AYIN still treats autoplay as best-effort: failure to autoplay does not block content and the existing shared play control remains available.

## Fullscreen

Samsung Tizen 9/10 support the Web Fullscreen API. AYIN keeps its shared fullscreen implementation; no AVPlay display-area fork was introduced.

## IMA / GAM

The package declares Samsung's public `adinfo` privilege because AYIN has in-app advertising.

However:

- the current hosted page cannot use Samsung Tizen APIs, including `webapis.adinfo`;
- Samsung explicitly states third-party ad-serving platforms are not guaranteed and are supported by the third-party provider, not Samsung;
- Task 78 does not invent a mapping from Samsung TIFA to Google IMA/GAM request parameters;
- shared client-side IMA and Task 76 DAI logic remain unchanged.

Real Google IMA rendering, consent, skip focus, no-fill/error recovery, TIFA policy and GAM monetization must be tested on Samsung TV hardware before store submission.

## Memory and lifecycle

Samsung requires correct multitasking behavior and recommends releasing heavy media resources when backgrounded.

AYIN uses the shared visibility lifecycle: `visibilitychange` emits pause/resume lifecycle, media that was playing is paused in the background, only previously playing media is resumed, and shared player teardown releases its playback sessions on unmount.

No Tizen-only product state store or player lifecycle fork was introduced. Physical low-memory termination/relaunch remains a hardware acceptance case.

## Creator TV and live

Creator TV continues through the shared Creator TV implementation and Task 75/76 linear/DAI paths. Live continues through `LiveAyinPlayer` and the Task 74 retry/backoff logic.

Because Samsung HLS support is tag- and model-dependent, Creator TV/live are package/shared-runtime validated only, not emulator/device verified in Task 78.

## Verification matrix

| Stage | Target | Status | Evidence |
| --- | --- | --- | --- |
| Repository/package validation | Tizen 9.0+ config/bootstrap | VERIFIED | CI structural validation + shared unit/type/build gates |
| Samsung TV Simulator | current simulator | NOT VERIFIED | Simulator does not support hosted apps or real HLS; not accepted as certification evidence |
| Samsung TV Emulator | TV Extension 10.0 / Tizen 10.0 | NOT VERIFIED | Samsung states emulator cannot run inside nested virtualization; no dedicated emulator host is connected to this session |
| Real Samsung TV | Tizen 9.0 (2025) | NOT VERIFIED | no hardware connected |
| Real Samsung TV | Tizen 10.0 (2026) | NOT VERIFIED | no hardware connected |
| Seller Office submitted | Samsung TV Seller Office | NO | Task 78 does not submit stores |
| Seller Office approved | Samsung TV Seller Office | NO | no submission was made |

## Emulator / real-device acceptance checklist

When a Samsung emulator host or retail TV is available, record exact model, firmware and Tizen version and validate install/launch and signed `.wgt`, login/logout/session, D-pad traversal and visible focus, media playback keys, Return/back and root exit confirmation, fullscreen enter/exit, VOD HLS and MP4 fallback, HLS manifest compatibility, WebVTT captions, autoplay, IMA/GAM rendering and error fallback, Creator TV linear playback, live playback/reconnect, background/resume, low-memory relaunch, network loss/recovery, and power-off/on during loading and playback.

## Store prerequisites

Before Seller Office submission:

- obtain Samsung Content Manager approval for the hosted-app architecture;
- create Samsung/Tizen author and distributor certificate profiles outside git;
- package/sign the `.wgt` with current TV Extension;
- prepare Seller Office 1920x1080 and 512x423 icon assets plus at least four 1920x1080 screenshots;
- finalize application description/test instructions;
- confirm target model groups and countries;
- complete in-app advertising/TIFA declarations;
- complete privacy/data declarations;
- execute emulator and representative real-TV acceptance;
- preserve the existing Tizen application/package IDs for updates.

No certificates, store credentials, signing keys or store submissions are created by Task 78.

## Official references

- Samsung General Specifications: https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html
- Samsung Web Engine Specifications: https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- TV Extension 10 release history: https://developer.samsung.com/smarttv/develop/tools/tv-extension/release-history.html
- Configuring Web Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html
- Remote Control: https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
- Terminating Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html
- Multitasking: https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html
- Hosted Applications Q&A: https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html
- Media specifications: https://developer.samsung.com/smarttv/develop/specifications/media-specifications.html
- Multimedia Q&A: https://developer.samsung.com/smarttv/develop/faq/multimedia.html
- Web app memory optimization: https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html
- Samsung third-party features Q&A: https://developer.samsung.com/smarttv/develop/faq/third-party-features.html
- Seller Office launch checklist: https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html