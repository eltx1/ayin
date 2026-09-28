# AYIN Web/PWA master checkpoint

## Authority and resume contract

The user-supplied AYIN MASTER WEB/PWA PRODUCT CONSOLIDATION goal, phases **0–16**, is the execution contract. `https://ayin.stream` is the canonical product. Preserve shared APIs, authorization, MFA, rights, moderation, transactional audits and financial controls. Do not rewrite working systems or duplicate ordinary native product UI.

Read this ledger before every phase; verify current main, open PRs, exact tested heads and observed deployment. Code and observed results take precedence over status text. Finish relevant gates and review before dependent implementation. Record evidence and engineering decisions, never private reasoning.

The detailed ledger through PR #140 and the initial #141 investigation is preserved byte-for-byte in [checkpoint history](AYIN_WEB_PWA_CHECKPOINT_HISTORY_THROUGH_140.md). Its pending states describe that historical moment; the acceptance records below supersede them. Earlier phases `2A–2J` and historical `3–5` are not completion of the current master phases. Retain [historical integration checkpoints](AYIN_PRODUCT_INTEGRATION_CHECKPOINTS.md), [source audit](AYIN_PRODUCT_INTEGRATION_AUDIT.md) and [historical machine inventory](AYIN_PRODUCT_INTEGRATION_MATRIX.json). The current classification authority is [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md).

## Current acceptance boundaries

- Phase 0: recovered historical baseline and subsequent exact-head test acceptance. Task 87 PR #108 fixed dated fixtures without changing the rolling 30-day discovery rule. Production evidence for newer accepted main is recorded below; never deploy the obsolete Task 87 SHA over it.
- Phase 1: authored 73-domain classifications and current tracked-source inventory reconciled in PR #141. Static inventory does not constitute full runtime, UI, accessibility or security acceptance.
- Phase 2: focused public route integrity accepted and deployed in PR #140. Remaining all-link, notification, sitemap and route-family acceptance continues in later relevant phases.
- Phases 3–5: grouped information architecture, design-system normalization and full Viewer redesign are not accepted.
- Phases 6–8: earlier creator/Admin/operator improvements exist, but complete workflow simplification, control-center transformation and backend-to-surface acceptance remain open. Raw-ID workflows and provider-command audit/concurrency remain review items.
- Phases 9–12: full PWA lifecycle, measured performance, official-policy advertising and route-by-route visual acceptance remain open. A fixed manifest is not installed-PWA certification.
- Phases 13–14: historical regression/security results remain exact-head evidence only; master E2E and simplified-workflow security acceptance are not complete.
- Phase 15: not started. Preserve existing Android/iOS/TV code; begin platform preparation after Web/PWA gates and current official policy research. No signing, store approval or physical-device result is claimed.
- Phase 16: execution records are current, but whole-project documentation consolidation remains open.

## Accepted recovery — PR #139

Starting main `3b459ac1e0f5c8fc6a51916eb4815835a9f1b5e3`; final PR head `e51820bd17033bc54fd780ffc528a61e2371e814`; merged main `912e64b3ef91644abe9b8c2475ea3faffb519597`. Quality `36370738788`, browser `36370738741` and security `36370738852` passed. Author-side review `5333509722` covered request cancellation, scoped drafts, pending guards, validation, no-store and isolated fixtures; it was not an independent approval. Expected-head-protected squash merge and main were verified. Full inspected-files, tests, risks and decisions remain in the preserved history.

## Phase 2 — public route integrity, PR #140

**Starting SHA:** `912e64b3ef91644abe9b8c2475ea3faffb519597`. **Branch:** `web-pwa-phase-2-route-integrity`. **Final reviewed head:** `d4e66ad3d5c9e4239944d674cd982db3afb4e0d6`. **Merged SHA:** `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`.

**Inspected:** public routes, catalogs, VideoPolicy, discovery/TV ownership, trusted-region propagation, navigation/locale/proxy aliases, Viewer shell, competing manifests, integration/browser fixtures, CI, screenshots and deployment workflow. The history preserves complete source and test details.

**Changes and decisions:** real localized server-rendered Movies/Series/TV/Creators directories; bounded rights-aware keyset pagination; Movie batch hydration; primary-TV ownership; one Clips product; locale/query-preserving `/shorts` and `/uploads` aliases; one generated manifest with `/upload` and `/tv`; Viewer shell on catalog details; no-store trusted-region reads and genuine-404 discrimination. No migrations, provider activation, credentials, native changes or relaxed security. Per-series full hydration is still a measured performance follow-up.

**Regression correction:** initial new fixtures referenced nonexistent actor Accounts and violated `VideoPolicyOverride_actorAccountId_fkey`. Commit `acecb98750b35e5fa8ea3f9383bcb2d4ee329bba` inserted real isolated Accounts; no weakened assertions, skipped tests, dropped foreign keys or production-policy changes. The dated discovery test passed.

**Tests and review:** final-head quality `36377946484`, browser `36377946464`, security `36377946520` passed. Quality includes dependency audit, format, deployment tooling, lint, TypeScript/Prisma, units/schema, clean migrations/integration and production build. CodeQL and Gitleaks ran successfully. Dependency-specific review correctly skipped unchanged dependencies; production audit ran and reported one moderate advisory, not zero vulnerabilities. Author-side reviews `5333986738` and `5334016117`, no unresolved threads, expected-head merge and re-read main were observed.

**Visual evidence:** actually reviewed 12 CI directory screenshots from run `36376270284`, artifact `10950933453`, SHA-256 `76b8d269b86124e023865c9f7411741366056f2b55c48b13dba3993112d80b0b`; 390px Arabic, 1440px English, 1920px English. Browser coverage includes seeded data, continuation, aliases, manifest, RTL and no horizontal overflow. These are fixtures, not production catalog or physical-TV evidence. Broken fixture artwork exposes an existing shared MediaCard fallback gap; sparse fixtures do not establish large-catalog visual acceptance.

**Performance:** historical local build evidence shows HTML-declared gzip JS +679 bytes for Movies/Home and +5666 bytes for Movie detail with the Viewer shell. No speedup, CWV, API/DB, playback or upload-performance claim. Preserve [performance evidence](PERFORMANCE_BASELINE_AND_RESULTS.md).

**Production verification observed 2026-09-28:** push-main validation `36378738334` succeeded; deployment `36379170040`, job `108791137393`, successfully required validated main, rejected superseded releases, deployed the exact commit, verified direct-origin application health and retained immutable proof. Downloaded artifact `10952038374`; verified ZIP SHA-256 `73d59985ffd39be4a769657960d5965244091ef90ab179410fe52d9c92775303`. Its `deploy-proof.env` records release `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`, validation `36378738334`, deployment `36379170040`, attempt 1, account `ayin`. Cloudflare production sync `36379289647` reports success. This verifies that release at deployment time, not every product journey or later production state.

**Unresolved risks:** complete route-family visual/accessibility acceptance; failed artwork; concurrent catalog policy rechecks; per-series hydration; Kids/profile boundaries; service-worker cache/update safety; production trusted-edge assumptions. No ignored critical/high closure claim.

**Rollback:** revert the focused route change through a reviewed release; no database rollback. Preserve earlier auth/MFA, rights, media-generation and merchandising fixes.

## Phase 1 continuation — source reconciliation, PR #141

**Starting main:** `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`. **Branch:** `web-pwa-source-audit-reconciliation`. **Recovered head:** `81dbdaa7847e972913e44c8c4656896aed945657`. **Reviewed test repair:** `04fc8e637603aad611b82f7c4357dc7d600f4511`. **Ending accepted/merged SHA:** pending final-head gates and review.

**Inspected:** complete inventory generator and its tests, all artifact classifications and tracked-file evidence, historical semantic source baseline `e94c1f5890b205dd8fe21731078d44ebc2039791`, current matrix/checkpoint, accepted route deltas, Admin/Viewer navigation source and prior shell/layout review, quality/deployment workflows, failed formatting job and successful source artifact. This is a delta reconciliation, not a false claim to have executed every feature.

**Findings:** historical counts and gap strings describe outdated surfaces. Current Admin already shares its access provider; do not reimplement that solved issue. Admin still has 19 flat links and Studio 12. Remaining actual candidate `apps/web/src/components/upload/video-metadata-fields.tsx:298` says `Series / episode placeholder`; its creator permission and metadata semantics must be checked before changing it. The other `Ready for the next layer` match is a negative regression assertion, not a remaining public placeholder.

**Changes:** reuse the existing generator, adding deterministic read-only `--stdout`, schema v2, tracked-file SHA-256 evidence, complete backend source inventory and explicit separation of historical semantic/candidate gaps from current acceptance. Preserve the committed historical inventory. Add a read-only source-evidence workflow with `contents: read`, no retained checkout credentials, no secrets, no branch writes and no dependency installation. It exports inventory metadata, not a source archive or production data.

**Fresh artifact inspected:** run `36379315415`, artifact `10952330981`; verified ZIP SHA-256 `bd3453054040c2654edee2dae5cb59af154b14c9d68ca5318c8f0ffae4a6adab`. Source `dcfd1351e22a8cffff0309e06b90a76b8bc3af25` is the PR test-merge snapshot for head `81dbdaa...`, not main. Working-tree change list is empty. It inventories 1220 tracked files, 78 Web routes (70 pages, 8 handlers), 54 controllers, 364 endpoint paths, 73 classified feature labels, 119 models, 57 migrations, 285 backend files, 8 worker-named files, 113 platform files and 50 deployment/workflow files. Counts describe that snapshot; later documentation additions change file totals. Worker filenames are not live process/host counts.

**Tests/results:** inventory runs `36379315415`, `36379734189` and `36379861977` passed deterministic repeat output, tracked-file/hash/count consistency, all authored classifications, explicit runtime/authorization disclaimers, history preservation and invalid-argument rejection. Quality `36379315202` failed only formatting in `scripts/test-product-inventory.mjs`; first formatting edit also remained noncanonical. Refactoring long expressions and argument fixtures in `04fc8e6` preserves every assertion and fixes formatting, confirmed by quality run `36379861992`; audit and deployment-tool checks also passed at inspection, remaining full gates were running. Final documentation head must pass its own applicable gates before merge. No retry-until-green or test suppression.

**Documentation:** current matrix distinguishes accepted route fixes from remaining UX/runtime work; both old detailed documents are retained byte-for-byte under explicitly historical filenames. The current ledger is the resume index and acceptance authority; historical pending text is not current status.

**Migrations and UI:** none. No application/API/native/provider or production-data change in this PR. Screenshots, performance deltas and new product deployment are not applicable to these tooling/documentation edits; repository quality gates remain required.

**Environment:** this resumed container has no prior source/dependency workspace and cannot resolve GitHub or the npm registry. Connected GitHub reads/writes, CI and artifact downloads work. Use those supported paths; do not bypass network/browser restrictions or recreate rejected source-transfer/documentation-publication automation. No local application build/browser run is claimed.

**Next:** finish final exact-head quality/inventory checks and author-side review, merge with expected-head protection, verify main. Then start current Phase 3 grouped Viewer/Studio/Admin navigation with existing feature flags, roles, locale routing and server authorization. Keep Quick Upload prominent and all existing deep links working. No claim that later phases are completed.

**Rollback:** revert the focused tooling/documentation PR; no application or database rollback.
