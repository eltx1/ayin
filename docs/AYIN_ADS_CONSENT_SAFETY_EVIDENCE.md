# Advertising consent safety review

Focused master Phase11/14 correction; whole advertising/native/legal/provider acceptance remains open.

## Reproduced implementation failures

On unchanged source, two regression tests failed: a throwing consent provider escaped the boundary, and Google IMA consent rewriting deleted existing npa/ltd restrictions. The latter allowed a client consent decision to weaken publisher/server tag restrictions. The provider boundary also accepted malformed runtime objects despite its TypeScript interface.

The correction validates runtime snapshots and uses the existing limited-ads safe default on errors/invalid input. It returns a fresh validated snapshot, with a frozen safe default. GPT loader/privacy helpers and IMA use that validated boundary. IMA may add restrictions but never deletes existing tag parameters, including age, child-directed and restricted-processing flags. It still leaves third-party tags unchanged. No CMP, age verification or personalized consent is invented.

## Official sources reviewed 2026-10-03

Further actual-source review found video-ad decisions checked publication/visibility but omitted playback policy and removed/inactive channels. A third regression failed on unchanged backend: the ad tag was returned when the policy stub denied availability. Decisions now use existing VideoPolicyService and trusted edge territory, with hard removed/channel/publication boundaries before selecting demand. FORCE_ALLOW remains the existing policy behavior and cannot bypass the hard channel/publication checks. Three real AppModule/PostgreSQL tests cover expired/blocked policy, authenticated versus spoofed region, allowed unlisted content, removed/private/inactive boundaries and the emergency switch. Local API379 units passed; PostgreSQL execution must pass in full CI. Existing privileged write/audit/schema/provider activation contracts are unchanged.

- [IMA HTML5 consent](https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/consent): npa=1 requests nonpersonalized ads; tfua=1 marks under-age-of-consent treatment. This is distinct from child-directed classification. Browser default personalization must not substitute for a resolved restrictive decision.
- [GPT reference](https://developers.google.com/publisher-tag/reference?hl=en): manual limitedAds requires the limited-ads script URL; privacy settings include separate child-directed and under-age controls. Existing AYIN limited-script guard is preserved.
- [Google app web-content frames](https://support.google.com/admanager/answer/6310245?hl=en): registered WebView API for Ads and supported browser frames are distinct integration options. A generic unregistered native WebView is not certified by passing Web tests.
- [Android WebView API](https://developers.google.com/admob/android/browser/webview/api-for-ads?hl=en) and [iOS WebView API](https://developers.google.com/admob/ios/browser/webview/api-for-ads): register each WebView/WKWebView with the applicable Mobile Ads SDK. Existing native adapter review must follow the remaining Web/PWA acceptance gates; this correction adds no native SDK or device claim.

## Validation and explicit remaining work

The first PostgreSQL run37087256813 failed two override fixture inserts because their randomly generated actor IDs violated the migration-enforced account foreign key. This was a test setup mistake: the corrected fixture creates a real registered account and uses that stored actor ID. Production constraints and denial expectations remain unchanged; corrected final-head checks must pass. Region-sensitive decisions also explicitly return private,no-store, verified by integration response headers.

The two original regressions passed after correction. Local Web297 unit tests/lint/types passed after building workspace packages; the first whole-unit attempt failed because @ayin/ui had not been built, then the required build recovered all suites. A new browser journey captures the actual adTagUrl delivered to an explicit IMA harness through the real Watch/player consumer: existing age/privacy flags remain and limited-ads default is added, with content resuming on the same video element. The harness is not real Google fill or physical-device playback evidence. Exact-head full CI/browser/security/inventory remain pending.

Whole Phase11 must still reconcile direct/house/GAM/GPT/IMA/DAI/SSAI consumers, real CMP regional integration, age/child state and profile switching, video-decision availability/trusted-region enforcement, native frames, labels/frequency/click boundaries and provider test/production activation. Kids Watch excludes general ad consumers in accepted #162; this alone does not certify all Kids routes or the backend advertising endpoints. Existing kill switches and actual earnings/provider truth are preserved. No schema, finance or provider activation changes.
