# Catalog discovery and episode navigation

Baseline: `be799b902f859884a06de174da2ef55a9fceb5a4`.
Validation date: 2026-10-06 UTC. This is a bounded local Web/API slice.

## Completed behavior

- Movies and Series directories accept a bounded `q` search with existing UUID cursor pagination. Filtering happens in PostgreSQL before the page limit and retains catalog rights, public playable media, episode release, and video-policy eligibility checks.
- Search covers original title/synopsis and requested-locale or English-fallback title/synopsis/short description. Other translated locales are not searched implicitly. SQL values are bound and `%`, `_`, and backslash are treated literally.
- Native EN/AR search forms reset pagination for a new search; paging, retry, and return-to-first-page links retain the query. Clear search resets the input as well as the URL. Invalid input, unavailable requests, and real empty results remain distinct. Search/paginated pages are not indexed.
- Watch requests localized episode context, presents series/season/episode information, links back to the current season, and offers explicit next-episode navigation across seasons. The last eligible episode has a clear final-episode state. Removed/private/future/region-blocked episodes are excluded by existing catalog policy.
- Playback locale input is a bounded scalar; repeated, nested, blank, and oversized values return a deliberate 400 before localization. Unknown unrelated query parameters and existing Kids selection semantics remain compatible.
- Web playback types now distinguish creator videos from series episodes. Existing player progress, advertising ownership, and autoplay behavior are unchanged; no automatic next-episode transition is added. Kids Watch suppresses the catalog links independently of upstream context.

## Local verification

- Prisma client regenerated into this worktree; workspace package outputs are private to the worktree.
- API and Web TypeScript checks passed. Production API and Next.js webpack builds passed.
- Changed-source ESLint, Prettier, and `git diff --check` passed.
- 23 focused API unit tests passed across directory parsing, Watch, localization, and episode-order policy.
- 16 focused Web tests passed across directory query/recovery rendering, Watch EN/AR/Kids behavior, and existing movie/series detail contracts.
- 19 PostgreSQL integration tests passed in `public-directory.integration.test.ts` and `watch-progress.integration.test.ts`. Both Movie and Series traversals returned all 110 eligible Arabic search matches after three territorial exclusions, without duplicates. Coverage also verifies literal wildcards, attempted SQL fragments, original-copy fallback, locale isolation, localized cross-season context, private/future omission, last-episode behavior, and territory-blocked context suppression.
- The new `catalog-discovery.acceptance.spec.ts` runs against real local API and production Next output. It traverses 110 matching Movie records in five pages at 1440/390 widths in both EN and AR; checks query retention, Back/Forward, no-match and clear-search recovery; searches Series; opens the current episode; follows the explicit next-episode link with the keyboard; returns with Back; and removes next navigation after that video becomes private.
- Eight original screenshots cover directory search and Watch at 1440/390 in EN/AR. Inspection checks wrapping, RTL presentation, legible context, and usable navigation. Browser assertions check no horizontal overflow.
- A separate final browser test passes four viewport-only Watch captures after settling scroll and keyboard focus. DOM bounds and hit testing prove both episode links stay below the fixed header and above the bottom bar: at width 390, the safe vertical region is 72–778.7 px and the controls occupy 314.3–510.3 px (EN) / 333.3–490.1 px (AR); at width 1440, they occupy 454.3–526.3 px within the 80–1000 px region. The original full-page captures remain separate; fixed-bar capture artifacts are not treated as viewport evidence.

## Reproduction

Use an isolated migrated PostgreSQL test database and the repository's standard environment. Run focused Vitest files from their respective API/Web directories, then run `tests/e2e/catalog-discovery.acceptance.spec.ts` through Playwright with the API and built Web app in the same runtime shell. The fixture requires an explicit loopback `TEST_DATABASE_URL`; it does not fall back to a production database.

For this execution environment, Next must listen on `0.0.0.0` while the browser uses `127.0.0.1`. An initial loopback-only Next binding reproduced the previously documented Arabic-cookie self-redirect; its failed trace was preserved. The correct binding passes EN/AR without an application routing workaround. Earlier test-fixture corrections made media object keys unique and waited for new page content after soft navigation.

## Limits and next bounded gap

The browser fixture supplies real database records but deliberately aborts its synthetic local media transport. This verifies catalog discovery and navigation, not playback delivery, provider activation, physical devices, or deployed production state. Placeholder artwork is the existing honest missing-artwork UI.

Global `/search` remains separate. Its active `LanguageAwarePostgresSearchService` already matches Movie/Series localization rows; the language-neutral base service alone does not. Remaining gaps are localized result presentation, the 24-per-type catalog hydration cap, translated synopsis rows excluded when their title is null, and policy filtering after candidate truncation. This slice does not claim to resolve that bounded follow-up or rewrite global ranking. No schema migration, credential, provider, or production-data change is needed for the completed slice.
