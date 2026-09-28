# AYIN Web/PWA master checkpoint

## Authority and resume contract

The user-supplied **AYIN MASTER WEB/PWA PRODUCT CONSOLIDATION** goal, phases **0–16**, is the current execution contract. `https://ayin.stream` is the canonical product. Preserve shared APIs, working systems, authorization, MFA, rights, moderation, transactional audits and financial controls.

Read this ledger before every phase. Verify remote main, outstanding PRs, exact tested heads and deployment evidence. Code and observed results take precedence over historical status text. Do not start a dependent phase before its relevant acceptance gates pass. Record conclusions and evidence, never private reasoning.

The earlier program used different phase numbers (`2A` through `2J`, followed by historical `3–5`). Those numbers **are not completion of the current 0–16 phases**. Preserve its detailed history in [the historical checkpoints](AYIN_PRODUCT_INTEGRATION_CHECKPOINTS.md), [source audit](AYIN_PRODUCT_INTEGRATION_AUDIT.md) and [machine inventory](AYIN_PRODUCT_INTEGRATION_MATRIX.json). New master acceptance is recorded here. The current human inventory is [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md).

## Resume verification — 2026-09-28

- Observed starting main: `3b459ac1e0f5c8fc6a51916eb4815835a9f1b5e3`, following PR #138.
- Recovered PR #139, `product-integration-merchandising-state`, final head `e51820bd17033bc54fd780ffc528a61e2371e814`. Read the actual historical ledger, current audit, code and tests rather than restarting Task 87 from a chat summary.
- Exact-head quality `36370738788`, browser `36370738741` and security `36370738852` report success. Quality job `108766359718` confirms dependency audit, formatting, lint, TypeScript/Prisma generation, unit/schema, clean migrations/integration and production build.
- Reviewed snapshot cancellation, scoped drafts, pending guards, response types, validation, no-store, isolated fixtures and browser journeys. No existing review threads were present. Continuation review `5333509722` is an author-side review, not an independent approval.
- Marked ready and squash-merged PR #139 with expected-head protection. Merge response and subsequent main read confirm **`912e64b3ef91644abe9b8c2475ea3faffb519597`**.
- No new migrations, production data changes, provider activation or deployment were performed in that acceptance step. Historical test counts remain historical unless independently rechecked.

## Current master phase reconciliation

**Phase 0:** historical baseline code/test acceptance recovered; deployment proof must be rechecked. PR #108 fixed dated discovery fixtures without changing the rolling 30-day rule. Do not redeploy its old SHA over newer accepted main.

**Phase 1:** historical authored inventory exists, refreshed here for the directory surfaces. The original baseline recorded 73 domains, 65 pages, 8 handlers, 53 controllers, 357 endpoint paths, 119 models and 57 migrations. These are historical counts, not current proof. Fine-grained source/behavior and visual coverage remain to reconcile.

**Phase 2:** public route integrity is in progress in PR #140; implementation is published for review, not accepted. The old Movies, Series, TV, Creators and Shorts placeholders were reverified before replacement.

**Phases 3–5:** information architecture, design-system normalization and the full Viewer redesign are not accepted. This focused route repair is not a full redesign.

**Phases 6–8:** historical creator/Admin/operator/security/policy improvements exist, but complete creator simplification, Admin transformation and backend-to-surface acceptance remain open. Provider command audit/concurrency, raw-ID workflows and per-series hydration are explicit unresolved historical findings.

**Phases 9–12:** full PWA, measured performance program, official-policy advertising integration and route-by-route visual acceptance remain open. Manifest route repair alone does not establish installability or safe service-worker behavior.

**Phases 13–14:** historical regression/security gates passed on their exact heads; the master E2E and consolidated-workflow security review are not complete.

**Phase 15:** existing Android/iOS code is retained; the master platform phase has not started. Begin only after Web/PWA gates, using current official policy and explicit native-versus-web update boundaries.

**Phase 16:** this ledger and inventory are execution documentation, not final documentation acceptance. Reconcile remaining historical contradictions after implementation; preserve one architecture/product truth.

## Phase 2 — public route integrity, implementation under review

- Starting SHA: `912e64b3ef91644abe9b8c2475ea3faffb519597`.
- Working branch: `web-pwa-phase-2-route-integrity`; PR #140.
- Published implementation SHA: `539d65c6205df1e4eb2e844cbde3a2be48151789`; subsequent documentation/test-artifact changes require their own final-head gates. Ending accepted/merged SHA: pending.
- Inspected: main/PR/CI, historical source audit and authored classifications, public routes, Movie/Series services and policies, discovery/TV ownership, trusted region propagation, navigation/proxy/locale handling, Viewer shell, generated/static manifests, browser/integration fixtures, local production build/HTTP behavior and bundle script sets.
- Findings: four real catalog domains were still behind placeholder indexes; Shorts and Clips conflicted; the generated Upload shortcut was wrong and hidden by a competing static manifest. Old catalog readers confused upstream failure with missing content and used shared revalidation. Catalog page limits could precede rights filtering. TV directory identity must match the owned primary TV route, not a secondary output.
- Decisions: reuse existing catalog/VideoPolicy/Viewer components; anonymous directory reads never receive authentication cookies or operational controls. Filter eligibility before bounded keyset limits, then retain final public policy shaping. Preserve legacy Series no-rights-row behavior, exact territory precedence and Video hard public/playable requirements. No new schema or database indexes without measured justification.
- Changes: real EN/AR server-rendered Movies/Series/TV/Creators indexes, error/empty/retry/continuation states; bounded public directory APIs; Movie batch hydration; exact primary-TV identity; canonical Clips navigation and locale/query-preserving 308 aliases for `/shorts` and `/uploads`; single generated manifest with `/upload` and `/tv`; Movie/Series details reuse the Viewer shell and request-scoped trusted context, no-store reads and genuine-404 discrimination.
- Migrations: none. No backend capability removed; no production data/provider/native signing changes.
- UI surfaces: four directory families, old aliases, saved/default navigation destinations, PWA shortcuts and Movie/Series detail shell. Full detail translation/design and install assets remain later acceptance.
- Tests added: eight Web contract/navigation tests, two API query/pagination unit tests, seven PostgreSQL integration cases and three browser journeys. Integration includes traversal of 80 eligible movies after restricted entries, 96 catalog SQL/right comparisons at fixed time boundaries, unplayable/private/removed exclusions, Series release rules, primary-TV ownership and strict query rejection. Browser tests cover 27-title continuation, seeded real directory/detail links, EN/AR/RTL, mobile/desktop/TV-sized viewports, redirects and served manifest.
- Local results observed: packages build/Prisma generation, API/Web types, repository formatting/lint, 367 API unit tests and 171 Web unit tests passed; production Web build passed. PostgreSQL/full browser acceptance awaits CI; local PostgreSQL is unavailable.
- CI findings so far: quality run `36375460215` passed dependency installation/audit but stopped at documentation formatting; later quality steps were skipped, not passed. Formatting correction and final-head rerun are required; no retry-until-green claim.
- Local HTTP evidence: four real index route families in EN/AR and synthetic Movie detail returned 200; aliases returned 308 with locale/query; served manifest has the correct shortcuts. Inputs were explicitly synthetic, not production catalog/provider evidence.
- Visual validation: local Chromium refused navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`; no bypass or local screenshot acceptance claimed. Real browser and directory screenshot review remain pending.
- Performance: limited before/after build evidence, not CWV/API/DB/player/upload/device acceptance. HTML-declared gzip JS grew by 679 bytes for Movies/Home and 5666 bytes for Movie detail when adding the Viewer shell. No speedup claimed. Per-series full hydration remains a Phase 10 concern.
- Source transfer verification: run `36375169723` required exact locally tested `apps` tree `bc488eb9772510e8e99e2d23d41082a32e19fa06` and `tests` tree `1fdaf9704731c39f64fac1cac0e0d5b7c8d26e51` before a normal fast-forward review-branch push. That check is not product CI acceptance. Temporary transport files and workflow were removed; no persistent branch-writing automation is retained.
- Documentation publication: a later automated documentation request was rejected by tool safety checks and did not run. Its proposed branch-writing workflow is not used. The human feature inventory is instead published as an ordinary document edit, reconciling all 73 historical labels in grouped capability entries with explicit unresolved acceptance.
- Unresolved risks: final database/browser gate findings, full route-family design/accessibility, catalog concurrency rechecks, per-series hydration, complete Kids/profile policy review, service-worker cache/update safety and production trusted-edge assumptions. No claim of ignored critical/high defect closure.
- External evidence: production deployed SHA/health, provider credentials/commercial approvals, physical-device/store certification and real traffic measurements are not established. No deployment is claimed.
- Next: final focused PR gates, review screenshots, fix findings, record exact accepted head, merge with expected-head protection, verify main and existing deployment flow. Do not begin dependent master Phase 3 before acceptance.
- Rollback: revert the focused directory/alias/navigation change without a database rollback. Preserve already accepted security, rights, media-generation and merchandising-state fixes.
