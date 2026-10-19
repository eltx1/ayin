# AYIN mobile release architecture

Decision date: 2026-10-19. Inspected baseline: `73f08d7e1d19e6ab8256718eb4d390c4fcbe653d`.

## Reuse and ownership

AYIN is a Next.js 16 App Router application with server rendering and authenticated server/API routes. It is not a static PWA export. Android already contains an origin-scoped Kotlin WebView shell, document-picker integration, lifecycle notifications, deep links and TV/Fire TV flavors. iOS already contains SwiftUI discovery, Keychain sessions and an AVPlayer implementation. tvOS is a separate native application. No Capacitor, Cordova, React Native or Flutter migration is justified for the requested integrations.

The mobile release reuses Android's shell and adds a first-party hosted WKWebView surface to the existing iOS application. The existing iOS native implementation is retained. Web and native fallback sessions remain separate unless an explicit, reviewed session transfer mechanism is implemented; do not copy bearer tokens into JavaScript or browser storage. Existing AYIN identity and database remain authoritative. Firebase is for native telemetry and messaging, not replacement authentication.

| Layer                                                                                   | Owner                           | Store release required                     |
| --------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------ |
| Native bridge, Google/Firebase SDKs, permissions, APNs entitlements, picker, native UI  | Installed signed binary         | Yes                                        |
| Existing AYIN first-party pages, presentation, content, ordinary bug fixes              | HTTPS deployment at ayin.stream | Usually no, within reviewed functionality  |
| Accounts, media, device subscriptions, notification dispatch, validated mobile settings | AYIN API/database               | No, when compatible with installed clients |
| New SDK/ad adapter/native capability or materially new app function                     | Reviewed binary/product release | Yes                                        |

## Hosted interface update model

The app loads only the configured first-party HTTPS origin. It does not use Capacitor live reload, an arbitrary development server, downloaded executable bundles, unsigned ZIP updates, eval-based native dispatch, or a third-party mini-app system. The installed native bridge is versioned and exposes a fixed allowlist. External destinations open outside the privileged surface. Native entry points reject untrusted origins and non-main frames.

A web deployment becomes visible on the next normal page load. It must not force-refresh an ongoing upload, content playback or ad. Existing documents may continue to run the older web revision until navigation/relaunch. The PWA service worker is excluded from native hosted sessions to avoid stale worker ownership. A bundled local offline/retry surface provides a usable failure state; this does **not** promise offline catalog playback, offline authentication, or an offline copy of the SSR application.

On shell upgrades, the hosted client unregisters existing same-origin service workers without deleting caches, IndexedDB or upload data. The current document may remain controlled until the next normal full navigation or relaunch; unregistering does not force a reload during playback or upload.

Because no downloaded web bundle updater is used, bundle signature verification/atomic bundle activation are not applicable. HTTPS origin validation and the normal server deployment controls authenticate hosted content. This is not equivalent to a signed last-known-good offline web bundle. Rollback is a server release rollback; native defaults fail closed for optional services if configuration is unavailable. A minimum bridge/app version must fail optional features safely without breaking ordinary content access. Never activate functions to conceal them from store review.

AYIN admin is the single source for schema-versioned runtime settings. Firebase Remote Config is deliberately not a second source. App IDs are build configuration; supported ad unit IDs, caps, feature kill switches and preference controls are runtime settings. Remote settings are public data and contain no sender credentials.

## Ad format scope

The native SDK surface supports adaptive banners and explicit interstitials at a natural transition. Neither may cover a playing content video or interrupt upload. App Open is not enabled. Rewarded is not enabled because AYIN has no agreed reward. In-feed native rendering and additional mediation adapters are not implemented preemptively; adding those requires implementation, review and usually a new binary. Existing GAM/VAST/IMA content advertising remains a separate Web/PWA pathway. New AyinMobile hosts explicitly suppress Web GPT/IMA inventory before loading/requesting it: native UMP is not automatically a consent bridge for browser IMA. Native pre/mid-roll content advertising is not implemented by Google Mobile Ads and remains disabled until a separately reviewed IMA/player integration is implemented and tested. Native display inventory must never silently reuse web GAM identifiers as AdMob units.

## Store-policy interpretation

This is a first-party video application with installed native capabilities, not a general mini-app host. Routine hosted presentation/content changes must remain within the submitted product's described capabilities. A hosted interface is not a guarantee of App Store acceptance. Material feature changes, new downloaded functionality and SDK updates need a reviewed release. Reviewer notes must disclose hosted UI, bridge scope, ads and push.

Primary references checked on the decision date:

- Apple App Review Guidelines 1.2, 2.5.2, 2.5.6, 2.5.18, 4.2, 4.7, 5.1: https://developer.apple.com/app-store/review/guidelines/
- Google Play Device and Network Abuse (interpreted-code exception does not remove policy obligations): https://support.google.com/googleplay/android-developer/answer/16559646
- Android target SDK requirements (mobile submissions target API 36 as of this review): https://developer.android.com/google/play/requirements/target-sdk
- Apple submission SDK requirements: https://developer.apple.com/news/upcoming-requirements/

## Release gates

Source implementation, successful unsigned build, simulator execution, provider credentials and physical-device evidence are separate gates. Never infer Firebase delivery, UMP production configuration, an ad impression, APNs delivery or store readiness from compilation/mocks. The final evidence report records those gates individually.
