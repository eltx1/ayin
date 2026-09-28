# AYIN Web/PWA master checkpoint

## Authority and resume contract

The user-supplied **AYIN MASTER WEB/PWA PRODUCT CONSOLIDATION** goal, phases **0–16**, is the current execution contract. `https://ayin.stream` is the canonical product. Preserve shared APIs, existing working systems, authorization, MFA, rights, moderation, transactional audits and financial controls.

Read this ledger before every phase. Verify remote main, outstanding PRs, exact tested heads and deployment evidence. Code and observed results take precedence over historical status text. Do not start a dependent phase before its relevant acceptance gates pass. Record engineering conclusions and evidence, never private reasoning.

The earlier program used different phase numbers (`2A` through `2J`, followed by historical `3–5`). Those numbers **must not be mistaken for completion of the current 0–16 phases**. Preserve the detailed history in [the historical checkpoints](AYIN_PRODUCT_INTEGRATION_CHECKPOINTS.md), [source audit](AYIN_PRODUCT_INTEGRATION_AUDIT.md) and [machine inventory](AYIN_PRODUCT_INTEGRATION_MATRIX.json). New master acceptance is recorded here. The requested human feature inventory is [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md).

## Resume verification — 2026-09-28

- Observed starting main: `3b459ac1e0f5c8fc6a51916eb4815835a9f1b5e3`, following PR #138.
- Open work recovered: PR #139, `product-integration-merchandising-state`, final head `e51820bd17033bc54fd780ffc528a61e2371e814`.
- Read the historical ledger, current audit and PR changes rather than restarting from Task 87 or the earlier chat summary.
- PR #139 quality run `36370738788`, browser run `36370738741` and security run `36370738852` all report success for that exact head. Quality job `108766359718` confirms dependency audit, formatting, lint, TypeScript/Prisma generation, unit/schema tests, clean migrations/integration and production build.
- Reviewed snapshot cancellation, scoped draft updates, pending guards, response types, validation, no-store headers, isolated fixtures and browser journeys. No existing submitted reviews or unresolved threads were present. Continuation review `5333509722` records the scope and remaining limitations; it is an author-side review, not an independent approval.
- PR #139 was marked ready and squash-merged with expected-head protection. The merge result and subsequent `refs/heads/main` read both confirm **`912e64b3ef91644abe9b8c2475ea3faffb519597`**.
- No new schema migrations, production data changes or provider activation were performed in that acceptance step.
- No local full-suite rerun, production deployment, production performance or physical-device verification is claimed by this continuation. Historical test counts remain historical unless independently verified in the new run.

## Mapping to the current master goal

| Master phase | Reconciled status | Evidence or remaining acceptance |
| --- | --- | --- |
| 0 — baseline | Historical code/test acceptance recovered; deployment proof must be rechecked | PR #108 resolved dated discovery fixtures without changing the rolling business rule. Subsequent accepted PRs, including #139, advanced main. Do not redeploy an old Task 87 SHA. |
| 1 — repository audit | Historical inventory exists; refresh against current accepted main | Historical baseline records 73 domains, 65 page routes, 8 route handlers, 53 controllers, 357 endpoint paths, 119 models and 57 migrations. These are baseline counts, not current counts. Preserve semantic/internal classifications. |
| 2 — broken/orphaned routes | **In progress** | Reverified that the generic section route still serves placeholders for Movies, Series, TV, Creators and Shorts. Repair real destinations and aliases before redesign. |
| 3 — information architecture | Not accepted | Group Viewer, Creator and Admin navigation; preserve roles and URLs. |
| 4 — design system | Not accepted | Audit and normalize existing tokens/components instead of inventing a separate product. |
| 5 — Viewer redesign | Not accepted | Route-by-route EN/AR, responsive, loading/error/empty and playback work remains. |
| 6 — creator simplification | Partly improved historically; not accepted | Revalidate Quick Upload and publishing, focused content editing and advanced disclosure. |
| 7 — Admin transformation | Several focused controls improved; not accepted | Group control centers and replace raw-ID workflows without weakening step-up or audit. |
| 8 — feature completion | Several historical operator/security/policy improvements; not accepted | Reconcile every intended surface against actual current code and tests. Provider command audit/concurrency and per-series hydration remain explicit historical review gaps. |
| 9 — PWA excellence | Not accepted | Manifest authority, shortcuts, safe cache boundaries, update/offline/reconnect and install evidence remain open. |
| 10 — performance | Not accepted | Establish reproducible before/after measurements; test timings are not production latency or Core Web Vitals. |
| 11 — advertising | Not accepted | Current official-policy review, inventory map, centralized controls and failure/consent acceptance required. |
| 12 — visual QA | Not accepted | Real route-family screenshots and representative viewports, RTL and accessibility coverage required. |
| 13 — full E2E | Historical regression suites passed; master acceptance not complete | Extend and run the current required Viewer/Creator/Admin/PWA/advertising journeys. |
| 14 — security regression | Historical security gates passed; master acceptance not complete | Review consolidated workflows, roles, ownership, MFA, financial controls and private cache boundaries. |
| 15 — Android/iOS | Existing implementations retained; master phase not started | Start only after Web/PWA gates. Verify current official platform rules and distinguish native changes from web-only updates. |
| 16 — documentation | In progress as an execution ledger, not final acceptance | Reconcile historical documents after implementation; retain one current architecture/product truth. |

## Current phase — 2: public route integrity

- Starting SHA: `912e64b3ef91644abe9b8c2475ea3faffb519597`.
- Working branch: `web-pwa-phase-2-route-integrity`.
- Ending SHA: pending implementation, review and acceptance.
- Inspected so far: current main/PR/CI state, historical checkpoint and audit, generic Viewer section page, static manifest, root package scripts and browser workflow.
- Confirmed defects: `(viewer)/[section]/page.tsx` still displays "Ready for the next layer" and future-feature copy for implemented domains. Static `public/manifest.webmanifest` has no shortcuts and differs from the generated manifest described in the audit. Verify actual response precedence before changing it.
- Decisions: reuse existing public catalog/discovery contracts and policy context; no duplicate Shorts product; preserve old links through explicit aliases. Missing upstream data must not be disguised as a successful empty catalog. Do not alter security, business rights or mature-content filtering to fill a page.
- Changes: canonical master ledger established. Product changes and human matrix update pending.
- Migrations: none planned for route integration.
- UI surfaces: Movies, Series, TV, Creators, Clips aliases, navigation/PWA shortcuts and relevant canonical links.
- Tests planned: route/link contracts, policy-context and upstream-failure behavior, pagination, actual browser navigation, EN/AR and mobile; all relevant existing quality/security/browser gates on final head.
- Test results: no acceptance yet for this phase. PR #139 results above validate its own head only.
- Visual validation: pending; no screenshot acceptance claimed.
- Performance: capture request and rendering/bundle evidence where practical. No improvement claim yet.
- Regressions/risks: locale-prefix redirects, geo/Kids context, server-side cookie forwarding, cursor bounds, static/generated manifest conflict and stale navigation settings.
- Execution environment: GitHub read/write and CI are available. Direct container DNS/clone and public archive retrieval failed in this continuation; this is not evidence that the repository or production service is down. Keep local and CI evidence distinct.
- External blockers: production-origin/deployment and device/provider/store evidence have not yet been established. Do not fabricate them.
- Next: inspect current catalog/discovery APIs and mounted components, implement focused route/link repair, review, test, record exact accepted/merged/deployed SHAs separately.
- Rollback: revert the focused route/alias/navigation change without database rollback. Do not undo already accepted security, rights, processing-generation or merchandising-state fixes.
