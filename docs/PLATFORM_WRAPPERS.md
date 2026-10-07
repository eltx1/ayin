# AYIN PWA and platform implementation

Source review: 2026-10-07. This describes repository implementation, not a native build, device, store or deployment acceptance result.

The Web/PWA remains the product source of truth. Hosted web shells reuse its routes through the narrow `AYIN_PLATFORM_BRIDGE` capability contract. iOS and tvOS have native SwiftUI/AVPlayer clients against the shared API contracts. Earlier hybrid-candidate descriptions in the original roadmap record the plan at that time; they do not describe the current Apple clients.

## PWA

The [service worker](../apps/web/public/sw.js) precaches `/offline.html` and the two repository-owned icons. Its runtime cache is limited to eligible same-origin `/_next/static/` assets, with at most 128 build-asset entries in addition to those three shell entries. Query-bearing, authorization/range and explicit no-store/no-cache requests bypass that cache; redirected, non-200, non-basic and private/no-store/no-cache responses are not retained.

Navigation uses the network, falling back to the neutral offline page only when the fetch fails. Documents, public or authenticated API reads, and video/audio/playback/upload requests never enter the worker cache. There is no offline catalog or media library.

Install UI is optional and dismissible. Routine service-worker updates surface only after a replacement worker is installed; users opt into reload. The worker also explicitly migrates the known unsafe v2 cache without reloading tabs and removes old AYIN cache versions on activation. Safe-area CSS supports notches/home indicators.

## Implemented platform surfaces

- Android mobile, Google TV and Fire TV: the existing [Kotlin WebView adapter](../platforms/android/app/src/main/java/net/ayin/shell/MainActivity.kt) supplies trusted-origin navigation, remote/Back handling, fullscreen and lifecycle bridges around the hosted Web product. Its system document picker accepts one supported video using a temporary read grant, without camera/broad storage permission or a persistent URI grant. Results stay bound to the initiating WebView/document; navigation or renderer replacement cancels its callback and fences late results. This video-only path does not support image, caption or CSV inputs; see [selection validation](../platforms/android/app/src/main/java/net/ayin/shell/VideoFileSelection.kt).
- iOS: [SwiftUI Home/login](../platforms/ios/AYIN/Views/HomeView.swift), native session handling and [AVPlayer/AVKit playback](../platforms/ios/AYIN/Player/NativePlayerController.swift). [Deep links](../platforms/ios/AYIN/DeepLinks/DeepLink.swift) open Watch/live natively; other accepted AYIN web routes use the existing [Safari view](../platforms/ios/AYIN/Views/RootView.swift). This is an implemented native viewer with bounded coverage, not a hybrid-shell candidate.
- tvOS: a [native SwiftUI viewer](../platforms/tvos/AYINTV/Views/TVRootView.swift) with Home, Search, My AYIN and Account, [catalog/channel/playlist/Creator TV routes](../platforms/tvos/AYINTV/Navigation/TVRoute.swift), and [AVPlayer/AVKit playback with caption controls](../platforms/tvos/AYINTV/Player/TVPlayerController.swift).
- Samsung Tizen and LG webOS: packaged hosted-web applications using the shared routes and platform bridges in [`platforms/tizen`](../platforms/tizen) and [`platforms/webos`](../platforms/webos).
- Roku: no client is present in the current platform tree; the historical later-platform plan remains separate.

## Readiness and remaining gates

Source support and native parity are separate. The current iOS Home has no Search entry, all-row continuation, explicit empty-content presentation or remote artwork. Its [playback model](../platforms/ios/AYIN/Player/PlaybackModels.swift) does not consume Web caption, chapter or series-next fields. No native Arabic resource catalog is present in the Apple targets. These are source/UI omissions requiring an explicit launch-scope decision or implementation, not just hardware/store checks. Android's existing video picker is likewise narrower than all Web upload inputs.

The [native contract evidence](AYIN_NATIVE_CONTRACT_ALIGNMENT_EVIDENCE.md) records the revision-aware progress and Android picker candidate, authored regressions and their limits. Validate the exact final candidate through the owning [iOS](../.github/workflows/ios-app.yml), [tvOS](../.github/workflows/tvos-app.yml) and [Android](../.github/workflows/android-shell.yml) workflows: unsigned builds, native units and the applicable simulator/emulator paths. A Web or Linux-only check does not establish native compilation or OS behavior.

Separately verify installed-PWA/Safari behavior, physical playback and remote focus, background/restore and network loss, real file-provider cancellation/late results, native progress review, signing, App Links/AASA with actual release identities, store metadata/privacy/submission/approval and native advertising-provider integration. Existing historical simulator/emulator evidence retains its original source identity; this document does not mark those final-candidate or external gates complete.
