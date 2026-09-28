# Performance baseline and results

## Scope of the current evidence

This is a **limited Phase 2 production-build/HTTP comparison**, not completion of the master performance program. Both local builds used the same locked dependencies, Node 22.16.0 and explicitly synthetic anonymous API fixtures. Baseline product code is accepted main `912e64b3ef91644abe9b8c2475ea3faffb519597`; the after candidate's product source is published in PR #140. Its exact accepted head belongs in the master checkpoint, not this measurement label.

Each measurement counts the unique JavaScript files declared by initial HTML script tags and gzips those files at level 9. It excludes later dynamic imports and is not an observed browser/CDN transfer. Both production Web builds passed. There is no claim of real database latency, field Core Web Vitals, player/HLS startup, upload reliability or production traffic.

## Before and after

**Movies directory, `/movies`:** before 667,398 raw JavaScript bytes and 204,484 gzip bytes; after 669,923 raw bytes and 205,163 gzip bytes. Difference: **+679 gzip bytes (+0.33%)**.

**Movie detail, `/movies/fixture-film-1`:** before 646,387 raw bytes and 198,298 gzip bytes; after 666,473 raw bytes and 203,964 gzip bytes. Difference: **+5,666 gzip bytes (+2.86%)**. This URL belongs to an explicit local fixture, not a real production title.

**Home, `/`:** before 689,531 raw bytes and 211,629 gzip bytes; after 692,056 raw bytes and 212,308 gzip bytes. Difference: **+679 gzip bytes (+0.32%)**.

The directories render on the server without a new directory-specific client data loader. Translation/alias changes add a small common script cost. The formerly detached Movie detail gains the existing Viewer shell, navigation and bootstrap runtime, explaining its larger initial script set. This is a deliberate surface repair, **not a performance improvement claim**. The earlier placeholder is not a feature-equivalent catalog baseline. Phase 10 must review shared-shell cost and measure real user navigation/playback rather than treating these sizes as sufficient acceptance.

## Other observed checks

Local production HTTP checks returned 200 for all four index families in English/Arabic and the synthetic Movie detail. Legacy aliases returned 308 with locale/query preserved. The served manifest returned `/upload` and `/tv` shortcuts. These inputs are synthetic and do not verify real catalog inventory, provider state or production deployment.

Local Chromium refused navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser-policy bypass was attempted and no local screenshot, overflow, visual or accessibility acceptance is claimed. Real database/browser acceptance and screenshot review must come from the repository CI workflows.

## Required next measurements

Verify current official Core Web Vitals guidance when Phase 10 executes. Collect representative field/lab LCP, INP and CLS, complete route JavaScript including dynamic modules, real request counts/TTFB, CPU/network constraints, query counts/plans/latency and connection use, discovery/search, per-series episode hydration, player/ABR/MP4 startup, upload preparation/concurrency/retry, Admin/Studio first-use and safe PWA cache/startup behavior.

Do not add indexes, replicas, sharding or new stores based on these limited bundle numbers. Do not claim the redesign's full performance gate is green without those measurements. Record production, local fixture, CI browser, emulator and physical-device evidence separately.
