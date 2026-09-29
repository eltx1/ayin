# Performance baseline and results

## Evidence authority

This is the current performance evidence index, not completion of master Phase 10. AYIN remains the canonical Web/PWA with unchanged shared backend/media/security boundaries. Exact accepted source/gates/deployment are in [the master checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md).

Full earlier results and methodological corrections through accepted #145 are preserved byte-for-byte in [historical performance results](PERFORMANCE_RESULTS_THROUGH_145.md). Historical pending statuses are superseded by the current checkpoint, but measurements retain their original source/toolchain/fixture qualifications. Do not compare different measurement methods as though they were the same metric.

## Phase 4C — focused content editor, 2026-09-29

**Baseline:** accepted main `02e37ce7186eb72f62c940847c630dbc5c8ef159`, tree `02df2edcbba42c546930cda67c6ccf7512dd35d8`. **After:** candidate branch `web-pwa-phase-4c-content-editor`; its exact final reviewed head must be recorded in the checkpoint. Both same-environment production Web builds completed with exit 0. Local Node22.16.0/restored compatible Web tools are not the fresh frozen CI Node24 graph.

**Method:** deduplicate the route's `entryJSFiles` and `entryCSSFiles` from the built Next client-reference manifest. Gzip each selected file at level 9 and sum. This is selected entry-file aggregation, not all dynamic imports, full browser/CDN transfer, hydration time, field Core Web Vitals or database/API/player/upload latency. The source was restored with verified archive, every tracked hash and exact Git tree; detailed source and test evidence is in [Phase 4C evidence](AYIN_PHASE4C_EVIDENCE.md).

| Route           | Before gzip JS | Final gzip JS | Before gzip CSS | Final gzip CSS |
| --------------- | -------------: | ------------: | --------------: | -------------: |
| Studio Content  |          44001 |         49689 |           16669 |          16990 |
| Studio overview |          40381 |         40401 |           16669 |          16990 |
| Admin overview  |          45803 |         45803 |           11494 |          11629 |
| Browse          |          43763 |         43763 |           21075 |          21210 |
| Home            |          50194 |         50194 |           14361 |          14361 |

An initial global-dictionary implementation added 2025 compressed entry bytes to unrelated Home/Admin/Browse JS. It was measured and replaced with route-scoped vocabulary on the existing locale context. Final values above include that correction. Content adds 5688 bytes for real editor/state/translation behavior; no speedup is claimed. UI mounting only one editor and eliminating filter-driven draft resets are product fixes, not quantified memory/CWV improvements.

The small shared CSS increases are recorded, not hidden. Existing #144/#145 Comments/Support/Playlist styles are not removed to make a bundle comparison look better. No new dependency, broad package upgrade, server index or cache behavior was introduced by this phase.

## Earlier retained evidence and scope

#140's HTTP/HTML script comparison showed Movies/Home +679 gzip bytes and Movie detail +5666 when restoring the Viewer shell. #143 and #144 introduced shared design primitives and route-specific views with explicitly measured selected-entry costs. Reconciled #145 preserved both domain implementations and corrected source/dependency-layout comparability. These complete measurements, CSS results, source IDs and limits remain in the historical report; its values are not silently overwritten by a new baseline.

## Required complete performance program

Recheck current official Core Web Vitals guidance during Phase 10 and collect representative LCP, INP and CLS with field/lab distinctions, full initial/dynamic route JS, CPU/network/TTFB/request/image/font cost, hydration, real API latency and payload sizes, query counts/plans/index evidence, connection pressure, discovery/search, per-series hydration, HLS/MP4 startup/buffering/ABR, upload preparation/concurrency/retry/reliability, Admin/Studio first-use, and privacy-safe PWA startup/cache effects.

Do not add indexes, replicas, a new storage system or an architectural rewrite from these limited entry-size measurements. Test runtime/CI browser timings are not production traffic performance. Browser screenshot dimensions are not device certification. No complete performance, installed-PWA, provider, native-device or store-approval claim follows from a passing local build.
