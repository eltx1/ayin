# AYIN Web/PWA master checkpoint

## Authority and resume contract

The user-supplied AYIN MASTER WEB/PWA PRODUCT CONSOLIDATION goal, phases **0–16**, is the execution contract. `https://ayin.stream` is the canonical product. Preserve shared APIs, authorization, MFA, rights, moderation, transactional audits and financial controls. Do not rewrite working systems or duplicate ordinary native product UI.

Before each phase, read this ledger and verify actual main, open PRs, exact tested heads and observed deployment. Code and observed results take precedence over status text. Finish relevant gates and review before dependent implementation. Record conclusions/evidence, never private reasoning.

Detailed earlier evidence is retained in [checkpoint history through #140](AYIN_WEB_PWA_CHECKPOINT_HISTORY_THROUGH_140.md), [historical integration checkpoints](AYIN_PRODUCT_INTEGRATION_CHECKPOINTS.md) and [source audit](AYIN_PRODUCT_INTEGRATION_AUDIT.md). Historical pending text and earlier phase labels are not current acceptance. The current capability authority is [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md), with its explicitly historical detailed baseline. No earlier `2A–2J` or historical `3–5` status means completion of current master phases.

## Current acceptance boundaries

- Phase 0: Task 87 PR #108 and subsequent accepted exact-head quality results were recovered. Fixed dated fixtures without changing the real rolling 30-day discovery rule. Do not deploy the obsolete Task 87 commit over newer validated main.
- Phase 1: current source/semantic inventory reconciliation accepted in PR #141. Static inventory is not full runtime, UI, accessibility, security or provider acceptance.
- Phase 2: focused public route integrity accepted and deployed in PR #140. Full all-link/notification/sitemap/route-family acceptance remains in later relevant phases.
- Phase 3: implementation candidate on `web-pwa-phase-3-information-architecture`; not yet accepted or deployed. See the current entry below.
- Phases 4–8: full design system, Viewer/Creator/Admin transformation and final capability-to-surface acceptance remain open. Earlier working integrated workspaces are retained, not reimplemented blindly.
- Phases 9–14: full PWA lifecycle, measured performance, official-policy advertising, visual coverage, master E2E and simplified-workflow security acceptance remain open. Historical passing suites are exact-head evidence only.
- Phase 15: not started. Preserve existing Android/iOS/TV implementations and perform current official policy research after Web/PWA gates. No signing, store approval or physical-device certification is claimed.
- Phase 16: execution records are current; whole-project documentation consolidation remains open.

## Accepted recovery — PR #139

Starting main `3b459ac1e0f5c8fc6a51916eb4815835a9f1b5e3`; final head `e51820bd17033bc54fd780ffc528a61e2371e814`; merged main `912e64b3ef91644abe9b8c2475ea3faffb519597`. Quality `36370738788`, browser `36370738741` and security `36370738852` passed. Author-side review `5333509722` covered request cancellation, scoped drafts, pending guards, validation, no-store and isolated fixtures; not an independent approval. Expected-head merge and main were verified. Full inspected-files, tests, risks and decisions remain in the preserved history.

## Accepted public route integrity — PR #140

**Starting SHA:** `912e64b3ef91644abe9b8c2475ea3faffb519597`. **Final reviewed head:** `d4e66ad3d5c9e4239944d674cd982db3afb4e0d6`. **Merged SHA:** `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`.

**Inspected/changed:** public routes, catalog/VideoPolicy, primary-TV ownership, trusted-region propagation, navigation/i18n/proxy aliases, Viewer shell, competing manifests, integration/browser fixtures, CI and deployment. Implemented real localized server-rendered Movies/Series/TV/Creators directories, bounded rights-aware keyset continuation, Movie batch hydration, primary-TV ownership, one Clips product, locale/query-preserving `/shorts` and `/uploads` aliases, one manifest with correct shortcuts, Viewer shell on details, no-store trusted context and genuine-404 distinction. No migrations, provider/native changes or relaxed server security.

**Regression correction:** initial fixtures referenced nonexistent actor Accounts, violating `VideoPolicyOverride_actorAccountId_fkey`. Commit `acecb98750b35e5fa8ea3f9383bcb2d4ee329bba` inserted real isolated Accounts; no dropped constraint/assertion, skipped test or changed production policy. The dated discovery test passed.

**Tests/review:** final-head quality `36377946484`, browser `36377946464`, security `36377946520` passed. Quality includes audit, format, deployment tools, lint, TypeScript/Prisma, units/schema, clean migrations/integration and production build. CodeQL/Gitleaks ran; dependency-specific review correctly skipped unchanged dependencies. Production audit reported one moderate advisory, not zero vulnerabilities. Author-side reviews `5333986738`, `5334016117`; no unresolved threads; expected-head merge and main re-read observed.

**Visual evidence:** actually inspected 12 directory screenshots, 390px Arabic/1440px English/1920px English, run `36376270284`, artifact `10950933453`, ZIP SHA-256 `76b8d269b86124e023865c9f7411741366056f2b55c48b13dba3993112d80b0b`. These are seeded CI fixtures, not production/physical-TV verification. Broken fixture artwork identifies a shared MediaCard fallback gap. Sparse fixtures are not large-catalog acceptance.

**Performance:** limited historical local production-build HTML-declared gzip JS comparison: Movies/Home +679 bytes, Movie detail +5666 bytes with its restored Viewer shell. No CWV/API/DB/playback/upload speedup claim. Method and before/after remain in [performance evidence](PERFORMANCE_BASELINE_AND_RESULTS.md).

**Observed deployment:** 2026-09-28, validated-main run `36378738334`, deployment `36379170040`, job `108791137393` succeeded, including superseded-release guard, exact commit, isolated AYIN account and direct-origin health. Downloaded immutable proof artifact `10952038374`; verified ZIP SHA-256 `73d59985ffd39be4a769657960d5965244091ef90ab179410fe52d9c92775303`. `deploy-proof.env` records release `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`, validation `36378738334`, deploy `36379170040`, attempt 1, account `ayin`. Cloudflare sync `36379289647` reports success. This proves that release at deployment time, not every journey or future production state.

**Remaining risks/rollback:** full visual/accessibility/link acceptance, failed artwork, concurrent policy rechecks, per-series hydration, Kids/profile/cache boundaries and production edge assumptions. Revert the focused route PR through a reviewed release; no database rollback. Preserve earlier auth/MFA, media-generation, rights and merchandising fixes.

## Accepted source reconciliation — PR #141

**Starting SHA:** `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`. **Branch:** `web-pwa-source-audit-reconciliation`. **Recovered head:** `81dbdaa7847e972913e44c8c4656896aed945657`. **Final reviewed head:** `88230732bfb81b3a522a7fc802ada6f84ad69c16`. **Merged and re-read main:** `64df1952ba041b95c30e3139760bd9410059c5dc`, 2026-09-28. Tree `a01e3d4aacf96df42f795a142f0c60a303226a62`.

**Inspected/findings:** complete inventory generator/tests/workflow, historical semantic review at `e94c1f5890b205dd8fe21731078d44ebc2039791`, accepted route/operator deltas, current matrix/checkpoint, tracked-file evidence, failed formatting job and actual production proof. Historical counts/candidate gaps were outdated. Admin already shares its access provider; do not reimplement that solved issue. Actual remaining creator label `video-metadata-fields.tsx:298` says `Series / episode placeholder`; inspect permission/metadata semantics before replacing it. `Ready for the next layer` remains only a negative regression assertion, not a public placeholder.

**Changes:** existing generator gains deterministic read-only `--stdout`, schema v2, complete tracked-file SHA-256/backend evidence and explicit historical-vs-current acceptance boundaries. Preserve historical JSON and detailed ledger/matrix byte-for-byte under historical filenames. The source-evidence workflow has `contents: read`, no retained checkout credentials, secrets, branch writes or dependency installation. It exports inventory metadata, not a source archive/production data.

**Artifact evidence:** run `36379315415`, artifact `10952330981`, verified ZIP SHA-256 `bd3453054040c2654edee2dae5cb59af154b14c9d68ca5318c8f0ffae4a6adab`; clean PR test-merge snapshot `dcfd1351e22a8cffff0309e06b90a76b8bc3af25`, not main. Snapshot: 1220 tracked files, 78 Web routes (70 pages/8 handlers), 54 controllers, 364 endpoint paths, 73 feature labels, 119 models, 57 migrations, 285 backend files, 8 worker-named files, 113 platform files, 50 deployment/workflow files. Later edits change counts; static worker filenames are not live processes/hosts.

**Tests/fixes/review:** original quality `36379315202` failed only new-test formatting; first formatting edit also remained noncanonical. Refactored long expressions/argument fixtures in `04fc8e637603aad611b82f7c4357dc7d600f4511`, preserving every assertion; full quality `36379861992` and inventory `36379861977` passed. Final documentation head passed quality `36380336982`, job `108794620644`, including audit/format/deploy tools/lint/TypeScript/Prisma/units/schema/clean migrations/integration/build; inventory `36380336245` passed. Determinism, complete hashes/counts, all authored classifications, history preservation and invalid-argument rejection are covered. No retry-until-green or suppressed tests. Browser/security were not newly triggered for these paths, so no fresh execution is claimed. Author-side review `5334252911` anchored final head; no unresolved threads; expected-head-protected squash merge and main confirmed.

**Migrations/UI/performance/deployment/rollback:** none for this tooling/documentation PR. No new product/provider activation, screenshot or performance-improvement claim. No new production SHA independently observed beyond #140 above. Revert this focused PR without application/database rollback.

## Current Phase 3 — information architecture candidate

**Starting main:** `64df1952ba041b95c30e3139760bd9410059c5dc`. **Branch:** `web-pwa-phase-3-information-architecture`. **Initial implementation commit:** `fdeb9082192ba255b364f76f5bb68095952cd521`. **Ending accepted/merged/deployed SHA:** pending, not claimed.

**Inspected:** existing Viewer shell, navigation flags/product-controls contract and configuration schema/defaults, locale routing/translator/EN+AR resources, Studio/Admin layouts/styles and exact nineteen-role/twelve-Studio link coverage, shared Admin access and reauthentication, AppNavLink, TV focus and platform runtime/Back handling, responsive/catalog/MFA E2E, DB fixtures, API users authorization, source inventory and browser workflow. Existing source remains the basis; this is not a backend rewrite.

**Problem:** flat navigation mixes viewer browsing, account and creator tools; mobile workspace links occupy substantial page space; root/nested active states and breadcrumbs lack one shared model. Existing TV geometric focus can target visible content behind a modal. Configuration has intentional disabled categories that must not be inadvertently enabled.

**Changes/decisions:** add a real `/browse` hub and at most five shared Viewer primary choices, preserving enabled flags/configured order/valid destinations/locale/aliases; keep direct Upload prominent; group account/creator links. One Viewer context shares existing bootstrap reads with Browse. Group all existing Studio/Admin links with unchanged roles, active-group expansion, locale-aware safe breadcrumbs, mobile modal navigation and existing single MFA component. Native modal/keyboard/remote Back and focus containment use existing TV capabilities, not a platform fork. Typed EN/AR resources extend the existing translator without changing catalog continuation strings. Use existing design tokens, bounded safe-area layouts and small inline icons; no new dependency. [Information architecture](AYIN_INFORMATION_ARCHITECTURE.md) records the intended hierarchy and remaining control-center boundaries.

**Tests added/updated:** pure destination uniqueness/role/locale/translation/flag/order/alias/unsafe-URL tests; browser responsive EN/AR five-choice/shared-request tests, unavailable/retry/long-label handling, keyboard/remote modal containment, Studio direct upload, finance-only Admin links plus an actual `/admin/control/users` 403. Existing responsive routes and account/MFA assertions retained and adapted to disclosure controls. Existing CI retains directory and navigation screenshots for inspection. Fixtures do not alter production product controls.

**Tests/results/review/visual:** not yet executed for the complete candidate; do not mark green. New and historical suites must run on the final head. Source review identified duplicate-key/unsafe-navigation handling, modal remote focus/Back, long custom labels and accidental translation-key collisions; candidate corrections are included before acceptance. No screenshots actually reviewed for this candidate yet.

**Migrations/security:** none. No API guard, MFA/step-up, ownership, rights, financial transaction, moderation, provider credential or native signing change. UI role filtering never substitutes for server restrictions.

**Performance:** shared Browse/shell configuration reads are bounded in design and receive a browser request-count assertion; no measured bundle/CWV/latency improvement claimed before execution. Preserve Phase 2 measurements and collect comparable evidence during the performance program. Catalog data continues using existing server-rendered routes.

**Open risks/external boundaries:** full visual/accessibility/TV acceptance, all historical tests, installed PWA lifecycle, account-session synchronization, control-center consolidation, provider and native-device evidence remain explicitly separate. Container has no prior source/dependency workspace and cannot resolve GitHub/npm; connected GitHub source operations, CI and artifact downloads work. No local full application build/browser result is claimed and no network/browser restriction is bypassed.

**Next:** finish candidate checks/source review, fix findings, inspect actual CI screenshots, pass exact-head relevant gates, expected-head merge, verify main/deployment as applicable and record evidence. Only then start Phase 4 design-system normalization. Do not advance based on a status document alone.

**Rollback:** revert the focused navigation PR through existing validated deployment. No database rollback or production-data reversal; preserve existing URLs/aliases and server capabilities.
