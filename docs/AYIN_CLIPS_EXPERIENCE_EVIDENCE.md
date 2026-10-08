# AYIN Clips Web/PWA experience evidence

Prepared 7 October 2026, with the release dependency refresh recorded on 8 October.
The browser and laboratory results below describe the original Clips candidate
before that refresh. Exact pull-request CI, refreshed-runtime validation, merge and
deployment proofs are separate release gates; these local results do not establish
that production is running them.

## Source and scope

- Accepted foundation: `947d0cb9a863ecb095a987c3b7fd9c8497e024cd`, tree
  `ccbed13c5d4c68f7636911c405ad97f73e99f1be`.
- Measured and browser-tested implementation tree:
  `c5116d892cf3b403fc3b41832621250604f4761b`.
- Local test commit: `3d4625616b7a3c3b3f779b5b36c49f91608ddf2e`.
- Production-build ID: `G5EuxOFxMPBMDSPMlA9bN`. All 1,973 tracked source files in
  that archive were byte-verified. This validation document is added afterward;
  the application and test files are unchanged from the measured implementation.
- The original measured candidate added no dependency changes. The release refresh
  below updates the existing Next.js patch version. There is no backend, schema,
  durable-media transport, service-worker cache, provider, credential, access,
  historical accounting or native/store change.

The implementation and bounded-session contract are described in [CLIPS.md](CLIPS.md).
Important changes are measured viewport geometry, one active media owner, three
resident articles, authored controls/native fallback, identity-safe optional capabilities,
full Details, EN/AR input/focus behavior and bounded in-memory return state.

## Release dependency refresh: 8 October

The first exact-head production audit rejected the existing Next.js 16.3.6 pin for
[GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), an image
optimization SSRF advisory. The minimal release patch moves Next.js and its ESLint
configuration to the patched 16.3.8 release and preserves the existing sharp 0.35.5
override under the new Next.js selector. It does not suppress the audit or broaden
image origins, permissions or security settings.

The final independent review also found that optional source-key compatibility
could mask verified Kids narrowing when Watch selected a newer source for the same
video. The release orders the authoritative audience check before optional source
checks. A focused regression combines both changes, and the actual-API browser
journey now changes the owned fixture source while narrowing its profile to Kids.

Full CI also exposed a platform-font-sensitive shared-header overflow at 320px
with 200% text. The release reserves space for the brand and menu, bounds the
action column, and permits the Create / Upload label to wrap. EN/AR regression
checks require all three header targets to remain reachable at normal and enlarged
text sizes; hiding overflow is not the remedy.

The original 16.3.6 measurements remain historical evidence for the Clips changes;
they are not exact-runtime performance claims for the patched release. The patched
head must pass fresh frozen-lock, audit, quality and full browser checks, with its
own runtime measurements, before merge. PR release evidence records those results
separately from the distributions below.

## Automated acceptance

| Gate                                          | Result                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Root formatting                               | Passed                                                                                            |
| Root lint                                     | Passed, including Web Next/React rules                                                            |
| Root typecheck                                | Passed                                                                                            |
| Root unit/schema tests                        | Passed; Web 1,153 tests/143 files, API 815/121; package tests and Prisma schema validation passed |
| Production build                              | Passed with pinned dependencies and byte-verified source                                          |
| Focused Clips browser suite                   | 90 passed, 1 explicit AVC skip, 0 failures/flaky retries                                          |
| Navigation/locale browser suite               | 10 passed                                                                                         |
| Real-service-worker PWA lifecycle/cache suite | 10 passed                                                                                         |
| Total focused browser acceptance              | 110 passed, 1 skipped                                                                             |

The existing root commands were used, with the pinned Corepack/pnpm toolchain.
Local builds set `CHECKPOINT_DISABLE=1`, the pinned Prisma version's supported
opt-out for unrelated optional checkpoint traffic. Production integration, security,
inventory and full browser aggregation remain owned by the exact-head repository CI.

The browser suite covers:

- Actual decoded synthetic media, authored play/pause/mute/seek, native UA control
  geometry and fullscreen fallback, buffering/retry, reduced-motion changes and Save-Data.
- Rapid uninterrupted keyboard navigation, native wheel navigation, and trusted
  emulated Chromium touch swipes, reverse swipes, horizontal range dragging and panel
  scrolling. Emulated touch is not physical-device certification.
- Opening/closing Details and the shared menu, pause intent, focus restoration,
  ordinary browser history, clipboard denial and neutral native-share cancellation.
- Same-owner page-two/17-second restoration, creator-route Back, explicit zero rewind
  with a held progress read, ended restoration, authored/native Replay and no duplicate
  tail completion after remount.
- Account/profile/Kids changes, synchronous concealment/source release, retired
  callbacks, late reads/writes and authoritative progress provenance.
- Classified server identity failures and a valid same-video response reporting a
  newly narrowed Kids audience; optional capability reads cannot create an automatic
  revalidation loop. Ordinary unplayable failures remain ordinary unavailable states.
- Continuation, retry, 120-item session boundary, explicit fresh-feed reset and cleanup.
- Real service-worker lifecycle and cache exclusions, with no new media/private caching.

### Codec boundary

The real AVC MP4 test is explicitly skipped because this Chromium runtime reports no
AVC support. The decoded VP8/WebM tests passed. Existing specialized caption/player
CI and physical AVC/audio/device acceptance must remain separately reported; this
record does not convert an unsupported codec into a pass.

## Visual and accessibility evidence

Actual viewport pixels were inspected in English and Arabic at 360×800, 390×844,
768×1024, 1440×1000 and 844×390, before and after selection. Additional browser tests
cover 320px reflow, 200% root text enlargement, long handles/titles, 20,000-character
Arabic descriptions, dialog scrolling and real pointer hit targets.

At enlarged text in short landscape, the stage permits ordinary document scrolling
and retains real video space rather than clipping wrapped controls. Normal landscape
keeps a two-column media/details layout. The final enlarged-text probes observed
approximately 146px phone and 288px landscape video heights with reachable controls.
This is text-enlargement testing, not proof of every browser/OS zoom or keyboard mode.

Separate EN/AR forced-colors probes inspected visible controls/focus and verified ten
native-wheel advances per locale: 648px card/feed stride, no accumulated drift, one
media element and retained focus. Native controls remain available as a fallback.

The fixture's synthetic color bars provide real decoder evidence and bright/dark
frames, not representative creator-film or production-media acceptance. Primary text
and controls use opaque surfaces, keeping their contrast independent of the footage.

## Resource evidence

A real decoded 100-item forward traversal and return exercised 199 activations:

- Maximum 3 article nodes, 1 media element and 1 playing element.
- Zero observed simultaneous playback; 192–200 live DOM elements in the acceptance run.
- Explicit fresh-session reset and route exit release the prior decoder; route exit
  leaves zero media elements.
- No video request for unvisited/offscreen items in the resource test. Save-Data starts
  without an automatic active-video transfer in the tested Chromium runtime.
- The baseline retained 20 source-attached videos initially and 100 after traversal,
  with live DOM growing from 267 to approximately 747.

These are bounded DOM/media observations, not a transport byte ceiling or leak-free
certification. Non-GC heap observations were mixed; no blanket heap-reduction or
memory-plateau claim is made. Browser HTTP range/cache behavior can cause re-downloads
when revisiting an evicted video; no video persistence or range proxy was added.

## Matched laboratory comparison

Both sources used production Web/API builds, real isolated PostgreSQL/API reads,
the same synthetic VP8 WebM (30 seconds, 96×160, 10fps, 343,136 bytes), and a real
loopback HTTP range server. No media prototype mocking or response interception was
used for the timing measurements. Fixture SHA256:
`0d329659ec017e0ea1c4ecadcaa26dc1b74a8bdbf8b5bfc5f99866b9761fca5f`.

Playwright 1.55.1 used Chromium 140.0.7339.186. Desktop was 1440×1000, normal CPU,
unthrottled network. Constrained mobile was 390×844, 4× CPU slowdown, 150ms latency,
200,000 B/s download and 96,000 B/s upload. There were ten measured samples per
source/profile/cache condition, with explicit warm-up. Cold and warm are separate;
service workers were blocked for these timing runs and tested separately above.

The next-item journey is trusted keyboard input. Native touch/wheel correctness is
separate evidence. It is not a measured distribution of physical finger swipes.

### Median decoded-frame timings, milliseconds

| Condition               | Baseline first | Candidate first | Baseline keyboard-next | Candidate keyboard-next |
| ----------------------- | -------------: | --------------: | ---------------------: | ----------------------: |
| Desktop cold            |            328 |             273 |                    322 |                      29 |
| Constrained mobile cold |          4,276 |           3,325 |                  8,079 |                     471 |
| Desktop warm            |            224 |             157 |                    331 |                      37 |
| Constrained mobile warm |          1,574 |           1,179 |                    386 |                     132 |

All 40 candidate samples passed. No median startup/next regression crossed the
review trigger. Maximum observed input-to-active feedback was 98ms; maximum measured
next-action long task was 82ms, below the proposed 200ms review budget. These are lab
observations, not field LCP/INP/CLS percentiles or a claim of competitive superiority.

### Transfer tradeoffs

Observed media body bytes by next-item + 1 second:

| Condition               | Baseline bytes | Candidate bytes |
| ----------------------- | -------------: | --------------: |
| Desktop cold            |        572,433 |         686,272 |
| Constrained mobile cold |      2,178,378 |         349,842 |
| Desktop warm            |         13,307 |         686,272 |
| Constrained mobile warm |        326,506 |          75,272 |

The desktop increases are retained in the report. Earlier completion of two active
fixtures and media range/cache behavior affect this fixed observation cutoff. Warm
means cache enabled plus a primer, not guaranteed cache hits; the fixture range server
has no ETag. These observations do not establish universal byte savings on production
CDN/media or an enforced download ceiling. Counting only completed requests would
understate the baseline's ongoing mobile transfers.

Cold JavaScript body transfer rose from 195,403 to 205,775 bytes: +10,372 bytes (+5.3%).
Decoded JavaScript rose from 648,803 to 681,536 bytes (+32,733; +5.0%). Both profiles
made 14 script requests. Warm script transfer was zero for both sources.

This crosses the proposed paired JavaScript-growth review trigger. The bounded Clips
feature accepts that explicit tradeoff for accessible authored controls, safe playback
retirement, capability/identity fencing and bounded residency, with no new dependencies.
The same-profile startup/next measurements improved. This is an exception for the
changed Clips experience, not permission for unrelated route payload growth.

## Held gates and rollback

Physical iPhone/Android browser and installed PWA, safe-area/virtual-keyboard behavior,
VoiceOver/TalkBack, representative AVC/audio/Bluetooth interruption, device battery/heat,
production creator-media/CORS and native/store/provider acceptance remain held.
Cross-origin caption transport and secure inline comment lifecycle are not fabricated;
real Watch fallbacks and their limitations remain explicit in the product contract.

Rollback should revert this presentation/controller changeset while retaining the
accepted foundation, Viewer authority, progress revision/seek rules, media integrity,
consent, policy and backend fixes. It must not roll back historical financial records
or alter provider/security configuration.
