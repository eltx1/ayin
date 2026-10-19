# AYIN iOS mobile release

## Architecture and update boundary

The existing SwiftUI application, `net.ayin.app.ios`, now opens the production AYIN site in WKWebView as its primary experience. The existing native Home/AVPlayer/Keychain code remains accessible from **App options → Native video browser**. Its native login is independent of the hosted web cookie session. It must not be represented as a shared login.

The site is server-rendered Next.js. Normal production web deployment updates the hosted experience at the next appropriate navigation. There is no static export, live-reload development URL, downloaded executable bundle installer, or self-updating native SDK. Server deployment rollback is the web rollback mechanism. Native/bridge capabilities require a reviewed store binary. Server changes must keep bridge v1 working for old installations. A network error displays an app-bundled recovery screen and retry/native-browser actions; it does not promise offline video playback.

WKWebView permits main-frame navigation only to `https://ayin.stream` (port 443). WKAppBoundDomains, per-message frame/origin validation, fixed method schemas, bounded payloads, replay prevention and JSON arguments for fixed JavaScript dispatch protect the bridge. External clicked links open the system browser. Embedded third-party frames never receive the injected bridge and their direct message attempts are rejected. User HTML must continue to be sanitized by AYIN's existing web rendering boundary. PWA storage in Safari is separate from the app's WKWebView data store.

## Locked SDK dependencies

| Dependency | Exact version | Purpose |
| --- | --- | --- |
| Google Mobile Ads | 13.11.0 | Native adaptive banner and natural-transition interstitial |
| User Messaging Platform | 3.1.0 | Consent refresh, required form, privacy options |
| Firebase Apple SDK | 13.0.0 | AnalyticsCore, Messaging, Crashlytics |

The project continues to target iOS 17.0 and requires Xcode 26.2 or newer for these SDKs. `project.yml` pins direct SPM packages. The resolved transitive `Package.resolved` produced by macOS CI must be retained and reviewed for release. No mediation adapters, rewarded inventory, native-feed ad renderer, App Open, Notification Service Extension, camera or microphone permissions are added. Text notifications are supported; `richMedia: true` is rejected until a reviewed extension exists.

## Ads and consent

Ads default off, including the per-platform kill switch. A declared general audience, enabled iOS inventory, an explicit age decision and UMP `canRequestAds` are all required before native SDK startup or ad requests. Unknown/child profiles cannot request native ads in bridge v1. Configure UMP privacy messages for the actual iOS app; do not configure an IDFA/ATT message for this nontracking build. Analytics consent is separate from UMP consent.

No ATT request is issued. Firebase uses AnalyticsCore without AdSupport, with IDFV collection disabled. Native ad requests use nonpersonalized parameters, publisher personalization disabled and publisher first-party ID disabled. These implementation choices are not a substitute for checking the SDK privacy report and actual third-party processing before submitting App Privacy answers.

Debug always uses Google's iOS sample ad units. Release honors validated native units or explicit test mode. The Debug AdMob application ID is Google's sample; Release requires a real ID injected securely. Native ad inventory is independent of web GAM/VAST/IMA. The primary hosted site continues to own content playback; no new native IMA preroll implementation is claimed.

Banner occupies a native safe-area container outside web content. Requests, failures, retry limits and timeout generations prevent duplicate loads and late UI. Native interstitial calls require a natural transition and no active HTML media/upload. A first call preloads; only a later eligible transition can present a ready ad, never an asynchronous load completion over resumed content. Caps and cooldowns are enforced. Ads are destroyed on navigation/background/reset. No automatic interstitial caller is enabled in the web product yet.

Only `ad_request`, `ad_loaded`, `ad_failed` are logged manually to consent-gated Firebase. Paid callbacks emit an estimated, response-deduplicated diagnostic event with currency and precision. They are not publisher payables. Firebase/Google own automatic `ad_impression` and revenue; the app does not log a second copy. SDK crash reporting is disabled; opted-in Firebase Crashlytics owns native crashes. Crashlytics does not capture arbitrary JavaScript exceptions.

## Firebase/APNs setup through secure release configuration

1. Register the unchanged iOS bundle ID `net.ayin.app.ios` in the correct Firebase environment. Inject its unmodified `GoogleService-Info.plist` at `AYIN/GoogleService-Info.plist` before XcodeGen. The file is ignored by Git. A missing or mismatched file disables Firebase without preventing content browsing.
2. Enable Push Notifications on the Apple App ID. Configure the Apple team, distribution certificate and provisioning profile in protected CI secrets. Debug uses `aps-environment=development`; Release uses `production`.
3. Upload the APNs authentication key through **Firebase Console → Project settings → Cloud Messaging → Apple app configuration**, with the correct Apple team ID and key ID. Never put `.p8` signing keys in the web bundle, source or artifacts.
4. Set release build setting `AYIN_ADMOB_APP_ID` to the real iOS app ID. Use the AYIN admin configuration for supported Ad Unit IDs, global/per-platform switches, caps and approved test mode. Configure impression-level revenue in AdMob if required.
5. Use protected backend FCM credentials for sends. The iOS app never has a service-account send credential. An APNs device token is passed to Firebase internally; only a Firebase registration token crosses the bridge to authenticated device registration.
6. CI archives preserve dSYMs; the configured release workflow uploads symbols with Firebase's official tool. A missing plist means no symbol upload or runtime Firebase evidence is possible.

`runtime.configure` returns `boundAccountId` (persisted opaque UUID or null), installation UUID, platform, version and availability flags. The web checks its authenticated current account before preserving a previous device binding. Logout/switch clears user ID, resets collection consent, unregisters APNs and deletes FCM token. The backend independently verifies recipient ownership and session validity. Token rotation events include recipientAccountId, never APNs bytes. Foreground notifications for a mismatched account are suppressed. Background APNs alerts use generic content because iOS may display already-queued alerts before application code can run.

Notification taps queue until bridge/runtime readiness. They carry only the owned notification ID and recipient account; the web requests the authenticated destination-resolution endpoint before navigating. Deleted/private destinations are handled by that endpoint. Foreground/background/terminated delivery and APNs production credentials still require a signed physical device. Silent push and uninterrupted background upload are not promised.

## Verification and release gates

`MobileContractTests` checks origin spoofing, schema/type rejection, forbidden bundle/origin changes, limits, platform config parsing, minimum version, deterministic rollout, sensitive analytics parameters and reserved events. Existing native discovery/session/player tests remain intact. These tests do not prove SDK delivery or device behavior.

Before internal release, require passing macOS simulator build and XCTest, unsigned device archive, a reviewed resolved package lock, and generated archive privacy report. Before store submission, require actual signing, valid associated-domain team prefix, real Firebase/AdMob configuration, signed device tests and approved App Privacy/Data Safety statements. The App Privacy manifest covers app-owned native and hosted account/UGC/payout data; SDK manifests must be included in the merged report. No entitlement, membership or App Store Connect availability has been assumed.

On a dedicated test device: opt in/out of Analytics and verify one event in DebugView (`-FIRDebugEnabled` for the test run); show only Google test ads, verify no-fill/timeout/dismiss/retry; enable notifications explicitly, send only to the test installation through AYIN administration, verify a tap after foreground/background/cold launch, rotate token and switch accounts; exercise video, long Clips session, file selection, interrupted upload, resume after reopening and no early publication. Hosted foreground uploads do not become native persistent background uploads merely because the app embeds WKWebView. System-browser OAuth return requires a separately validated handoff if enabled by the web authentication product; it is not inferred from an ordinary external-link open.

The default version is 1.1.0 (build 2). CI can override version/build after checking store history. Public release remains a separate approval. A failed Firebase/Ads integration is an optional-feature failure; content must stay usable.
