# AYIN Task 78 — Samsung Tizen certification baseline

Task 78 hardens the existing Samsung TV package without forking AYIN product UI, authentication, media, ads, Creator TV, or live business logic.

## Package architecture

The checked-in Samsung package remains a **hosted Tizen Web application**:

- local `platforms/tizen/index.html` starts the package;
- local `bootstrap.js` opens `https://ayin.stream/?platform=tizen&runtime=hosted`;
- AYIN product UI and media logic remain the canonical shared web application.

Samsung's current Hosted Applications guidance states that hosted applications generally require advance Content Manager approval and that Tizen APIs are not supported inside hosted content. Task 78 therefore does not claim `TVInputDevice`, `Application`, `AppCommon`, AVPlay, TIFA/adinfo, or other Product APIs inside the hosted AYIN page.

## Declared Tizen range

The package keeps `required_version="9.0"`.

Samsung's current TV generation table maps:

| Model year | Tizen                |
| ---------- | -------------------- |
| 2025       | 9.0 / Chromium M120  |
| 2026       | 10.0 / Chromium M130 |

This floor is deliberate: AYIN currently uses Next.js 16, whose zero-configuration browser baseline is Chrome 111+, while Samsung documents Tizen 8.0 (2024) as Chromium M108, Tizen 9.0 (2025) as M120, and Tizen 10.0 (2026) as M130. Tizen 9.0+ is therefore the declared browser-compatible range. It is still not a verified retail-device claim; exact model/firmware compatibility remains unverified until emulator/device testing is completed.

## Package configuration

Repository validation requires:

- `tv-samsung` profile;
- semantic widget version;
- local `index.html` entrypoint;
- packaged PNG icon;
- 1920×1080 TV feature;
- Tizen 9.0 minimum plus matching Samsung development API metadata;
- landscape/maximized mode;
- pointing device disabled for remote-first UX;
- Internet privilege;
- HTTPS-only AYIN web/API/media origins plus the Google IMA/GAM HTTPS origins used by the shared ad runtime.

The hosted package intentionally does not request `tv.inputdevice`, `adinfo`, DRM, TV window/audio, microphone, billing, SSO, or other privileges the hosted content cannot legitimately use.

The checked-in development package identity is `AYINtv2026.AYIN` with package ID `AYINtv2026`, satisfying Tizen's 10-character package-ID shape. It is **not** marked as the final Seller Office identity. Before signing or registration, Tizen Studio/Samsung must confirm or generate the final unique identity; once an application is published, its Tizen ID must remain stable.

## HTTPS and network

The local bootstrap contains no inline script and navigates only to the canonical HTTPS AYIN origin.

If the package starts offline, it displays a reconnect message and navigates after the browser reports online.

Repository CI executes the packaged bootstrap in both online and offline states: offline must remain on the local shell and show reconnect status, while the online event must navigate only to the canonical hosted Tizen URL.

The shared Tizen adapter also presents an in-app network-loss notification for the hosted `?platform=tizen` runtime.

### Hosted CSP submission blocker

Samsung's hosted-application guidance says hosted submission CSP must not use `unsafe-inline` or `unsafe-eval`. AYIN's current production Next.js CSP still contains `unsafe-inline` for its shared web runtime. Task 78 does **not** weaken the site's CSP, invent a Samsung exception, or introduce a Tizen-only UI build. This remains an explicit Seller Office blocker until AYIN moves the shared application to a nonce/hash-compatible CSP or Samsung's Content Manager confirms an accepted hosted-app treatment.

## Remote keys and focus

Samsung defines Arrow keys, Enter, and Back as mandatory keys that applications cannot register through TVInputDevice. AYIN continues to normalize those DOM keyboard events through the shared `tv-platform-runtime` and existing `TvFocusScope`.

Non-mandatory playback keys normally require `tizen.tvinputdevice.registerKey/registerKeyBatch`. Because Samsung does not expose Tizen APIs inside hosted content, media-key registration is **not certified for the current hosted package**.

The shared runtime still understands Samsung media key names/codes when they are delivered, so a future packaged-local shell can reuse the same adapter without a product UI fork.

## Return / Back / Exit

The shared adapter keeps Back hierarchical:

1. exit fullscreen first;
2. let shared AYIN UI consume Back;
3. use browser history for detail pages;
4. request an app-root exit flow only at the root.

The exit confirmation defaults focus to Cancel, and a second Samsung Return/Back press cancels the dialog through the shared remote event contract.

The shared exit confirmation calls `tizen.application.getCurrentApplication().exit()` only when that API actually exists.

In hosted mode the root Back key still opens AYIN's exit confirmation. If the user confirms and the Application API is unavailable, AYIN explicitly tells the user to press and hold Samsung Return/Exit to close the app. Samsung documents that long-press Return/Exit forcibly terminates the application and must not be overridden.

The current hosted page still cannot prove the Seller Office single-press Return policy end-to-end without Samsung runtime validation, so Return-key certification is **not claimed**.

## HLS, MP4 fallback, Creator TV, and live

AYIN keeps the shared HTML5 `<video>` path and does not add AVPlay-specific business logic.

Samsung documents HTML5 video, MSE, and HLS support across current TV generations, but supported tags/codecs vary by platform and model.

AYIN therefore preserves:

- shared HLS/native-HLS/hls.js selection;
- progressive MP4 fallback;
- existing live reconnect/backoff;
- Creator TV linear/live playback;
- Task 75/76 linear/DAI logic.

These paths are repository/browser tested, but **not Samsung emulator/device verified** in Task 78.

## Captions

Samsung documents external captions through HTML5 `<track>` using WebVTT. AYIN keeps the existing shared WebVTT/text-track implementation.

Actual font rendering, language switching, synchronization, and accessibility presentation remain emulator/device acceptance items.

## Autoplay

Samsung documents the HTML5 `autoplay` attribute. AYIN still treats autoplay as best-effort: failure to autoplay falls back to the existing user-start controls and never blocks content.

No claim is made that every Samsung model/firmware has identical autoplay policy.

## Fullscreen

Samsung's current Web Engine specifications list Fullscreen API support. AYIN keeps the shared fullscreen implementation and does not create a Tizen-only player.

## IMA / Google Ad Manager

Samsung allows third-party ad-serving platforms but does not guarantee them. Google's current additional-platform guidance lists Samsung Smart TV (Tizen) as requiring contact with the Google account manager for support details.

Task 78 therefore:

- preserves AYIN's shared client-side IMA fail-safe behavior;
- does not request Samsung `adinfo` or invent TIFA mapping;
- does not claim Tizen IMA/GAM certification;
- requires Google account-manager confirmation plus Samsung emulator/device validation before ad compatibility is marked verified.

## Screensaver

Samsung's quality checklist requires the screensaver to be disabled during playback.

The shared runtime now contains a thin `webapis.appcommon.setScreenSaver` adapter that runs only when the Product API is actually available and fails open to playback.

Because hosted content does not receive Samsung Product APIs, the current hosted package does **not** claim this requirement as device-certified. It remains a release blocker unless Samsung confirms hosted-app handling or AYIN moves to a packaged-local architecture.

## Lifecycle and memory

Samsung recommends `visibilitychange` for multitasking. AYIN maps visibility into the existing shared lifecycle bridge:

- hidden → pause media that was playing;
- visible → resume only media paused by lifecycle;
- teardown → release adapter listeners and restore screensaver when supported.

Samsung's memory guidance emphasizes releasing media buffers, DOM, and JavaScript references promptly. Actual memory ceilings remain model-specific and require emulator/device observation.

## Verification matrix

| Stage                         | Target                | Status            | Evidence / limitation                                                                                                   |
| ----------------------------- | --------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Repository/package validation | GitHub CI             | **VERIFIED**      | config/bootstrap/status validator + shared runtime unit/type/build gates                                                |
| Samsung TV Simulator          | Current simulator     | **NOT VERIFIED**  | not available in this task environment; Samsung also states hosted apps and real HLS are not supported by the simulator |
| Samsung TV Emulator           | Current TV Emulator   | **NOT VERIFIED**  | no Samsung emulator host connected                                                                                      |
| Real Samsung TV               | Retail hardware       | **NOT VERIFIED**  | no Samsung TV hardware connected                                                                                        |
| Seller Office submission      | Samsung Seller Office | **NOT SUBMITTED** | explicit approval required before submission                                                                            |
| Seller Office approval        | Samsung Seller Office | **NOT APPROVED**  | no submission was made                                                                                                  |

A simulator result must never be presented as emulator or real-device verification.

## Store / release blockers

Before calling AYIN Tizen-certified:

1. confirm or replace the checked-in development package/application ID with the final Samsung/Tizen Studio identity before signing or Seller Office registration;
2. resolve the hosted-page CSP `unsafe-inline` Seller blocker with a nonce/hash-compatible shared CSP or explicit Samsung Content Manager direction;
3. obtain Samsung Content Manager approval for the hosted-app architecture, or move to a packaged-local architecture that can legitimately access required Tizen/Product APIs;
4. create final Samsung/Tizen author and distributor certificate profiles outside git;
5. package/sign a WGT with current Samsung TV tooling;
6. test on Samsung TV Emulator;
7. test representative physical Samsung TVs;
8. validate Return/Exit policy, screensaver, D-pad/focus, HLS/MP4, WebVTT, autoplay, fullscreen, lifecycle/memory, Creator TV, live, and network loss;
9. confirm IMA/GAM support with Google for Samsung Tizen;
10. prepare Seller Office metadata/artwork;
11. submit only after explicit approval.

No certificate, store credential, signing key, Seller Office submission, or store approval is created by Task 78.

## Official sources reviewed

- Samsung Hosted Applications Q&A: https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html
- Samsung Configuring Web Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html
- Samsung General Specifications: https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html
- Samsung Web Engine Specifications: https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- Samsung Remote Control: https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
- Samsung Terminating Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html
- Samsung Playback Using Video Elements: https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-video-elements.html
- Samsung Mandatory Features for Quality: https://developer.samsung.com/smarttv/develop/development-checklist/mandatory-features.html
- Samsung Setting Screensaver: https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html
- Samsung Web App Memory Optimization Guide: https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html
- Samsung TV Simulator: https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode/tv-simulator.html
- Google IMA additional platforms: https://developers.google.com/interactive-media-ads/docs/sdks/other
- Next.js supported browsers: https://nextjs.org/docs/architecture/supported-browsers
