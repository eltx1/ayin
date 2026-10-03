# Performance baseline and results

## Evidence authority

This is the current performance evidence index, not completion of master Phase 10. AYIN remains the canonical Web/PWA with unchanged shared backend/media/security boundaries. Exact accepted source/gates/deployment are in [the master checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md).

Full earlier results and methodological corrections through accepted #145 are preserved byte-for-byte in [historical performance results](PERFORMANCE_RESULTS_THROUGH_145.md). Historical pending statuses are superseded by the current checkpoint, but measurements retain their original source/toolchain/fixture qualifications. Do not compare different measurement methods as though they were the same metric.

## Phase 4C — focused content editor, 2026-09-29

**Baseline:** accepted main `02e37ce7186eb72f62c940847c630dbc5c8ef159`, tree `02df2edcbba42c546930cda67c6ccf7512dd35d8`. **After:** reviewed implementation `2ebc0c119e68437452a4bee3306ce7be62c784d2` on `web-pwa-phase-4c-content-editor`; final documentation/merge/deployment are recorded separately in the checkpoint. Both same-environment production Web builds completed with exit 0. Local Node22.16.0/restored compatible Web tools are not the fresh frozen CI Node24 graph.

**Method:** deduplicate the route's `entryJSFiles` and `entryCSSFiles` from the built Next client-reference manifest. Gzip each selected file at level 9 and sum. This is selected entry-file aggregation, not all dynamic imports, full browser/CDN transfer, hydration time, field Core Web Vitals or database/API/player/upload latency. The source was restored with verified archive, every tracked hash and exact Git tree; detailed source and test evidence is in [Phase 4C evidence](AYIN_PHASE4C_EVIDENCE.md).

| Route           | Before gzip JS | Final gzip JS | Before gzip CSS | Final gzip CSS |
| --------------- | -------------: | ------------: | --------------: | -------------: |
| Studio Content  |          44001 |         49700 |           16669 |          17016 |
| Studio overview |          40381 |         40420 |           16669 |          17016 |
| Admin overview  |          45803 |         45820 |           11494 |          11655 |
| Browse          |          43763 |         43763 |           21075 |          21236 |
| Home            |          50194 |         50194 |           14361 |          14361 |

An initial global-dictionary implementation added 2025 compressed entry bytes to unrelated Home/Admin/Browse JS. It was measured and replaced with route-scoped vocabulary on the existing locale context. Final values above include that correction. Content adds 5699 bytes for real editor/state/translation behavior; no speedup is claimed. UI mounting only one editor and eliminating filter-driven draft resets are product fixes, not quantified memory/CWV improvements.

The small shared CSS increases are recorded, not hidden. Existing #144/#145 Comments/Support/Playlist styles are not removed to make a bundle comparison look better. No new dependency, broad package upgrade, server index or cache behavior was introduced by this phase.

## Earlier retained evidence and scope

#140's HTTP/HTML script comparison showed Movies/Home +679 gzip bytes and Movie detail +5666 when restoring the Viewer shell. #143 and #144 introduced shared design primitives and route-specific views with explicitly measured selected-entry costs. Reconciled #145 preserved both domain implementations and corrected source/dependency-layout comparability. These complete measurements, CSS results, source IDs and limits remain in the historical report; its values are not silently overwritten by a new baseline.

## Required complete performance program

Recheck current official Core Web Vitals guidance during Phase 10 and collect representative LCP, INP and CLS with field/lab distinctions, full initial/dynamic route JS, CPU/network/TTFB/request/image/font cost, hydration, real API latency and payload sizes, query counts/plans/index evidence, connection pressure, discovery/search, per-series hydration, HLS/MP4 startup/buffering/ABR, upload preparation/concurrency/retry/reliability, Admin/Studio first-use, and privacy-safe PWA startup/cache effects.

Do not add indexes, replicas, a new storage system or an architectural rewrite from these limited entry-size measurements. Test runtime/CI browser timings are not production traffic performance. Browser screenshot dimensions are not device certification. No complete performance, installed-PWA, provider, native-device or store-approval claim follows from a passing local build.

The request-payload repair2677ecb was rebuilt against the same restored baseline and reproduced the earlier entry sums. The final table above was remeasured after2ebc0c1's heading/breadcrumb/mobile-label corrections; its small shared-byte changes are recorded. Exact-head CI quality/browser/security/inventory and actual visual review passed for that source. The full desktop image intentionally follows an action scroll; sticky positioning in a full-page image is not a runtime-latency or layout-shift measurement.

## Phase4D candidate — native confirmation adoption

Baseline accepted/deployed main `d3484c6ec4d256effb9f440b882428a42ce0aea7`, exact tree85062e80638af9b1ce779905476c5600490beb68; after is the locally reviewed confirmation candidate. Two same-environment local production Web builds passed. Method remains deduplicated Next entryJSFiles/entryCSSFiles, each gzip level9, not full transfer/dynamic imports, CWV, backend or playback/upload timing. Restored local Node22/tooling is not CI Node24/frozen proof.

| Route           | Before gzip JS | After gzip JS | Before gzip CSS | After gzip CSS |
| --------------- | -------------: | ------------: | --------------: | -------------: |
| Studio Content  |          49968 |         50986 |           17000 |          17157 |
| Studio overview |          40567 |         40700 |           17000 |          17157 |
| Admin overview  |          45985 |         46120 |           11642 |          11799 |
| Browse          |          43929 |         44064 |           21222 |          21379 |
| Home            |          50347 |         50482 |           14351 |          14351 |

Content adds1018 compressed entry bytes for real decision UI/state; common routes add133–135 bytes from shared focus behavior. Route-local labels avoid a new global vocabulary dictionary. CSS increments are explicit. No performance improvement is claimed; full Phase10 measurements remain open. Preserve old results rather than treating small environment-dependent baseline differences as regressions or speedups across unrelated measurements.

## Moderation queue entry cost — measured2026-10-03

Baseline accepted #174 `022140c5027333b525c49c221382878377938e41`, tree `6987f874cf594f7e45817f890cc99f0403aab222`. After is the reviewed #173 UI applied to that baseline, tree `87d6db59431ea7ab9685d4a96236f7be927b6805`; it exactly matches accepted merge `8397cdcdf23b3a6a45226195f213e8c945cc8d15`, preserving #174. Both actual Web production builds passed on the same local Node24.19.0 / Next16.3.6 / pnpm11.24.0 dependency graph, with existing Edge instrumentation warnings. This same-source local measurement is separate from frozen CI and deployment evidence. No dependency/lockfile changed.

Method: deduplicate entryJSFiles and entryCSSFiles from each actual Next client-reference manifest, gzip each selected file at level9 and sum. It measures selected entry files, not all dynamic imports, actual CDN/browser transfer, hydration, CPU, CWV, API/query latency or player/upload runtime. [Before details](performance/2026-10-03-moderation-entry-before.json) and [after details](performance/2026-10-03-moderation-entry-after.json) retain tool/build IDs and every selected file size/hash. The checked-in utility makes the calculation repeatable and rejects unsupported inlined CSS rather than miscounting it.

| Route            | Before gzip JS | After gzip JS | Before gzip CSS | After gzip CSS |
| ---------------- | -------------: | ------------: | --------------: | -------------: |
| Admin moderation |          44534 |         48674 |            8321 |          27258 |
| Admin overview   |          51388 |         51394 |           27108 |          27258 |
| Studio overview  |          43294 |         43294 |           32466 |          32616 |
| Upload           |          65259 |         65259 |           27425 |          27575 |
| Browse           |          45126 |         45126 |           27425 |          27575 |
| Home             |          53346 |         53346 |           27425 |          27575 |

The queue adds4140 selected gzip JS bytes for validated bounded reads, role/query state, recovery, full text disclosure and scoped EN/AR. Admin overview adds6 JS bytes from the optional collection signal helper; the measured Viewer/Studio/Upload JS does not change. Moderation now imports existing shared UI primitives, so its selected CSS includes substantially more existing shared styling (+18937), not merely its new local rules. Other sampled routes add150 selected compressed CSS bytes due to the generated shared CSS grouping. This cost is explicit; no speedup or complete Phase10 acceptance is claimed. No existing style is removed to manufacture a favorable comparison.

Reproduction after a Web build from the repository root:

```bash
node scripts/measure-next-entry-bytes.mjs apps/web/.next \
  /admin/moderation/page /admin/page /studio/page \
  '/(viewer)/upload/page' '/(viewer)/browse/page' '/(viewer)/page'
```

Current primary guidance rechecked2026-10-03: [Web Vitals](https://web.dev/articles/vitals) and [Chrome performance reference](https://developer.chrome.com/docs/devtools/performance/reference). LCP/INP/CLS are experience metrics evaluated against representative real visits; local entry-size sums are not them. Field assessment and controlled CPU/network/interaction lab measurements remain separate required work. Do not label a page compliant from these byte results or claim INP from a load without interaction.
