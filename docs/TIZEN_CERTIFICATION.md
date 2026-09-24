# AYIN Task 78 — Samsung Tizen supported baseline

Task 78 hardens the existing Samsung TV package without creating a Samsung-specific AYIN product UI or player fork.

AYIN remains one shared Web product. The Tizen package is a thin local bootstrap around the canonical HTTPS application.

## Architecture

The package is a **Samsung hosted/cloud Web application**:

1. `config.xml`, `index.html`, `bootstrap.js`, and the package icon are local;
2. the local bootstrap can use Tizen APIs before hosted navigation;
3. it registers only Samsung-reported media keys, then navigates the top-level document to `https://ayin.stream/?platform=tizen&hosted=1`;
4. account/session, product navigation, focus, playback, advertising, Creator TV, and live logic remain in the shared AYIN Web application;
5. Samsung Tizen APIs are **not** assumed to exist after navigation to hosted content.

Samsung documents that hosted/cloud applications normally require prior Content Manager approval and that hosted content cannot use Tizen APIs. Task 78 therefore confines Tizen API calls to the packaged bootstrap and keeps hosted AYIN capability-driven.

A remote iframe is not used.

## Supported Tizen baseline

Task 78 declares **Tizen 9.0** as the minimum supported Samsung TV runtime.

| Samsung TV platform |     Model year | Documented Web engine | Task 78 status                                             |
| ------------------- | -------------: | --------------------- | ---------------------------------------------------------- |
| Tizen 10.0          |           2026 | Chromium 130          | Declared support range; repository validation only         |
| Tizen 9.0           |           2025 | Chromium 120          | Minimum declared support range; repository validation only |
| Tizen 8.0           |           2024 | Chromium 108          | Not supported by Task 78                                   |
| Older Tizen         | 2023 and older | Older engines         | Not supported by Task 78                                   |

The shared AYIN application uses Next.js 16, whose default browser baseline is Chrome 111+. Tizen 8.0's documented Chromium 108 is below that baseline, while Tizen 9.0 and 10.0 are above it. Task 78 intentionally avoids claiming Tizen 8.0 compatibility.

The package declares:

- `required_version="9.0"`;
- Samsung development API metadata `9.0`;
- Samsung TV profile;
- 1920×1080 screen-size feature;
- maximized landscape presentation;
- background support disabled;
- hardware key events enabled;
- pointer support disabled for the remote-first TV baseline.

## Package identity and permissions

Development identity:

- Package ID: `AYINtv2026`
- Application ID: `AYINtv2026.AYIN`
- Widget version: `1.0.0`

The package requests only:

- `http://tizen.org/privilege/internet`;
- `http://tizen.org/privilege/tv.inputdevice`.

TVInputDevice is used only by the **local packaged bootstrap** to register optional media transport keys before hosted navigation. Hosted AYIN itself does not claim Tizen API access.

WARP access is HTTPS-only for AYIN and the Google IMA/GAM origins already used by the shared Web product.

## Remote keys and focus

Samsung documents Arrow keys, Enter, and Back as mandatory keys that do not require explicit registration.

The shared AYIN runtime remains authoritative:

- Arrow keys → existing `TvFocusScope` spatial focus;
- Enter → focused Web control/player action;
- Back → shared Tizen Back policy;
- Play/Pause/Play/Pause/Rewind/Fast-Forward → registered by the packaged bootstrap when the TV reports them as supported.

The packaged bootstrap filters registration through `getSupportedKeys()` and never blocks application startup if registration fails.

Repository tests prove the registration and fail-open logic. Persistence of those registered keys after hosted navigation remains emulator/device validation and is **not claimed complete**.

## Back and Exit

Samsung's Return/Exit policy requires:

- detail pages: Back returns to the previous page;
- application home: Back presents an exit confirmation;
- long-press Exit remains platform-owned.

Task 78 implements that policy without a Tizen-specific AYIN page:

- shared runtime Back on non-root routes calls browser history;
- Back on AYIN root opens a shared TV exit confirmation dialog;
- confirming exit calls `requestTvExit()`;
- packaged Tizen pages call `tizen.application.getCurrentApplication().exit()` directly;
- hosted AYIN navigates back to the local bootstrap, and the bootstrap terminates the application on the back-forward return.

This flow must still be verified on Samsung Emulator and real hardware before device certification is claimed.

## HTTPS and network

The package launches only `https://ayin.stream`.

The package has Internet privilege and explicit HTTPS WARP access. No cleartext origin is added.

Hosted AYIN retains the existing browser online/offline, HLS recovery, and live reconnect behavior. Physical Wi-Fi/Ethernet interruption is a real-device acceptance item.

## HLS, MP4, captions, autoplay, fullscreen, Creator TV and live

Task 78 adds **no Samsung-specific media player**.

AYIN keeps:

- native HTML5 video where supported;
- bundled hls.js/MSE fallback;
- progressive MP4 fallback;
- WebVTT `<track>` captions;
- best-effort autoplay with existing user-start fallback;
- shared Fullscreen API controls;
- Task 75/76 Creator TV HLS/DAI paths;
- Task 74 live playback/reconnect behavior.

Samsung documents HTML5 video, MSE, HLS-capable media playback, and WebVTT captions on current TVs. Exact codecs, live manifests, fullscreen behavior, caption rendering, and autoplay behavior must be validated on the target emulator/device.

## Screensaver certification boundary

Samsung requires the TV screensaver to be disabled while video is playing and re-enabled when playback pauses or stops. Samsung's documented mechanism is the Product AppCommon API (`webapis.appcommon.setScreenSaver`).

AYIN's current hosted/cloud architecture creates a hard certification boundary here: Samsung explicitly does not expose Tizen APIs to hosted content, and Product APIs are likewise available only in the packaged Samsung context. The canonical hosted AYIN player therefore cannot truthfully call AppCommon during playback.

Task 78 does **not** fake screensaver compliance. It records:

- hosted AppCommon/screensaver API availability: **No**;
- screensaver playback control device verified: **No**;
- Samsung Content Manager / architecture resolution and emulator/device validation: release blockers.

If Samsung approves a partner mechanism that keeps Product API control available during hosted playback, it can be added as a thin adapter. A Tizen-specific AYIN player/UI fork is not introduced.

## IMA / GAM

Task 78 preserves the existing Web IMA/GAM integration and its content-safe error/no-fill fallback.

Google's current documentation lists Samsung Smart TV (Tizen) as an additional platform where IMA integration requires contacting the account manager for Samsung support information. Task 78 therefore does **not** claim official Samsung client-side IMA certification.

Physical TV validation and Google account confirmation remain required before client-side IMA/GAM is marked device verified.

## Memory and lifecycle

Samsung recommends releasing heavy media resources and stopping background work when the application is hidden. Samsung also documents that Studio-installed test applications on 2017+ model groups are limited to approximately 120 MB before stability management becomes relevant.

AYIN's shared TV runtime uses `visibilitychange` and `pagehide`:

- playing media is paused when hidden;
- only media that was playing is considered for resume;
- stop lifecycle is emitted on pagehide;
- shared player teardown releases its adaptive/media resources.

No Tizen-only playback state machine is added.

Low-memory eviction behavior remains a Samsung emulator/real-device validation item.

## Login and session

Authentication remains the canonical AYIN HTTPS cookie/session implementation. No Tizen auth store is introduced.

Session behavior across Smart Hub transitions, TV restart, and uninstall must be checked on real hardware before certification status changes.

## Verification matrix

| Stage                                     | Environment           | Task 78 state                           |
| ----------------------------------------- | --------------------- | --------------------------------------- |
| Repository package/config validation      | GitHub CI             | Pending current Task 78 CI              |
| Packaged bootstrap simulation             | Node VM in GitHub CI  | Pending current Task 78 CI              |
| Shared Web unit/integration/browser suite | GitHub CI             | Pending current Task 78 CI              |
| Samsung TV Simulator                      | Samsung Simulator     | **Not verified**                        |
| Samsung TV Emulator                       | Tizen 9/10 Emulator   | **Not verified**                        |
| Real Tizen 9.0 TV                         | Physical Samsung TV   | **Not verified — no hardware attached** |
| Real Tizen 10.0 TV                        | Physical Samsung TV   | **Not verified — no hardware attached** |
| Seller Office submitted                   | Samsung Seller Office | **No**                                  |
| Store approved                            | Samsung Seller Office | **No**                                  |

Repository/Node validation is not Samsung emulator certification.

## Why emulator/device stages remain false

The current execution environment does not provide:

- Tizen Studio + Samsung TV Extension runtime;
- a Samsung certificate profile;
- a configured signed Samsung TV emulator target;
- connected Samsung TV hardware.

Samsung's current emulator installation policy requires Samsung certificate signing for TV applications. Task 78 therefore does not label structural CI as emulator verification.

## Store/release blockers

Before Seller Office submission:

- obtain Samsung Content Manager approval for the hosted/cloud architecture;
- confirm hosted-app CSP/external-resource policy with the Content Manager;
- create and secure Samsung author/distributor certificates;
- build and sign a WGT with official Samsung/Tizen tooling;
- validate Simulator/Emulator;
- validate representative Tizen 9.0 and Tizen 10.0 physical TVs;
- validate media transport keys persist through hosted navigation;
- validate login/session/uninstall behavior;
- validate DPAD/focus/Back/Exit, HLS/MP4/live, Creator TV, captions, autoplay, fullscreen, lifecycle, low-memory, and network recovery;
- resolve and validate Samsung screensaver suppression during every video playback state before store submission;
- confirm intended IMA/GAM deployment with Google account management;
- prepare final Seller Office icon/screenshots/localized metadata.

## Official references

- Samsung Hosted Applications: https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html
- Configuring TV Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html
- Samsung Web Engine Specifications: https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- Samsung Remote Control: https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
- Samsung Terminating Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html
- Samsung Multitasking: https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html
- Samsung Video Elements: https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-video-elements.html
- Samsung General Specifications: https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html
- Samsung Web App Memory Optimization: https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html
- Samsung Mandatory Features for Quality: https://developer.samsung.com/smarttv/develop/development-checklist/mandatory-features.html
- Samsung Setting Screensaver: https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html
- Samsung AppCommon API: https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/appcommon-api.html
- Samsung Emulator Installation Policy: https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-emulator/application-install-policy.html
- Next.js Supported Browsers: https://nextjs.org/docs/architecture/supported-browsers
- Google IMA Additional Platforms: https://developers.google.com/interactive-media-ads/docs/sdks/other
