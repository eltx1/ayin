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

## Phase 4A foundation comparison — 2026-09-29

Both local production Web builds succeeded on Node 22.16.0 with identical restored Web dependency versions. Before is the exact accepted tree `89f2201616e3c52e87a6fe96e31ea8bb4f64f02b` (main `96bb5e3`); after is the Phase 4A candidate. This comparison sums unique JS/CSS paths in each route's `page_client-reference-manifest.js` entry, gzipping individual files at level 9. It is **not** the older Phase 2 HTML-script method, an observed browser/CDN transfer, complete dynamic imports, field CWV or production performance. Do not compare numbers across these different methods.

**Movies/Series/TV/Creators directories:** initial-entry JS gzip 38,267 → 38,841 bytes; CSS gzip 17,847 → 21,107 bytes.

**/browse:** initial-entry JS gzip 39,097 → 39,153 bytes; CSS gzip 9,013 → 11,527 bytes.

**Home:** initial-entry JS gzip 45,412 → 45,571 bytes; CSS gzip 17,847 → 14,351 bytes.

**studio:** initial-entry JS gzip 36,335 → 37,383 bytes; CSS gzip 13,235 → 16,814 bytes.

**studio/playlists:** initial-entry JS gzip 36,406 → 37,435 bytes; CSS gzip 15,155 → 16,814 bytes.

**admin:** initial-entry JS gzip 41,809 → 42,872 bytes; CSS gzip 7,948 → 11,527 bytes.

**/watch/[slug]:** initial-entry JS gzip 52,551 → 52,617 bytes; CSS gzip 17,847 → 14,351 bytes.

The new primitives do not fetch data; only the image-error leaf adds client behavior and no replacement image request. These small build deltas do not establish a speedup. Existing backend/query/upload/player logic is unchanged; complete laboratory/field/network/DB/startup measurements remain the later performance phase. Source/CI validation and screenshots remain separate gates.

## Phase 4B data/form candidate comparison — 2026-09-29

Both local production Web builds passed with identical in-root restored Web dependencies and Node 22.16.0, using the same local API/media environment values. Before is accepted main `2b7ea943f13fb9acfde542c820a5b93ce2e81ce6` (tree `7038c96e1aeebe4e74bccc5c7ac64ac86ace86d9`); after is the current Phase 4B source candidate. As in Phase 4A, sum unique JS/CSS entry paths in each route's `page_client-reference-manifest.js`, gzipping each file at level 9. This is not field performance, actual transfer, complete dynamic imports, hydration time or CI's exact frozen dependency/toolchain acceptance.

**Studio Comments:** entry JS gzip 36,034 → 39,980 bytes; CSS gzip 16,814 → 17,556 bytes.

**Studio Support:** entry JS gzip 36,179 → 40,126 bytes; CSS gzip 16,814 → 17,556 bytes.

**Home:** entry JS gzip 47,368 → 49,121 bytes; CSS gzip 14,351 → 14,351 bytes.

**Admin overview:** entry JS gzip 42,853 → 44,738 bytes; CSS gzip 11,527 → 12,380 bytes.

New feedback translations in the shared typed resources contribute to common-entry cost; native form/table/disclosure, bounded filtering and independent request states contribute to the changed Studio entries. These additions are explicitly reported, not a speedup claim. Filtering operates on the already-loaded latest-100 snapshot, adds no requests or backend queries, and never pretends to search all comments. The full performance phase must measure actual transfer/hydration/latency and assess route-local translation splitting. No new dependency, video/player runtime, database index or caching scheme is introduced.

An initial local baseline build failed because the restored cache used node_modules symlinks outside Turbopack's root. Materializing those cached directories inside the isolated local build root resolved the tooling layout; no network/browser policy or application constraint was bypassed. Both successful builds use the same corrected in-root layout. Local builds do not replace the final pinned CI, browser/visual, API/security or deployed-SHA gates.
