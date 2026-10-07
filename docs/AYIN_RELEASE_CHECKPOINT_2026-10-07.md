# AYIN Web/PWA consolidation: release checkpoint

Verified on 2026-10-07. This checkpoint records the completed Web/PWA integration release and the remaining external gates.

## Release identity

- Pull request: [#266](https://github.com/eltx1/ayin/pull/266).
- Reviewed candidate: `427e24f8fcc2fd7c10bce4baeeb30dc2d24b23c1`.
- Candidate tree: `35bbffe309b53fe531a381ea3926931701df277d`.
- Merged and deployed main commit: `debf276555fb30ab163ed1d4f59dc5e77c778208`.
- Exact main validation: [main quality run 37656093310](https://github.com/eltx1/ayin/actions/runs/37656093310), successful; the merged tree matches the reviewed candidate exactly.
- Deployment and edge synchronization: [deployment 37658059723](https://github.com/eltx1/ayin/actions/runs/37658059723), successful on attempt 2 with unchanged pinned SSH trust; [edge synchronization 37660972602](https://github.com/eltx1/ayin/actions/runs/37660972602), successful.
- Public Web health and rendered smoke: Cloud Chrome observed `ayin-web`, `status: alive` and the exact deployed SHA at `https://ayin.stream/api/health`; the hydrated Home navigation, hero, account actions and policy links were inspected. Verified at 17:45–17:48 UTC.

## Product behavior

- Watch and Clips retire obsolete media when account or profile authority changes. A fresh authorized source is required before restoration; retired callbacks cannot overwrite the current owner's progress.
- Advertising editors preserve acknowledged outcomes and scoped drafts across failed or delayed reads. They do not silently replay uncertain writes. Authority is rechecked after audit insertion inside the mutation transaction.
- The integrated catalog, import and Product Controls surfaces retain native fields, explicit validation, lossless edits and bilingual keyboard access. Category removal at the 100-item cap returns focus after the replacement controls commit.
- Existing Web/PWA and native clients remain the product architecture. Shared playback policy and native progress contracts are validated together. The tvOS lifecycle expression is split into typed helpers without relaxing its authority guards.
- Android CI now tolerates transient post-boot ADB reconnects only during its existing idempotent setup operations, within a 90-second bound. Application instrumentation is not retried or ignored by that setup recovery.

## Acceptance

- [Final browser run 37651149814](https://github.com/eltx1/ayin/actions/runs/37651149814): 523 ordinary cases, 10 PWA lifecycle/cache cases, 13 dormant-recovery cases, 18 caption journeys and 14 decoded-player cases passed. Two AVC capability cases were explicitly skipped.
- [Final quality run 37651150077](https://github.com/eltx1/ayin/actions/runs/37651150077): formatting, lint, types, production builds, 1,043 Web units, 815 API units, 1,996 API integration tests, four database integration tests and the shared/runtime suites passed. Production audit reported no known vulnerabilities.
- [iOS](https://github.com/eltx1/ayin/actions/runs/37651149879): 47 tests passed. [tvOS](https://github.com/eltx1/ayin/actions/runs/37651149765): 44 passed. [Android](https://github.com/eltx1/ayin/actions/runs/37651149900): all four jobs passed, including 12 emulator instrumentation tests, deep links and TV controls.
- Security, deterministic source inventory and TV Web package gates passed.
- Final CI Product Controls and Advertising original-image archives were downloaded, hash-verified and inspected.

Focused browser evidence additionally covers retired-owner events, metadata readiness, real account/profile transitions, held acknowledgments and database conflict ordering. B saves independently while A's acknowledgment is held; a newer 53-second checkpoint defeats a delayed 37-second checkpoint with HTTP 409. Revoked media cannot send a later checkpoint.

Original EN/AR responsive captures were inspected for the changed editors, Product Controls and player states. Browser, unsigned simulator and emulator results are separate from physical-device certification.

All five diagnosed legacy progress assertions were updated to address the actual retired or newly authorized media element. The production protections were preserved. Earlier failed runs remain part of the evidence history.

## Source continuity

This release includes the published candidate ancestry from #263 and the reviewed #265 integration. #261 is an ancestor. The divergent tips of #260 and #262 contain the same DAI fixture assertion correction already present in the candidate; their inclusion was verified by content.

The independently shipped Sharp correction from #264 is retained unchanged. Its preceding verified main release was `0cb98be3aa243a5ade2091d3865e6990f6a84cbc`.

GitHub marks #261, #263 and #265 merged through the included ancestry. #260 and #262 remain open; their equivalent correction is present in the merged source. Their branches and review history were preserved.

## Measured runtime

Twenty-four controlled loopback samples completed on the identified local candidate `8d60f3c261805ccf797f33435b5b25f1a58442db`, tree `be298cbaeadd550ef63ea612c84639b7b9732963`: twelve Search/Watch readiness observations, six decoded startup observations and six upload/queue observations. Later narrow corrections were not presented as a matched performance comparison.

These measurements use synthetic data and controlled browser profiles. They do not establish field percentiles, physical-device playback, production R2 throughput or a universal speedup. Publication of the optional new raw evidence inventory remains incomplete; it is not a release gate or a claimed published artifact.

## Bounded source continuation

1. An isolated iOS discovery continuation is prepared, but is not included in the deployed application. It adds existing Web Search/Home continuation, a Kids-safe Web entry, an explicit empty state and synchronous profile-scope concealment. The [eight-file patch](recovery/2026-10-07/ios-discovery-web-fallbacks.patch) preserves that source for review. Source review, formatting, property-list parsing and six fixture variants passed; its 16 new XCTest methods have not run on macOS. Next: apply on current main, run unsigned native CI and review the resulting behavior before merging.
2. Reconcile the active master ledger and operating documents with this verified release, keeping the external gates below explicit. The original master prompt was not recovered verbatim; the existing 17-workstream index is not proof that every exit condition is closed.
3. Resolve native launch parity through the existing Web surface or a bounded native adaptation. Remaining source omissions include native artwork, captions/chapters/series-next adaptation and an Arabic resource catalog; Android upload selection remains video-only. These are source/product-scope questions, not merely hardware certification.

Further performance changes require attribution of the observed initial/background RSC request churn before editing code. The completed controlled samples did not establish a user-visible bottleneck or a causal typing issue; this is a bounded investigation candidate, not an unfinished optimization claim.

## Remaining gates

- Durable R2 issuance remains dormant/unsupported until actual provider settlement and cleanup verification is supplied and validated.
- The proposed Google loader CSP expansion is not enabled by this release. Commercial provider/CMP setup and real age/consent/device acceptance remain separate.
- Installed PWA, physical Safari/iOS/Android/TV behavior, production audio/AVC playback and transport-loss behavior need their named device observations. The controlled browser's unavailable AVC cases are not certification.
- Native launch parity, signing identities, App Links/AASA, store metadata and submissions remain distinct from unsigned builds. Android's current picker scope is video-only.
- Representative field performance and capacity evidence remain separate from synthetic laboratory results.

This checkpoint records the verified release and its boundaries. It is not a blanket completion claim for every historical master workstream. Existing historical evidence retains its original source and run identities.

## Retained deployment proof

The downloaded proof files both identify `debf276555fb30ab163ed1d4f59dc5e77c778208`. Archive bytes were verified against the GitHub artifact digests before inspection:

- Deployment artifact `11501595176`: SHA256 `9b3da36eb8a68d838db74b338fc54ea8fefacb2092bcdb771336930415fa4eb2`.
- Edge artifact `11500830900`: SHA256 `f7129a9f783e9d274d36765796ab1dc5b27633043cec1227fdad7ce59eab500a`.

The first deployment attempt ended during SSH key scanning before remote activation. The unchanged retry verified the same trust pin and completed normally. No credentials or security settings were changed for recovery.

Prepared iOS patch SHA256: `c7e7905b250083aaef3537c8dcfdfbc32697f688cb24d88eb9e88d0caaba6078`. The patch is retained as documentation and has not been applied to the released source.
