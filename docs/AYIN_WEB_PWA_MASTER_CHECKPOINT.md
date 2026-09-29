# AYIN Web/PWA master checkpoint

## Execution contract

The user's AYIN Web/PWA master phases **0–16** are authoritative. `https://ayin.stream` remains one canonical product with shared APIs and justified platform capability adapters. Preserve working systems, authorization, MFA/step-up, content rights, moderation, financial controls and transactional audit. Record conclusions and evidence, never private reasoning.

Before every phase, read this ledger, verify actual main/PR state and previous exact-head gates, inspect code and observe deployment separately. A successful preview, skipped check, historical phase number or merged PR is not production verification. The current feature authority is [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md). Detailed prior attempts and security-publication history remain in [the pre-acceptance ledger](history/AYIN_CHECKPOINT_BEFORE_PHASE3_ACCEPTANCE.md), [gate recovery](AYIN_PHASE3_GATE_RECOVERY.md), [initial Phase 3 record](AYIN_PHASE3_INITIAL_CHECKPOINT.md) and historical integration checkpoints. Their pending states are historical and superseded here.

## Current baseline — 2026-09-29

Verified main: **`96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`**, accepted Phase 3 PR #142. Final reviewed PR head `dd7b3e9682a272d8c3fd4f333456450e55fa69eb`; identical source tree `89f2201616e3c52e87a6fe96e31ea8bb4f64f02b`. Expected-head-protected squash merge and a subsequent main ref read both confirm the result.

Phase 0 baseline recovery, focused Phase 1 source reconciliation and Phase 2 public route repair were accepted. Phase 3 navigation and its required regressions/security repair are now accepted. **Phase 4 design-system foundation is the current work**, on `web-pwa-phase-4-design-foundation`, starting from the main SHA above. It is not yet implemented/accepted by this entry. Phases 5–16 full role-specific redesign, feature completion, PWA, measured performance, advertising, visual/E2E/security revalidation, native readiness and documentation consolidation remain open. No full-master completion is claimed.

The existing main-push quality run `36505103030` is validating the merged SHA; its deployment is not yet observed here. Last independently observed release remains `39731c6a8a069e92732f95c4b7db7afa30cbb5c2` until the new deployment proof is read. Do not mistake this historical release for current live state.

## Accepted predecessor evidence

PR #139: scoped merchandising draft/request recovery. Final head `e51820bd17033bc54fd780ffc528a61e2371e814`; merge `912e64b3ef91644abe9b8c2475ea3faffb519597`. Quality `36370738788`, browser `36370738741`, security `36370738852`; author-side review `5333509722`.

PR #140: rights-aware Movies/Series/TV/Creators directories, primary-TV ownership, canonical Clips/Upload aliases, one manifest and catalog detail shells. Final head `d4e66ad3d5c9e4239944d674cd982db3afb4e0d6`; merge `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`. Quality `36377946484`, browser `36377946464`, security `36377946520`; reviews `5333986738`, `5334016117`. Missing actor Accounts were inserted in test fixtures without weakening foreign keys or rolling discovery policy.

Observed #140 release: validation `36378738334`, deployment `36379170040`, job `108791137393`, direct-origin health and immutable proof artifact `10952038374`, archive SHA-256 `73d59985ffd39be4a769657960d5965244091ef90ab179410fe52d9c92775303`. Cloudflare sync `36379289647` succeeded. This is evidence at that deployment time.

PR #141: deterministic source/semantic inventory reconciliation. Final head `88230732bfb81b3a522a7fc802ada6f84ad69c16`; merge `64df1952ba041b95c30e3139760bd9410059c5dc`. Quality `36380336982`, inventory `36380336245`; review `5334252911`. Static inventory is not runtime or authorization acceptance.

## Phase 3 — accepted navigation, PR #142

**Start:** `64df1952ba041b95c30e3139760bd9410059c5dc`. **Final head:** `dd7b3e9682a272d8c3fd4f333456450e55fa69eb`. **Merged end:** `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`.

**Inspected:** Viewer/Studio/Admin shells, flags/product controls, exact role visibility, shared access/MFA, locale routing, current routes, public catalogs, modal/TV focus and Back, shared creator editors, browser traces/screenshots, dependency lock and transitive URI code/tests, source inventories and deployment workflows.

**Implemented:** real `/browse`; at most five primary choices preserving enabled controls, flags, order and aliases; direct Quick Upload; grouped twelve Studio/nineteen Admin destinations; localized breadcrumbs; keyboard/remote-safe modal navigation and resize handling; shared public bootstrap reads; explicit embedded editor mode so Studio owns one main landmark and standalone routes retain theirs. No API guard, rights, ownership, financial, moderation, provider or native change. No migrations.

**Root-cause fixes:** corrected nested creator main landmarks; strict optional CSS type and React effect handling; modal keyboard/remote focus; viewport-hidden dialog ancestry; restored `--shell-gutter` consumed by existing public page styles. A source test failed before restoring the gutter and passed after; browser tests measure actual padding across six routes in three EN/AR layouts. Arabic Watch's global CSS selector was traced to a temporary hidden streamed copy, then scoped to one accessible main/player/controls without `.first()`, waits, skipped tests or lost LTR/Arabic assertions. See [visual review](AYIN_PHASE3_VISUAL_REVIEW.md) and [Arabic trace review](AYIN_PHASE3_ARABIC_PLAYER_REVIEW.md).

**Dependency security:** actual adopted fast-uri 3.1.8 and 4.1.5 replace 3.1.6/4.1.3 within their major lines. Ten transitive Fastify/Ajv URI regressions are retained. Frozen install, integrity, release-age and high-severity audit remain unchanged. Publication through verified Git blobs and normal connector tree/commit/ref operations succeeded; no additional desktop connection was needed. Temporary publication helpers were removed. [Exact security evidence](security/FAST_URI_REMEDIATION.md) preserves hashes and preview/publication boundaries. One moderate advisory remains for explicit triage; passing the high gate is not zero vulnerabilities.

**Final checks:** quality `36504244566`, browser `36504244498`, security `36504244483`, inventory `36504244533` all succeeded. The complete browser suite contains 59 tests. Quality includes audit, formatting, deployment tools, lint, TypeScript/Prisma, units/schema, clean migrations/integration and production build. Earlier corrected-gutter source passed 190 Web tests in 42 files locally with restored frontend dependencies/Node 22.16.0; CI's pinned environment remains authoritative.

**Source proof:** artifact `11006441878`, archive SHA-256 `0819ab35693eddbcfc0f511ab2e9a132e2bf78768a32fc0c019944f6fae9b6ff`; all 1251 tracked hashes and source tree verified. Its SHA `929cf7527ce40d93b2b85985bec5ecfd5b7f02da` is the PR test-merge snapshot, not main. Snapshot inventory: 71 pages, eight handlers, 54 controllers, 364 endpoint paths and 73 feature labels; no runtime completeness inferred.

**Visual proof:** final artifact `11006368253`, SHA-256 `26ba569e8b8444ca1859281d3132435f35089c65e53d149172d42601d3243251`. All 28 earlier corrected images were inspected; 22 final PNGs match them byte-for-byte and all six changed images were separately inspected. This covers navigation, gutters, responsive/Arabic and modal resize fixtures, not full large-data, physical-TV or product-wide accessibility certification. Low contrast on old gradient action labels, missing artwork fallback and dense finance forms are retained design findings for subsequent phases.

**Review/merge:** author-side final review `5346404231`, no unresolved review threads, ready transition, protected squash merge and actual main read. Reviews are not independent approvals. Deployment remains a separately observed stage.

**Performance/risk/rollback:** no speedup claim. Existing Phase 2 limited gzip comparisons and current shared-request assertions are not CWV/DB/player/upload benchmarks. Preserve the required measured program. Concurrent default AdPlacement initialization errors seen in the IMA fixture require separate advertising review. Keep security patches when independently reverting navigation; no database rollback is required.

## Phase 4 — design-system preflight

**Starting SHA:** `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`. **Branch:** `web-pwa-phase-4-design-foundation`. **Ending accepted SHA:** pending.

Read this checkpoint, main, prior gates and exact source. Inspected existing global tokens and all CSS variable consumers, shared UI package/native Button, Viewer Hero/MediaCard/rows/states, navigation dialogs/sidebars, directory/Browse markup, forms and the actual screenshots. The Web source currently contains 47 CSS files. Reuse the established palette, spacing, radii, focus/motion/safe-area contracts and server-rendered content instead of replacing the product architecture.

Confirmed findings: normal white labels lose contrast on the bright orange/coral/magenta ends of the legacy multicolor action gradient; missing artwork displays broken-image indicators; reusable form/table/status/page components are uneven, with raw page-specific layouts. The existing gutter regression is already fixed and remains covered. TV appearance variables are supplied by channel data, not automatically missing tokens.

Planned implementation: semantic action/typography/control tokens with measured contrast, consistent small reusable page/form/data/status primitives, a minimal artwork-failure boundary that does not make whole catalog pages client-rendered, and reuse rather than duplicate existing navigation/modal/ads/player systems. Progressive disclosure must not hide the primary action or weaken server controls. A documented component inventory distinguishes reused, normalized and newly added primitives; full page migrations remain Phases 5–7/12.

Current official W3C contrast, target-size and dialog guidance was checked on 2026-09-29. Use 4.5:1 for ordinary text, correct large-text exceptions and a project 44px touch target; do not mislabel 44px as the WCAG 2.2 AA minimum. Actual keyboard, RTL, reduced-motion, viewport and before/after evidence remain required; no certification is claimed from token math alone.

No Phase 4 code, screenshots, performance result or final test acceptance is claimed by this preflight entry. Next: implement focused foundation changes, run relevant/full quality gates, inspect actual browser images, fix findings, update this ledger and merge only after review. Observe the existing #142 deployment while this work remains isolated on its own branch. No production data/provider/credentials/native signing action is introduced.
