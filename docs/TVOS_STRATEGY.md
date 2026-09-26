# AYIN Task 81 — Apple TV / tvOS strategy

Task 81 creates a native Apple TV client that reuses AYIN API/domain contracts and does not assume the Web/Tizen architecture can run unchanged on tvOS.

## Platform decision

AYIN Apple TV is a native SwiftUI + UIKit + AVKit/AVPlayer application with a minimum deployment target of tvOS 18.

The core app does not use WKWebView. Apple's current WKWebView documentation does not list tvOS as a supported platform. Apple also deprecated TVML, TVMLKit and TVMLKit JS beginning in tvOS 18 and directs apps toward SwiftUI/UIKit.

Official references:

- https://developer.apple.com/documentation/webkit/wkwebview
- https://developer.apple.com/documentation/tvmlkit
- https://developer.apple.com/videos/play/wwdc2024/10160/

## Shared AYIN architecture

Business/domain behavior remains on AYIN APIs. The tvOS XcodeGen target directly compiles existing shared Swift contracts for environment, HTTPS API, bearer auth, Keychain session contracts, discovery, playback accounting, media URLs and watch progress. tvOS adds only Apple TV presentation, navigation, focus, player, caption and TV catalog adapters.

No backend business logic is duplicated.

## Core product surfaces

The initial app provides Home, Search, My AYIN/Continue Watching, native content details, Channel pages, Creator TV guide/playback, movies, series/episodes, VOD and live playback, and native authentication.

API contracts reused include /public/discovery/home, /discovery/home, /discovery/my-ayin, /public/search, /public/channels/:handle, /public/channels/:handle/tv, /public/channels/:handle/tv/linear, /public/movies/:slug, /public/series/:slug, /public/videos/:slug/playback, /live/:slug and /watch/progress/:videoId.

Kids discovery links preserve the kids=1 policy boundary through routing, sharing and playback.

## Remote focus

SwiftUI focus is the default navigation model. Browse cards and actions are native Buttons grouped into focus sections, so Siri Remote navigation uses the platform focus engine rather than DOM/spatial-navigation code. AVPlayerViewController owns playback remote semantics.

Official references:

- https://developer.apple.com/documentation/uikit/about-focus-interactions-for-apple-tv
- https://developer.apple.com/documentation/swiftui/view/onmovecommand(perform:)

## Native playback

Playback uses AVPlayer and AVPlayerViewController. It prefers HLS where AYIN exposes an adaptive source, keeps MP4 as VOD recovery, supports live HLS, uses native tvOS transport controls, restores/saves authenticated watch progress without blocking startup, reports startup after AVPlayer reaches playing, checkpoints on lifecycle changes, and reports TV analytics through /analytics/events.

Apple documents AVPlayerViewController as the native tvOS playback UI with Siri Remote, subtitle/alternate-audio and Picture in Picture support.

Official references:

- https://developer.apple.com/documentation/avkit/avplayerviewcontroller
- https://developer.apple.com/documentation/avfoundation/avplayer
- https://developer.apple.com/streaming/

## Subtitles

AYIN currently exposes enabled sidecar WebVTT caption assets from the playback API. The tvOS app loads those HTTPS VTT assets, parses cues natively, exposes track selection in the AVPlayerViewController transport-bar custom menu, and renders the selected cue in the player content overlay.

If a future HLS master contains standard subtitle media-selection groups, AVPlayer native media selection should be preferred.

Official references:

- https://developer.apple.com/documentation/avkit/avplayerviewcontroller
- https://developer.apple.com/streaming/examples/

## Live / FAST / Creator TV

Creator TV first requests the existing linear capability. When linear HLS is available, AVPlayer uses that HLS stream, which is also the correct path for AYIN's existing server-side ad signaling/SSAI capability. If linear HLS is unavailable, tvOS uses the current Creator TV program as progressive MP4 with the server-provided conceptual offset and does not claim frame-accurate synchronized linear playback.

## Advertising

Task 81 does not assume HTML5/browser IMA works on tvOS.

Current strategy:

- Creator TV / FAST: the app starts from a safe `LIMITED_ADS` consent mode and uses generic AYIN linear HLS in that state.
- Google DAI server-side playback is selected only when the backend marks DAI available **and** an explicit consent provider allows it. `NON_PERSONALIZED` appends `npa=1`; `LIMITED_ADS` never selects the Google DAI URL.
- VOD client-side ads: use Google's native IMA tvOS SDK when production ad tags, consent behavior and device validation are ready.
- The initial Task 81 binary does not link IMA because those production inputs are not part of this task.

Official references:

- https://developers.google.com/interactive-media-ads/docs/sdks/tvos/client-side
- https://developers.google.com/interactive-media-ads/docs/sdks/tvos/client-side/compatibility
- https://github.com/googleads/swift-package-manager-google-interactive-media-ads-tvos

## Authentication

Apple TV reuses AYIN bearer authentication: email/password, MFA authenticator code, MFA recovery code, Keychain token storage, session restore and logout. No browser credential wrapper is used.

## Deep links

The target declares applinks:ayin.stream and a fallback ayin-tv:// custom scheme. Native routes include watch, live, movie, series, channel and Creator TV links. Production Universal Link verification still requires the real Apple Team ID and deployed AASA file.

Official references:

- https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
- https://developer.apple.com/documentation/xcode/supporting-associated-domains

## Top Shelf

Top Shelf is appropriate for a future AYIN Apple TV release because Continue Watching, movies, series and channels map naturally to Top Shelf items. Task 81 deliberately does not add a Top Shelf extension yet.

Apple implements Top Shelf through a separate TVServices extension and warns that extension memory limits are significantly lower than the main app. Before adding it, finalize the App IDs, production artwork/cache policy, a bounded server-side feed, profile/privacy behavior and physical-device memory validation.

Official references:

- https://developer.apple.com/documentation/tvservices
- https://developer.apple.com/documentation/tvservices/tvtopshelfcontentprovider

## Build and signing

platforms/tvos/project.yml is the reviewable XcodeGen source. CI rejects committed Apple signing secrets, generates the project, validates plist/entitlements, builds unsigned for Apple TV Simulator, verifies production HTTPS origins, boots an available Apple TV Simulator, and runs unit tests.

Never commit App Store Connect .p8 keys, .p12 certificates, .mobileprovision files or Apple Team credentials/passwords.

## Certification truth

Repository and simulator checks are not App Store certification. The canonical status is platforms/tvos/CERTIFICATION_STATUS.json. Do not claim physical Apple TV verification, signed archive, TestFlight upload, App Store submission or App Store approval until those stages actually happen.
