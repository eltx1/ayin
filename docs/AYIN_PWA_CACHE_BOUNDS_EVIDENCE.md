# PWA asset retention and storage-failure recovery

## Behavior

The v4 worker retains at most 128 public build-asset entries, plus the three neutral shell entries installed by the worker. The asset limit applies across successive application builds served while that worker remains active. Oldest entries are evicted before a new write; writes and eviction are serialized. Shell assets are written only during installation, so request-header variants cannot multiply their pinned entries.

This is an entry limit, not a byte quota or a guarantee that every old build stays available offline. A representative accepted build had 128 static files totaling 3,306,734 bytes; that directory inventory is not a route-load or field-performance measurement. The neutral offline document remains protected from asset eviction.

Cache open, lookup, enumeration, deletion or write failures no longer reject a successful network response. Persistence runs under the fetch event's lifetime. Only same-origin public static responses are eligible; documents, APIs, media, query-bearing requests, authorization-bearing requests, range requests, partial responses and redirects are outside persistence. Existing private/no-store/no-cache exclusions remain in force.

Safe worker updates still wait for explicit acceptance or the normal browser lifecycle. The existing immediate migration from the known unsafe v2 cache is retained. No tab is automatically reloaded, and foreign cache ownership is preserved.

## Source and regression evidence

The unchanged v3 source reproduced three rejected network-asset fetches when cache open, match or put failed in the executable worker harness. The candidate passes all 27 worker cases, included in the full 720-test Web suite. Web lint/types, Prisma generation, shared/API builds and production Next build also passed.

Independent review identified a URL-equality assumption in the first entry-accounting implementation. Cache matching observes response `Vary` semantics; the corrected writer conservatively reserves one entry without assuming a URL will replace an existing record. Shell persistence is installation-only. A Vary-aware replay preserves the first failing model and the corrected result. The [Service Worker cache algorithms](https://w3c.github.io/ServiceWorker/#batch-cache-operations) describe the matching and atomic write behavior considered by that review.

## Native acceptance

The final isolated Chromium run passed 12 cases with no skips, failures or flaky results:

- Two existing ordinary PWA cases preserve private-data exclusions, neutral offline navigation and explicit controller-change reload behavior.
- Five cache cases exercise three simulated build-asset sets, retained assets while offline, actual-worker injected open/match/put faults, and build/shell `Vary` requests.
- Five existing lifecycle cases exercise EN/AR draft retention across two tabs, dismissed native navigation warnings, delayed activation, unsafe-cache migration, logout and reopened offline navigation.

Fault counters prove that the injected storage errors occurred. An observer around the native Cache API recorded 131 successful puts, a maximum of 128 build entries after completed writes, and zero runtime shell puts. A proxy-only drain barrier waits for the actual worker's queued persistence; this test mechanism is absent from production source.

The first native run passed 11 cases and failed an overly strict test expectation that every intermediate cache read must contain exactly 128 entries. The implemented contract is an upper bound, and conservative eviction can leave fewer entries. The final test uses the upper bound after draining and additionally measures the maximum after every completed write. The failed report and trace remain preserved; they are not counted as a successful run. Application worker source did not change between those native runs.

Final native report: start `2026-10-06T04:52:16.873Z`, duration 40,523 ms, 12 expected, zero skipped/unexpected/flaky. PostgreSQL shutdown and an empty owned-service census were verified afterward.

## Acceptance boundaries

Storage errors and build assets are controlled fixtures against the real worker and browser Cache API. They do not establish an actual device disk-quota threshold, Safari behavior, installed-device startup certification or field Core Web Vitals. Offline navigation remains a neutral fallback, not a cached private application. No production browser data, credentials, settings or provider state was modified during this acceptance.

Remote exact-head CI and deployment proof belong to the release that includes this source; local acceptance does not replace them.
