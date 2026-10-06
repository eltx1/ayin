# Advertising lifecycle and mounted inventory

Bounded audit of the existing Web/PWA adapters on baseline `be799b902f859884a06de174da2ef55a9fceb5a4`. No ad account, provider configuration, production demand, consent classification, revenue rule or database schema is enabled or changed.

This records the first lifecycle slice. The later [trusted consent transition evidence](AYIN_ADVERTISING_CONSENT_TRANSITION_EVIDENCE.md) supersedes its snapshot-only source-contract gap. A production CMP/bridge and upstream delivery certification remain unconfigured/unverified.

## Demonstrated defects and correction

Six initial synthetic runtime assertions failed against the unmodified services:

- GPT defined/displayed a slot after its owner aborted during either script loading or the queued GPT command.
- GPT cleanup was not idempotent and queued render callbacks retained authority after cleanup.
- IMA attached its display container after `destroy()` while awaiting SDK loading.
- The second ad break started its manager twice because the first break's loader listeners remained registered.
- Already-queued IMA loader/manager callbacks could reactivate a destroyed request.

The existing GPT mount now accepts the placement's AbortSignal, checks ownership after SDK loading and inside the queued command, settles an aborted queued mount, and destroys its slot/listeners once. Runtime failures release partial slots and still reach the existing house/collapse fallback. A stable host exists before an already-loaded GPT API can display it. PageAdSlot checks ownership after awaited REQUEST telemetry and before fallback/error side effects. Abort cannot retract a provider network request already issued before cancellation.

Page placements now use the current pathname and stable MOBILE/DESKTOP/TV category as their existing decision session's key. Changes release the previous slot and requery existing server eligibility; pixel-by-pixel resizing within a category does not remount. The server remains authoritative for placement/device eligibility. No new targeting fields or consent sources are inferred.

IMA now fences asynchronous initialization with a generation, removes request-specific loader listeners on completion/error/destruction, ignores queued callbacks after settlement, and settles pending playback on destruction. It rejects overlapping breaks before a second provider request. Existing SDK error classification, content resume, tag restriction preservation, gesture initialization, session cap and telemetry contracts are retained.

AdEnabledAyinPlayer owns a session keyed only by videoId. Creator TV program replacement therefore receives fresh content/ad DOM references, decision state and pre/mid/postroll flags. A refreshed URL for the same video does not key-remount the player or its progress hook. Unmount fences delayed initialization, playback attempts, callbacks and telemetry. Existing Watch already keyed its player by videoId/Kids mode; no Watch page or progress/identity architecture is replaced.

## Finite placement inventory

These eight definitions originate in `packages/db/prisma/migrations/20260830002000_page_ad_placements/migration.sql`; all start disabled. A configured definition is not proof of a mounted placement or provider delivery.

| Key                      | Current mounted surface          | Product boundary                                                                                                      |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `home_top`               | Home, after ManagedHero          | Existing Home inventory, subject to server route/device/demand switches                                               |
| `watch_below_player`     | Ordinary Watch, below its player | Omitted for `kids=1`; the general slot unmounts on entry to Kids Watch                                                |
| `home_between_rows`      | Dormant                          | Discovery rows have no placement consumer; density/layout decision remains outstanding                                |
| `content_detail`         | Dormant                          | Movie/series detail currently has no slot; catalog existence does not activate ads                                    |
| `search_between_results` | Dormant                          | Search results have no placement consumer; no ads are added to search by this slice                                   |
| `channel_between_rows`   | Dormant                          | Public channel pages have no page-ad consumer; channel/Creator TV video inventory is separate                         |
| `tv_directory`           | Dormant                          | TV directory has no page slot; migration permits TV targeting but that is not physical-TV acceptance                  |
| `desktop_sidebar`        | Dormant                          | No global/sidebar consumer; wildcard configuration does not mount ads on Account, Studio, Admin, upload or auth forms |

Configured route patterns are checked against the supplied pathname. The original default patterns do not automatically authorize locale-prefixed paths; localized route targeting requires appropriate configured patterns. This audit does not expand routing or density policy.

Video consumers: ordinary Watch uses AnalyticsAyinPlayer → AdEnabledAyinPlayer → IMA; Kids Watch uses the general player/analytics without IMA. Creator TV uses the same AdEnabledAyinPlayer for progressive MP4 fallback. Its optional configured Google DAI SSB path uses LiveAyinPlayer separately. Public Live uses LiveAyinPlayer; an ad-mode/provider hook is not proof of a mounted client IMA adapter. No general page/ad player consumer was found on Kids directory, auth, upload, Studio, Admin or sensitive Account/finance forms.

## Consent, age and provider boundaries

No production call to `registerAdvertisingConsentProvider` exists in this source tree. The CMP/application bridge is an **unconfigured external integration**, and the unchanged runtime default is LIMITED_ADS. This absence is not evidence of a current personalized-ad leak. GPT retains the limited-script guard; IMA retains `ltd` and stronger server tag restrictions. Explicit CHILD/TEEN behavior remains covered by existing normalization and SDK enum/tag tests.

The current provider interface supplies a snapshot, without change subscriptions. GPT takes it when mounting; IMA reads it for each request; Creator TV snapshots it when mounted. A future real provider requires a bounded notification/subscription contract, mounted-request teardown/redecision rules, trusted age/profile/regional classification and provider verification before dynamic consent transitions can be certified. That source contract can be designed without enabling demand, but adding a fictional CMP or guessing user age is not a lifecycle correction. This slice does not claim live CMP withdrawal, account/profile transitions, DAI age-policy propagation or every backend decision/VAST/event path is certified.

Official SDK contracts checked 2026-10-06:

- [IMA AdsLoader](https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/reference/class/google.ima.AdsLoader): remove the same listener reference; destroy cleans loader state.
- [GPT reference](https://developers.google.com/publisher-tag/reference): slot display needs a DOM host; destroySlots releases registered slots.

## Verification

The focused synthetic runtime suite covers delayed script/command cancellation, immediate queued cancellation, partial-slot failure, idempotent cleanup, late SDK initialization, sequential pre/mid/postroll, overlap rejection, duplicate error settlement and queued callbacks after destruction. The device suite exercises desktop/mobile/TV category notifications and listener cleanup. Existing consent/age/error-classification tests remain unchanged.

Browser and final aggregate results are recorded after execution. Browser fixtures use synthetic SDKs, intercepted decisions/telemetry and explicitly isolated test data. They do not establish live Google fill, revenue, consent certification, native SDK delivery or physical mobile/TV readiness.

Final local acceptance: 24 focused runtime/consent/device checks; 774 Web tests across 116 files; Web TypeScript and ESLint; formatter/diff checks; own package/API compilation and Web production build. The production browser run passed all 16 player/HLS and Watch cases, including four new lifecycle regressions and the existing Kids Watch assertion of zero general ad/social requests. Creator TV's original component was separately restored for a baseline browser run: after its first preroll/midroll, a new program replaced the video element but did not start preroll (expected cumulative starts 3, observed 2). The final component passes the same sequence, then its new midroll/postroll, with correct video/slot attribution.

The first partial browser run was interrupted by a Chromium target crash while a simultaneous full lint process was killed. That run is diagnostic only; acceptance is the later complete 16-case run with Chromium isolated from broad checks. The test helper's initial pointer-click and encoded object-key assertions were also corrected before the confirmed baseline/final comparison. The same-video refresh check exercises a changed media URL under a synthetic media element; it does not certify signed URL issuance or physical decoder behavior.

## Confirmed CSP blocker, unchanged

An additional production-browser attempt to delay the real limited-loader URL found that `apps/web/next.config.ts` permits the standard GPT/IMA script origins but does not permit `https://pagead2.googlesyndication.com`. Chromium refuses the default limited `gpt.js` before its intercepted network request can run. This is a delivery/configuration incompatibility, not evidence that personalized demand was sent. The existing error/fallback path remains in force.

The narrow proposed correction is adding that official limited-loader origin to `script-src`. CSP is unchanged in this slice pending separate security-policy approval. No CSP bypass, personalized-endpoint substitution, wildcard expansion or live provider call is used. The blocked browser case and trace are retained in local review evidence; they are not counted as a passed late-script browser test. Delayed SDK/command cancellation is established by actual-service synthetic unit tests, and the browser's already-loaded SDK fixture separately proves DOM host ownership and teardown. Live loading/delivery remains blocked until the approved security policy and provider configuration support it.
