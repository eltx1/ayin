# AYIN Task 78 — Samsung Tizen supported baseline

Task 78 hardens the existing Samsung TV package without creating a Samsung-specific AYIN product UI.

AYIN remains one shared Web product. The Tizen package contains only a local bootstrap page that validates the Samsung runtime and then navigates the top-level Web application to the canonical HTTPS AYIN origin.

## Architecture

The package is a **Samsung hosted/cloud Web application**:

1. `config.xml` and the package icon are local;
2. `index.html` and `bootstrap.js` perform only compatibility/network startup checks;
3. the top-level document navigates to `https://ayin.stream/?platform=tizen&ayin_tizen_hosted=1`;
4. all account/session, navigation, focus, playback, advertising, Creator TV and live logic remains in the shared AYIN Web application.

Task 78 does **not** use a remote iframe. Samsung documents that remote iframe content in a TV Web application is not an interactive replacement for the app UI: remote iframe user interaction can open the TV Web Browser, and Tizen/Product APIs are not available to the remote iframe.

Samsung also documents that hosted/cloud applications require prior Content Manager approval except for approved special cases, and Tizen APIs are not available in hosted content for security reasons.

Because of those rules:

- the hosted AYIN page does not claim `tizen.tvinputdevice`;
- the package does not request the `tv.inputdevice` privilege;
- media-key registration is not claimed for the hosted runtime;
- standard D-pad/Enter/Back events are handled by the shared Web runtime;
- Seller Office submission remains blocked until Samsung Content Manager confirms the hosted architecture.

## Supported Tizen baseline

AYIN Task 78 declares **Tizen 9.0** as its minimum supported Samsung TV runtime.

| Samsung TV platform | Model year | Samsung Web engine | AYIN Task 78 baseline |
| --- | ---: | --- | --- |
| Tizen 10.0 | 2026 | Chromium 130 | In declared support range; repository logic validated only |
| Tizen 9.0 | 2025 | Chromium 120 | Minimum declared support range; repository logic validated only |
| Tizen 8.0 | 2024 | Chromium 108 | Not supported by Task 78 |
| Older Tizen | 2023 and older | Older Chromium engines | Not supported by Task 78 |

The shared AYIN Web application uses Next.js 16 / React 19. Next.js 16 documents Chrome 111+ as its default browser baseline. Tizen 9.0 and 10.0 are therefore the first current Samsung TV generations whose documented Chromium engines are above that baseline. Task 78 intentionally does not claim Tizen 8.0 compatibility.

The package declares:

- `required_version="9.0"`;
- Samsung development API metadata `9.0`;
- Samsung TV profile;
- 1920×1080 screen-size feature;
- maximized landscape presentation;
- background support disabled;
- hardware key events enabled;
- pointing-device support disabled for the remote-first baseline.

## Package identity and permissions

Development identity remains the existing Task 38 identity:

- Package ID: `AYINtv`
- Application ID: `AYINtv.AYIN`
- Widget version: `1.0.0`

The package requests only the Tizen Internet privilege.

The hosted application does **not** request TVInputDevice because Samsung does not expose Tizen APIs to hosted content.

WARP access remains HTTPS-only for:

- `ayin.stream` and its subdomains;
- Google ad/IMA origins already used by the shared AYIN Web product.

No cleartext HTTP origin is added.

## Remote keys, focus, Back and Exit

Samsung documents that Arrow keys, Enter and Back are automatically delivered and do not require TVInputDevice registration.

AYIN therefore keeps remote navigation in the shared Web runtime:

- Arrow Up/Down/Left/Right → existing `TvFocusScope` spatial focus;
- Enter → existing focused Web control/player action;
- Back → existing browser/platform behavior unless a shared AYIN handler consumes it;
- focus visibility remains the existing AYIN TV focus styling.

Media transport keys such as Play/Pause/Rewind/Fast-Forward require Samsung TVInputDevice registration. Because hosted AYIN content has no Tizen API access, Task 78 does **not** claim those registered transport keys work in the hosted package.

Long-press Exit remains platform-owned. Task 78 does not synthesize or intercept an Exit key.

Real Back/Exit behavior must be verified on physical Tizen 9.0 and 10.0 TVs before a device-stage claim is made.

## HTTPS and network behavior

The package only launches `https://ayin.stream`.

The local bootstrap:

- rejects unknown/non-Tizen user agents;
- rejects Tizen versions below 9.0;
- waits when `navigator.onLine === false`;
- navigates only after the runtime is supported and online.

After navigation, the existing AYIN network behavior applies. Live playback already uses bounded reconnect/backoff and ordinary browser online/offline events.

Actual Wi-Fi/Ethernet loss/recovery remains a real-TV validation item.

## HLS, MP4, Creator TV and live

Task 78 adds no Tizen-specific player fork.

AYIN continues to use:

- native HLS when the browser reports support;
- bundled hls.js when needed;
- progressive MP4 as the existing content fallback;
- Task 75/76 Creator TV HLS output;
- Task 74 shared live playback/reconnect path.

Samsung's current media documentation supports HTML5 video, HLS and MSE on supported TVs. Samsung's general specifications document HLS basic version 3 and do not support `EXT-X-INDEPENDENT-SEGMENTS`; AYIN's Creator TV output already avoids requiring that tag.

Exact codecs, manifests and live-provider streams still require runtime validation on representative TVs.

## Captions

AYIN keeps the existing HTML5 `<track>` / WebVTT caption path.

No Samsung-only caption UI or subtitle engine is added.

WebVTT rendering, caption focus/selection and language behavior remain physical-TV acceptance items.

## Autoplay and user-start fallback

AYIN keeps its existing best-effort autoplay behavior.

Samsung documents HTML5 video autoplay support on current TVs, but AYIN does not assume every content/ad state can autoplay. If `play()` is rejected, the existing shared user-start control remains the fallback.

## Full-screen video

AYIN keeps the shared Web Fullscreen API/player controls.

No AVPlay-only fullscreen path is introduced. Fullscreen entry/exit and Back interaction remain real-device validation items.

## IMA / Google Ad Manager

Task 78 does not claim official client-side Google IMA certification on Samsung Tizen.

Google's current IMA HTML5 documentation treats Samsung TV/Tizen as an additional-device case that requires contacting the Google account team rather than a generally supported browser target.

AYIN therefore preserves:

- the existing HTML5 IMA integration;
- consent handling;
- content-safe IMA error/no-fill fallback;
- Task 76 server-side DAI path where separately configured.

Physical Samsung TV testing and Google account-manager confirmation are required before client-side IMA/GAM can be marked device verified.

## Memory behavior

Samsung recommends releasing HTML5 video decoder/buffer resources by:

1. pausing playback;
2. removing the media `src`;
3. calling `load()`.

Task 78 adds that sequence to the shared AYIN VOD teardown helper instead of creating a Tizen player fork. The helper is exception-safe so detached media cannot break route teardown.

The live player already destroys its adaptive session and releases its video element through the shared live cleanup path.

Actual low-memory eviction/recovery remains a physical-device acceptance item.

## Lifecycle

Samsung documents `visibilitychange` as the Web-app multitasking signal.

The shared TV runtime already maps document visibility to AYIN pause/resume lifecycle behavior and now also emits a stop lifecycle on `pagehide`.

Media that was playing is paused on backgrounding and only those media elements are considered for resume.

Model-specific multitasking behavior remains a device validation item because low-memory models can terminate apps instead of suspending them.

## Login and session

Login/session remains the canonical AYIN HTTPS cookie/session implementation.

No Tizen-specific auth store is added.

Session persistence across Smart Hub transitions, TV restart and uninstall data removal must be verified on a real TV before certification status changes.

## Verification matrix

| Stage | Environment | Task 78 state |
| --- | --- | --- |
| Repository package/config validation | GitHub CI | Pending PR CI |
| Hosted bootstrap simulation | Node VM in GitHub CI | Pending PR CI |
| Shared Web unit/integration/browser suite | GitHub CI | Pending PR CI |
| Samsung TV Simulator | Samsung simulator | **Not verified** |
| Samsung TV Emulator | Tizen 9/10 emulator | **Not verified** |
| Real Tizen 9.0 TV | Physical Samsung TV | **Not verified — no hardware attached** |
| Real Tizen 10.0 TV | Physical Samsung TV | **Not verified — no hardware attached** |
| Seller Office submitted | Samsung Seller Office | **No** |
| Store approved | Samsung Seller Office | **No** |

Repository/Node validation is not Samsung emulator certification.

## Why emulator/device stages remain false

The current environment does not have:

- Tizen Studio + Samsung TV Extension installation runtime;
- a Samsung certificate profile;
- Samsung TV emulator images already configured for signed installation;
- connected Samsung TV hardware.

Samsung's current emulator installation policy requires Samsung certificate/signing setup for TV applications. Task 78 therefore creates only an **unsigned structural payload archive** in CI and does not call it a WGT, emulator-verified package or store-ready artifact.

## Release blockers before Seller Office

Before submission:

- obtain Samsung Content Manager approval for the hosted/cloud architecture;
- resolve Samsung hosted-app CSP policy with the Content Manager; AYIN's shared production CSP currently uses `unsafe-inline` for product requirements;
- create and securely retain the Samsung author/distributor certificate profile;
- build a signed WGT with official Samsung/Tizen tooling;
- validate Samsung Simulator/Emulator;
- validate representative physical Tizen 9.0 and 10.0 TVs;
- validate IMA/GAM on hardware and confirm support with Google account management;
- verify login/logout/session/uninstall behavior;
- verify DPAD/focus/Back/Exit, HLS/MP4/live, Creator TV, captions, autoplay, fullscreen, lifecycle, low-memory and network recovery;
- prepare final Samsung Seller Office artwork, screenshots, localized metadata and release information.

## Official references used

- Samsung Hosted Applications: https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html
- Configuring TV Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html
- Samsung Web Engine Specifications: https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html
- Samsung Remote Control: https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
- Samsung Terminating Applications: https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html
- Samsung Multitasking: https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html
- Samsung Video Elements: https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-video-elements.html
- Samsung General Specifications: https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html
- Samsung Web App Memory Optimization: https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html
- Samsung Emulator Application Install Policy: https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-emulator/application-install-policy.html
- Next.js Supported Browsers: https://nextjs.org/docs/architecture/supported-browsers
- Google IMA HTML5 Compatibility: https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/compatibility
