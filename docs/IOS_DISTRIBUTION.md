# AYIN Task 80 — iOS distribution strategy and initial native app

Task 80 creates AYIN's first maintainable iOS application while preserving the Web/API product architecture. The iOS app is **not** a full-site WKWebView wrapper.

## Decision summary

The iOS client uses:

- SwiftUI for native discovery, authentication and navigation.
- AVFoundation + AVKit / `AVPlayerViewController` for VOD and live playback.
- AYIN's existing HTTPS REST APIs for business/domain behavior.
- AYIN's existing bearer session transport for native authentication.
- Keychain Services for session-token storage.
- Universal-link handling plus the `ayin://` development/fallback URL scheme.
- Native background media configuration, Picture in Picture and AirPlay support.
- Native system sharing.
- SFSafariViewController only for a non-core web fallback, never as the primary product UI.

No backend business logic is duplicated in Swift.

## Why not ship the PWA or a WKWebView wrapper as the App Store app?

AYIN's existing PWA remains useful for Safari/Home Screen distribution. Apple documents Home Screen web apps and web app manifests as supported web-platform experiences.

That does not make a repackaged website the right App Store binary. App Review Guideline 4.2 says App Store apps should provide features, content and UI that elevate them beyond a repackaged website.

The native viewer/player therefore provides the App Store value surface while the PWA remains a complementary channel.

Official references:

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios
- https://developer.apple.com/documentation/browserenginekit/bewebappmanifest

## Authentication and secure session storage

The API already supports native bearer sessions through:

- `POST /auth/login`
- header `X-Ayin-Auth-Transport: bearer`
- response `sessionToken`
- `Authorization: Bearer <token>` on subsequent requests
- `GET /auth/me`
- `POST /auth/logout`
- `POST /auth/mfa/challenge`

Task 80 reuses that transport. The iOS app stores only the opaque session token in Keychain using a ThisDeviceOnly accessibility class. Email/password values are never persisted.

Apple recommends Keychain Services for small user secrets and ATS remains enabled with no arbitrary-load exceptions.

Official references:

- https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets
- https://developer.apple.com/documentation/security/preventing-insecure-network-connections

## Sign in with Apple

Task 80 does **not** add a fake Sign in with Apple flow.

The current primary account system is AYIN's own email/password/MFA system. App Review Guideline 4.8 explicitly lists an exception when an app exclusively uses its company's own account setup and sign-in system.

If AYIN later adds Google, Facebook, X or another third-party/social primary login, the iOS product must add an Apple-compliant equivalent login option unless another documented exception applies. At that point the backend must verify Apple identity tokens and nonce/state values; this must remain server-side account logic, not duplicated in the app.

Official references:

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple
- https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple

## Deep links and universal links

The app handles:

- `https://ayin.stream/watch/<slug>`
- `https://ayin.stream/en/watch/<slug>`
- `https://ayin.stream/ar/watch/<slug>`
- `https://ayin.stream/live/<slug>`
- localized live equivalents
- `ayin://watch/<slug>`
- `ayin://live/<slug>`

Only the AYIN HTTPS origin and safe slug shapes are accepted for native routing. Other AYIN pages may open in the in-app Safari controller.

The app entitlement declares:

`applinks:ayin.stream`

Universal links require the two-way website association. The repository includes an AASA template, but Task 80 does not invent the Apple Team ID. Production verification remains false until the real Team ID is configured and the file is deployed at:

`https://ayin.stream/.well-known/apple-app-site-association`

Official references:

- https://developer.apple.com/documentation/xcode/supporting-associated-domains
- https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
- https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content

## Native media architecture

VOD uses the existing:

`GET /public/videos/:slug/playback`

The app prefers the HLS adaptive source when present and otherwise uses the canonical MP4 fallback. Object keys remain resolved against `https://media.ayin.stream`.

Live uses:

`GET /live/:slug`

and consumes the provider's HTTPS `playbackUrl`.

Playback uses `AVPlayer` and `AVPlayerViewController`, not JavaScript video inside WKWebView. This gives AYIN native system playback controls and a stable Apple-native path for HLS, full-screen playback, AirPlay and Picture in Picture.

Official references:

- https://developer.apple.com/documentation/avkit/avplayerviewcontroller
- https://developer.apple.com/streaming/

## Background playback, interruptions and PiP

The app declares the `audio` background mode and activates `AVAudioSession.Category.playback` only when media starts.

The player:

- remains compatible with background playback and PiP;
- permits AirPlay;
- pauses for system audio interruptions;
- resumes only when the system marks the interruption resumable;
- tears down the `AVPlayerItem` when the player screen closes.

Apple documents that the playback category plus the audio background mode is the correct foundation for continued media playback and that PiP requires background-audio configuration.

Official references:

- https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback
- https://developer.apple.com/documentation/avkit/avpictureinpicturecontroller
- https://developer.apple.com/documentation/avkit/avplayerviewcontroller

## Safe area and sharing

The SwiftUI product UI uses system safe areas by default. Only the full-screen video surface intentionally extends beneath system chrome.

Player share actions use the native system share sheet through SwiftUI `ShareLink`, sharing the canonical `ayin.stream` watch/live URL.

Official reference:

- https://developer.apple.com/documentation/uikit/uiactivityviewcontroller

## WKWebView / hybrid boundary

WKWebView is not part of the core iOS product architecture in Task 80.

A future narrow hybrid surface is acceptable only when it adds real value and does not turn AYIN into a website wrapper. OAuth-style web authentication, if introduced, should use `ASWebAuthenticationSession` rather than a custom credential-catching WKWebView.

Official reference:

- https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession

## Advertising / Google IMA

Task 80 keeps content playback native and does not embed the Web IMA implementation.

Google currently supports its native iOS IMA SDK and recommends Swift Package Manager. That is the correct future integration point for AYIN's in-player client-side ad inventory.

IMA is deliberately not linked in the initial binary because production ad identifiers/consent policy and device acceptance are separate launch gates. Adding the SDK without an active native ad path would increase binary/privacy surface without product value.

Current Google references:

- https://developers.google.com/interactive-media-ads/docs/sdks/ios/client-side/get-started
- https://developers.google.com/interactive-media-ads/docs/sdks/ios/client-side/compatibility

## Purchases and future monetization

Task 80 contains no StoreKit purchase UI because AYIN's current iOS scope has no paid digital unlock.

If AYIN later sells premium digital content, feature unlocks or subscriptions in the iOS app, App Review Guideline 3.1.1 requires In-App Purchase unless a specific rule/entitlement for the storefront and business model permits another path. Reader-app and multi-platform rules must be evaluated against the exact future offer rather than assumed in advance.

Official reference:

- https://developer.apple.com/app-store/review/guidelines/

## Build and signing strategy

The project is generated from `platforms/ios/project.yml` with XcodeGen to keep project configuration reviewable.

Repository CI:

1. verifies there is no committed Apple signing material;
2. generates the Xcode project;
3. validates plist/entitlement files;
4. builds the app for iOS Simulator with signing disabled;
5. boots an available iPhone simulator;
6. runs the native unit tests.

Final distribution signing is intentionally outside the repository. Do not commit:

- `.p8` App Store Connect private keys
- `.p12` certificates
- `.mobileprovision` profiles
- certificate passwords or signing credentials

Use protected CI/App Store Connect credentials when the Apple Team/App ID is finalized.

## Initial native feature surface

Task 80 implements:

- guest native discovery;
- native AYIN email/password sign-in;
- bearer session restore from Keychain;
- MFA challenge support for already-enrolled accounts;
- safe handling of accounts that still require MFA enrollment;
- sign out and server session revocation;
- native VOD HLS/MP4 playback;
- native live HLS playback;
- native full-screen player;
- Picture in Picture where supported;
- background audio and AirPlay configuration;
- audio interruption lifecycle;
- universal/custom deep-link parsing;
- native share;
- safe-area-native SwiftUI layout;
- Safari fallback for unsupported non-core pages.

## Verification truth

Repository CI can prove source/configuration quality and simulator behavior. It cannot prove App Store approval.

The canonical status file is `platforms/ios/CERTIFICATION_STATUS.json`.

Until separately completed, do not claim:

- physical iPhone/iPad verification;
- signed archive verification;
- TestFlight upload;
- App Store submission;
- App Store approval;
- production AASA verification;
- native IMA production validation;
- StoreKit purchase validation.
