# Phase 4C — focused creator content editor

## Scope and baseline

Starting accepted/deployed main: `02e37ce7186eb72f62c940847c630dbc5c8ef159`, tree `02df2edcbba42c546930cda67c6ccf7512dd35d8`. Branch: `web-pwa-phase-4c-content-editor`. This is a focused continuation of the shared design system with a real Studio consumer, not completion of master phases 4–16. Final reviewed/merged/deployed SHAs belong in the canonical checkpoint.

The source artifact `11043216801` from run `36589152929` was downloaded and verified against ZIP SHA-256 `cfb79667282ed51544423915f49602c95c7545d9b568a0a83fc18c9bdc4f5e5a`, every tracked file hash and the accepted tree. Artifact source `4e2b8e30721e03e4cf16ffef5a75948cce53ccde` is a PR test-merge snapshot, not main. Local reconstruction has its own commit identity and is never called a production SHA.

## Findings and engineering decisions

The previous content manager rendered an expanded editor and caption manager for every returned video. Changing a filter triggered another collection read and recreated all drafts, losing edits. Save and refresh were awaited together, so a successful write followed by a failed GET appeared to be a failed write. React busy state alone did not guard synchronous repeat clicks.

The existing Studio controller and services remain the authority: AuthGuard/channel membership, ownership, video status and protected TV association. Its content endpoint returns up to 50 most recently updated matches by default; no pagination cursor or global count exists. The new UI states this bound and submits explicit filters. No invented Watch route is built from UUIDs because this response has no public slug.

The existing PATCH applies basic and advanced metadata in two stages. This change does not falsely make that backend operation atomic. Even an HTTP failure can be partial. The editor therefore keeps the draft, disables repeated mutation after an unconfirmed result and requires leaving/reloading the library to inspect saved state. It never replays a failed PATCH, POST or DELETE automatically. An acknowledged mutation remains a success independently of the next collection GET.

## Reusable component and actual adoption

`EditorTabs` follows the WAI-ARIA APG manual-activation pattern: linked tab/panel IDs, one active tab stop, native buttons, arrows/Home/End move focus, Enter/Space/click activate, and physical arrows adapt to RTL. Inactive panels stay mounted and hidden so switching sections does not destroy advanced drafts or caption file selections. It adds no dependency or duplicate form system. Official pattern checked 2026-09-29: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/.

The real `/studio/content` consumer reuses PageHeader, FormSection, native fields, DataTable, actions, badges and notices. It presents a searchable bounded library and opens one selected video. Details, Advanced metadata and Captions are contextual tabs, not new top-level routes. Quick Upload stays a direct existing action. Existing metadata validation and caption operations remain available. Removed videos are read-only. Unpublish/removal require confirmation and are disabled while edits remain unsaved.

Synchronous guards cover main mutations and caption activity; native pending fields are disabled. Ordinary same-tab link navigation, explicit editor closing and document unload warn on unsaved draft/file state. Same-document browser Back/Forward is a documented router limitation, not claimed protected here. Caption read/write busy state prevents the parent closing mid-operation. Legacy advanced/caption inner strings and their deeper upload-recovery behavior remain later creator-polish work.

Editor strings are route-scoped, using the existing locale provider/interpolation contract rather than adding an independent locale/product. An initial global-dictionary implementation was measured and rejected because it added about 2 KB of compressed code to unrelated entrypoints. Shared vocabulary and translator remain unchanged.

## Tests and current evidence

Local Web tests: **244 passed in 53 files**. Existing historical tests remain. Seven new unit/render cases cover tab relationships/hidden mounted content/RTL, independent drafts, preserved false/null fields, rights exclusion, title/chapter validation, uncached credentialed cancellable reads, malformed responses, non-replayed failures and complete noncolliding translations. Next type generation, TypeScript, scoped Web lint and relevant formatting passed. Both comparable before/after production Web builds exited 0. These local results use Node 22.16.0 and restored compatible Web dependencies; CI pinned Node 24.19.0/frozen full graph remains required.

Three new browser journeys are authored, not yet accepted: actual owned drafts, library versus one editor, accessible manual tabs and RTL, no eager caption reads, retained edits/cancelled navigation, duplicate-click/pending guards, failed initial GET recovery, acknowledged PATCH followed by failed GET, actual committed PATCH with lost response and no replay, caption activity, other-account 404 and confirmed removal/read-only recovery. Reset fails closed outside APP_ENV=test and the matching isolated local ayin_e2e database. Only this deliberate network-interception spec blocks service workers; production and PWA suites are unchanged. Existing workflow retains `design-content-*` screenshots for actual review.

## Measured selected entry assets

Same locked source baseline and same local dependency layout; production builds before and after. Deduplicate the route's `entryJSFiles` and `entryCSSFiles` from Next client-reference manifests, gzip each selected file at level 9 and sum. This is selected entry-file aggregation, not complete dynamic imports, browser/CDN transfer, field Core Web Vitals or API/DB/player/upload latency.

| Route           | Before gzip JS | Final gzip JS | Before gzip CSS | Final gzip CSS |
| --------------- | -------------: | ------------: | --------------: | -------------: |
| Studio Content  |          44001 |         49689 |           16669 |          16990 |
| Studio overview |          40381 |         40401 |           16669 |          16990 |
| Admin overview  |          45803 |         45803 |           11494 |          11629 |
| Browse          |          43763 |         43763 |           21075 |          21210 |
| Home            |          50194 |         50194 |           14361 |          14361 |

Content gains 5688 compressed entry bytes for the actual editor/state/strings; no speedup is claimed. The corrected route-scoped vocabulary leaves selected Home/Admin/Browse JS unchanged. The small shared CSS increases are recorded, not hidden. The UI avoids mounting every full editor and avoids filter-driven draft resets; runtime/memory benefit is not quantified by this bundle comparison. Full Phase 10 performance collection remains required.

## Release, security and rollback

No backend/API schema, dependency, workflow, server authorization/MFA, finance, catalog rights, moderation, provider or native/signing change. No production mutation is used for testing. Final exact-head quality, security, database integration, production build, browser and inventory gates plus actual source/visual review must pass before expected-head merge. Observe exact main and deployment proof afterwards. Keep existing fast-uri/locale/rights/security improvements if independently reverting this presentation change. No full master, installed-PWA or physical-device/store acceptance claim.
