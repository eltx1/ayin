# Localized catalog search in a bounded result window

This slice follows the Catalog directory/Watch work and preserves the active language-aware search engine. That engine already searched Movie and Series translations. The corrected gaps were untranslated result cards, synopsis-only localization rows being skipped, catalog hydration stopping after 24 records per type, and unavailable high-ranked catalog records consuming candidate slots.

## Behavior and limits

- The language-neutral candidate budget remains **64 per entity type**. The language-aware union remains **192 unique candidates total**. Global search now uses that fixed window from the first page, deduplicates language candidates before their limit, and paginates the hydrated window consistently when catalog records and ranking signals are unchanged.
- This is **not exhaustive catalog search**. `nextCursor` advances within that finite relevance window and never advertises an offset beyond the existing supported boundary. Movies/Series directory cursor browsing provides complete available-catalog traversal. Live changes to rights, publication or ranking signals can still change offset results.
- Existing relevance formulas, language affinity and bounded popularity boosts remain in place. A larger consistent candidate pool and localized display titles can change ties relative to the former growing pool/raw-title presentation; there is no new ranking model or external provider.
- Catalog availability, playable public media, channel status, release dates and video policy apply before both candidate limits. Compact batched card hydration rechecks current eligibility, including hard publication/media boundaries that FORCE_ALLOW cannot bypass. Kids continues to suppress Movie/Series results.
- Requested-locale title/artwork presentation uses the existing requested → original → English field/artwork fallback. Cross-language exact discovery remains supported. A localized synopsis or short description remains searchable when its title is null.
- Movie hydration, Series episode count/first-eligible-episode facts, localization rows and artwork are batched. Search does not fetch every Series episode detail merely to render cards.
- Server-rendered search forwards trusted region headers. Search, suggestions, Kids search and Lens responses are private/no-store because locale and eligibility vary by request.

## Local correctness checks

The local checks below used the historical dependency graph described below; they are not frozen-lock CI claims.

- API/Web TypeScript checks and production API/Next webpack builds passed.
- Focused API units cover query bounds, fixed-window paging, batched hydration/localization, field/artwork fallback, transient read errors and cursor boundaries. Web units cover localized presentation and trusted region forwarding.
- 30 distinct PostgreSQL cases passed across Catalog search, base/language-aware search, public directories and Catalog administration. A final six-case Catalog suite passed after adding symmetric 110-Series traversal. The cases prove 110 localized Movie and Series matches across pages without duplicates, null-title synopsis/short-description retrieval, localization-row deduplication before limits, exclusion of 420 high-ranked territorial blockers, private/unplayable media despite FORCE_ALLOW, future episodes, Kids suppression and renewed rights checks during hydration.
- The production browser journey passed at 1440/390 in EN/AR. It follows real API pages through 110 Movie records, verifies localized copy, canonical locale links, private/no-store responses, keyboard continuation, Back/Forward and the final page within the window. Four original viewport captures show readable EN/AR cards and no horizontal overflow.

## Measured local comparison

The committed [raw samples and source/dependency manifest](evidence/catalog-search-benchmark.json) record five warm alternating requests against the real SearchController through Fastify injection. Both implementations used the same historical third-party dependencies, separate ten-connection pools and one isolated PostgreSQL database containing 110 Movies and 110 Series, one episode per Series and one shared playable source video.

| Per first-page request       | Baseline | Candidate |
| ---------------------------- | -------: | --------: |
| API requests                 |        1 |         1 |
| Returned results             |       24 |        24 |
| pg Client.query calls        |      169 |        26 |
| Prisma operations            |      203 |        19 |
| Median local handler latency | 59.18 ms |  34.27 ms |

The pg instrumentation counts actual SQL submissions; Prisma operation counts differ because Prisma can batch operations internally. Correctness and bounded database-operation assertions are separate from timing. There is no absolute millisecond CI threshold. These small local samples are not network latency, production capacity or an SLO claim.

For reproduction, build isolated baseline and candidate checkouts, migrate a dedicated loopback database named `ayin_catalog_search`, set TEST_DATABASE_URL, and run:

```sh
node tests/e2e/catalog-search-benchmark.mjs BASELINE_ROOT CANDIDATE_ROOT OUTPUT_JSON
```

The benchmark resets only that explicitly named local test database. The evidence baseline is Catalog/Watch commit `02d765b621388184c4718c9ebea94163cde1eca3`; candidate changed-API-source SHA-256 values and the parent tree are in the manifest.

## Dependency provenance and remaining acceptance

Local application outputs and generated Prisma were isolated, but third-party packages resolved from the historical `ayin-master` installation: Node 24.19.0, Next 16.3.6, React 19.2.8, TypeScript 5.9.3, Vitest 4.1.11, PostgreSQL 17.10, pg 8.23.0 and Prisma/generated client 7.10.0 (engine `0edf323efd1d98336f3f0a68684b56f689b900d3`). Installed source-map-js was **1.2.1** and mysql2 **3.22.0**, while the current lock specifies **1.2.2** and **3.23.1**. This same qualification applies to the preceding local Catalog/Watch checks; their historical results are not relabeled as current-lock runs.

A separate clean checkout of source commit `f881ea37ed9b6cd48e9ac7aa45b36da2f1737712` completed `pnpm install --frozen-lockfile --store-dir /tmp/ayin-pnpm-store` in 3.2 seconds, without changing the lock or tracked files. Its own resolved source-map-js is 1.2.2 and mysql2 is 3.23.1; two focused Search Web tests passed there. The historical benchmark and prior behavior runs above remain labeled with their original dependencies.

Final acceptance still requires the owning exact union CI to perform its frozen install, full API/PostgreSQL and real browser journeys before any merge. No further broad local replay was used as a substitute for that gate. No provider activation, real media delivery, deployed-production state or physical-device certification is claimed.
