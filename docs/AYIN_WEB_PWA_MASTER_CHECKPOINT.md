# AYIN Web/PWA master checkpoint

## Execution contract

The user-supplied AYIN Web/PWA master goal, phases **0–16**, is authoritative. `https://ayin.stream` is one canonical Web/PWA product with shared AYIN APIs and only justified platform capability adapters. Preserve existing working systems, server authorization, MFA, rights, moderation, financial controls and transactional audit. No private reasoning belongs in this ledger.

Before each phase, read this ledger, re-read main/open PRs and actual code, verify previous exact-head gates and observe deployment independently. Historical remediation phase numbers are not completion of current master phases. Never treat a successful preview, missing status or skipped test as accepted production behavior.

The current feature inventory is [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md). The detailed record immediately before dependency publication is preserved byte-for-byte in [Phase 3 gate-recovery history](AYIN_PHASE3_GATE_RECOVERY.md); its publication blocker is resolved below. Earlier navigation/source/history details remain in [the initial Phase 3 record](AYIN_PHASE3_INITIAL_CHECKPOINT.md) and the historical integration checkpoints. These are evidence, not competing current status documents.

## Current main and phase boundaries

Current accepted main: `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`. PR #142 is merged and deployed with independently rechecked evidence below. Current work is Phase 4A on `web-pwa-phase-4-design-foundations`; it is not accepted yet. Earlier run observations in this ledger describe their original moment, not current blockers.

Phase 0 baseline recovery, focused Phase 1 source reconciliation and focused Phase 2 route integrity are accepted with the boundaries below. Phase 3 information architecture is accepted; Phase 4A foundations are under implementation/review. Phases 4–8 design system, full Viewer/Creator/Admin transformation and full capability-to-surface acceptance remain open. Phases 9–14 PWA lifecycle, measured performance, official-policy advertising, all-route visual acceptance, complete E2E and simplified-workflow security remain open. Phase 15 platform preparation must follow Web/PWA gates and current official policy research. Phase 16 full documentation consolidation remains open. Preserve earlier integrated operator, creator and financial features.

## Accepted predecessors

PR #139: scoped merchandising cancellation/drafts and audited step-up workflow. Final head `e51820bd17033bc54fd780ffc528a61e2371e814`; merge `912e64b3ef91644abe9b8c2475ea3faffb519597`. Quality `36370738788`, browser `36370738741`, security `36370738852`; author-side review `5333509722`.

PR #140: real Movies/Series/TV/Creators directories, policy-aware keyset pagination, primary-TV ownership, canonical Clips/Upload aliases, manifest authority/shortcuts and catalog detail shells. Final head `d4e66ad3d5c9e4239944d674cd982db3afb4e0d6`; merge `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`. Quality `36377946484`, browser `36377946464`, security `36377946520`; author-side reviews `5333986738`, `5334016117`. Missing actor Account fixtures were repaired without weakening foreign keys or rolling discovery policy. Twelve seeded directory screenshots were inspected; this is not physical-TV/production data evidence.

Previous independently observed Phase 2 release: `39731c6a8a069e92732f95c4b7db7afa30cbb5c2` (superseded by the verified Phase 3 release below). Validation `36378738334`; deployment `36379170040`, job `108791137393`; direct-origin health and immutable proof artifact `10952038374`, archive SHA-256 `73d59985ffd39be4a769657960d5965244091ef90ab179410fe52d9c92775303`. Cloudflare sync `36379289647` succeeded. No later production state is implied.

PR #141: deterministic source inventory/semantic reconciliation. Final head `88230732bfb81b3a522a7fc802ada6f84ad69c16`; merge `64df1952ba041b95c30e3139760bd9410059c5dc`. Quality `36380336982`, inventory `36380336245`; author-side review `5334252911`. The historical source snapshot counted 73 feature labels, 70 pages, eight handlers, 54 controllers, 364 endpoint paths, 119 models and 57 migrations; later additions change totals. Static inventory does not prove full behavior or authorization.

## Phase 3 implementation and browser recovery

Starting SHA: `64df1952ba041b95c30e3139760bd9410059c5dc`. Initial navigation commit: `fdeb9082192ba255b364f76f5bb68095952cd521`. Recovered navigation head: `9e7a9b98fb385b46bf4b88079379d2c6b15fb3f7`. Studio repair: `b3ac3810b1c578d9ba3bab2a95081eadcb8e0564`. Final Phase 3 head `dd7b3e9682a272d8c3fd4f333456450e55fa69eb` merged as `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`; see the acceptance and deployment entry below.

Inspected systems: Viewer shell, public controls/flags/locale, Studio/Admin layout/navigation/role/session/MFA, TV focus and Back handling, public catalog/deep links, shared creator editors, browser fixtures/CI/screenshots, source inventory, dependency graph and upstream URI fixes. [Information architecture](AYIN_INFORMATION_ARCHITECTURE.md) records the actual hierarchy.

Implemented UI: real `/browse`, at most five primary Viewer choices, direct Quick Upload, grouped twelve Studio/nineteen Admin destinations without new server permissions, localized breadcrumbs, modal keyboard/remote focus and viewport-resize recovery. Shared public bootstrap reads avoid a second Browse configuration fetch. Three shared editors have explicit embedded mode so Studio owns one main landmark while standalone routes retain theirs. No schema/API/financial/provider/native or production-data mutation.

Regression evidence: recovered browser run `36484458814` passed 56/58 and exposed two nested Studio main-landmark failures. The three-editor repair preserved the strict assertions; six targeted local render tests passed. Browser run `36496241866`, job `109176370501`, then passed after release build. Final-head browser acceptance remains required after dependency publication.

Earlier candidate formatting, strict optional CSS typing, React effect state, modal focus containment, test selector ambiguity and viewport-hidden modal issues were corrected rather than suppressed. Historical responsive, upload, MFA/session/privacy, rights, HLS/MP4/IMA, live and operator journeys are retained. Existing navigation screenshots were inspected; full route-family design/accessibility, dense finance forms and failed-artwork fallback remain subsequent work.

## Dependency security recovery — publication resolved on 2026-09-29

Quality `36496241839` and security `36496241717` stopped at four high fast-uri entries across two installed versions, plus one moderate entry. Subsequent skipped quality steps were not passed. The library update is a required gate fix, not a relaxation of the audit threshold.

The same-major targets are fast-uri **3.1.8 and 4.1.5** with range-specific overrides. Preview `36498826181` on source `415189cf52e8be2949cc20b70a130c0197106148` passed package-manager lock generation, frozen installation, unchanged high-severity audit and ten tests against the actual transitive Fastify/Ajv copies. One moderate advisory remained. Artifact `11003744073` was downloaded and its archive SHA-256 verified as `5a2e0f92d8943b441a887a72ca7eef15423f52c460bcc0c34892464089f376c1`. An incorrect userinfo-bracket fixture was corrected to upstream malformed-host cases; the original libraries still failed six of ten tests.

The user confirmed use of connected GitHub/Actions. Temporary object-publication run `36501428878`, job `109192928895`, on source `21a068f02c6faa2b5a3f87be1206eb044bcaa3dd` succeeded: verified the committed patch and old/new file hashes, applied exactly two paths only in the job workspace, and stored the two verified Git blobs. It did not write any branch, merge, deploy or retrieve production/server secrets. The normal GitHub connector then published **`b40a2a22d9e0f747f429410fab6193766c906137`** on the review branch using a fast-forward update and removed the temporary helper. No additional desktop connection is required.

Read-back confirms the actual branch lockfile is Git blob `c612a9d083eda41c1a2091d2eb4ebeaef19310fc`, 227910 bytes, SHA-256 `1efb634ebc9b755cc35e47adb7b5587670a7bbf08c88d1390ffd89e67014cb6c`. Workspace blob `824edc74b90bde62490e56c29ccf97d1e83cafed`, SHA-256 `b223d51f3685104864603550c3c87faec2345202edc584b282f5ea61b5ded881`. Patch SHA-256 `d5366013554ea81e1c43d058e444dc308aa022b6e8f6fe6c19d96806b2e38e9f`. [Security remediation evidence](security/FAST_URI_REMEDIATION.md) preserves details. Unrelated dependencies, integrity checks, release-age policy, frozen installation and audit threshold are unchanged.

Observed at publication head `b40a2a2`: security `36501609936` and inventory `36501609843` succeeded; quality `36501609899` and browser `36501609867` were still running when this entry was written. These are not final-documentation-head results; recheck exact-head gates before merge.

## Reproducible audit evidence and acceptance plan

The existing read-only Product source inventory workflow now retains its clean tracked-source archive and source SHA beside the inventory and SHA-256 manifest. `git archive HEAD` excludes `.git`, local credentials, untracked runtime data, dependencies and build output. It neither pushes nor deploys. This supports exact-source review/restoration instead of treating an older restored dependency/source snapshot as the current branch. Historical statements about inventory-only artifacts refer to their original runs.

No complete local application build is claimed for the current branch. Local Node differs from CI; older restored dependencies may support explicitly scoped tests, not full exact-version acceptance. CI remains authoritative for pinned install/build/runtime/integration/browser/security results. No network or browser restriction was bypassed.

Performance: no new speedup claim. Existing limited Phase 2 gzip script measurements remain in `PERFORMANCE_BASELINE_AND_RESULTS.md`; shared request-count assertions are not CWV/DB/player/upload evidence. Measure before/after and keep later-phase regression gates.

The Phase 3 acceptance plan above is now satisfied by the actual merge/gate/deployment evidence below. Do not re-run the resolved publication workaround or ask for an extra desktop connection. Next work is the focused Phase 4A foundation, followed by remaining Phase 4 components and later master phases.

Remaining risks: the moderate advisory needs explicit triage; app-wide visual/accessibility, account synchronization, catalog concurrent-policy/per-series hydration, PWA cache/update/offline behavior, advertising/provider and native/device/store acceptance remain open. Do not infer that one green phase completes the master goal.

Rollback: separate the navigation revert from the adopted security fix. Do not restore vulnerable URI versions just to revert UI. No database rollback or production-data reversal is needed for this phase. All reviews recorded above are author-side unless explicitly stated otherwise.

## Phase 3 acceptance re-read and Phase 4A start — 2026-09-29

PR #142 is merged, not pending: final reviewed head `dd7b3e9682a272d8c3fd4f333456450e55fa69eb`, merged main `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`, source tree `89f2201616e3c52e87a6fe96e31ea8bb4f64f02b`. Quality `36504244566`, browser `36504244498`, security `36504244483`, inventory `36504244533` succeeded; author-side final review `5346404231` is not an independent approval. Earlier pending/publication statements above are historical and superseded by this entry.

Re-read the merge and actual main; no open PR was present. Downloaded source artifact `11006441878`, verified ZIP SHA-256 `0819ab35693eddbcfc0f511ab2e9a132e2bf78768a32fc0c019944f6fae9b6ff`, all 1251 tracked-file hashes, and exact Git tree parity with merged main. Source archive commit `929cf7527ce40d93b2b85985bec5ecfd5b7f02da` is a PR test-merge snapshot, not main.

Actual Phase 3 deployment `36505563759`, job `109206107284`, succeeded including exact validated commit and direct-origin health. Downloaded proof artifact `11006692748`; archive SHA-256 `e0257992c5832989a2fbb7c1013945fcfa6cd36af990e32dce6cd6fe1190a07d`. Proof records release `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`, validation `36505103030`, deployment `36505563759`, attempt 1, isolated account `ayin`. This proves that release at deployment time only. No additional desktop connector is required.

**Phase 4A starting SHA:** `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`. **Branch:** `web-pwa-phase-4-design-foundations` (pre-existing at exactly that SHA; no unmerged work overwritten). This is a focused design-system foundation subphase, not full Phase 4 or final route redesign acceptance.

**Inspected:** global palette/spacing/elevation/focus/safe-area/motion styles, shared Button/focus package, all existing UI primitives, Viewer cards/heroes/states/directories/Browse, Studio/Admin shells/dashboards, forms/playlist workflows, source inventory and CI. Preserve accepted navigation/security code. Found absent image-load recovery, repeated headers/actions/stats, small gradient text and undefined new-system typography roles. Existing tokens are moved intact; add semantic roles rather than recoloring all pages blindly.

**Baseline:** 190 Web unit tests passed locally on the accepted source before edits. Local Node 22.16.0 satisfies engines but differs from CI-pinned Node 24.19.0. Restored Web test/build dependencies match declared versions; original transitive URI dependencies in the old local tooling snapshot are not the accepted production graph. Use local results only for scoped Web/component checks; exact frozen install, API/security/audit/browser acceptance remains CI. An attempted package-manager bootstrap tried to reinstall after lock mismatch and failed DNS; it did not alter tracked dependency files. No network restriction bypass.

**Changes, tests, visual/performance evidence, ending SHA and review:** in progress; acceptance requires recorded final-head gates. No schema/API/auth/ownership/MFA/financial/rights/provider/native changes. Keep the adopted URI security remediation. Rollback the focused presentation PR without database rollback. Next: validate reusable design primitives, adopted surfaces and failed artwork, then proceed with remaining Phase 4 interactions/tables/forms before full page redesign.

### Phase 4A implemented candidate — pre-CI local evidence

Changes: retained original global tokens in a single imported token file; new semantic text/action/status/typography/control roles; reusable server-compatible headers, native buttons/links, explicitly labelled input/select fields, status/badges and actual-data metric lists; source-keyed client image-error leaf with stable decorative fallback. Adopted in Browse/directories, Studio overview/playlists, Admin overview/search. Removed only migrated duplicate selectors; did not alter backend functions, queries, rights, roles, MFA, provider configuration or upload behavior.

Local results: 201/201 Web tests (45 files), including 11 new foundation/token/card tests; Next type generation and TypeScript, full Web lint and formatting, and production Web build passed. New browser journeys for image failure/recovery/dimensions/RTL and real playlist creation/Admin semantics are authored, not yet run. CI images must be inspected before acceptance. The existing historical browser/security/integration suites remain enabled; exact-head acceptance is pending.

Design evidence and component coverage: `docs/AYIN_DESIGN_SYSTEM.md`. All new components have a real current consumer; remaining Phase 4 interaction/table/editor/toast work is explicitly not accepted. No new UI dependency. Performance before/after manifest evidence is being collected on comparable local builds; no speedup, field Core Web Vitals, DB latency or player/upload claim.
