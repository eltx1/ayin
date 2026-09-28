# AYIN Web/PWA master checkpoint

## Resume contract and current truth

The user-supplied AYIN Web/PWA master goal, phases **0–16**, remains the execution contract. `https://ayin.stream` is the canonical product. Preserve existing systems, server authorization, MFA, rights, moderation, financial controls and transactional audit. Do not turn ordinary Web changes into independently maintained native products.

Before each phase, read this ledger, re-read current main and open PRs, inspect the actual code and exact-head checks, and confirm previous acceptance. Finish relevant tests and review before dependent phases. Record conclusions and evidence, not private reasoning. Historical phase numbers are not current master acceptance.

The earlier detailed ledger is preserved byte-for-byte in [the initial Phase 3 checkpoint](AYIN_PHASE3_INITIAL_CHECKPOINT.md). Its pending/test/environment statements describe that earlier point and are superseded below. The current capability inventory remains [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md); historical audit and checkpoint files remain evidence, not proof of current runtime completeness.

**Current main, re-read during this continuation:** `64df1952ba041b95c30e3139760bd9410059c5dc`.

**Current work:** PR #142, branch `web-pwa-phase-3-information-architecture`. It remains draft, unmerged and not production-deployed. The grouped navigation and Studio landmark repair passed browser acceptance; the full phase is blocked on publishing the verified dependency remediation and rerunning final-head gates. Do not mark Phase 3 or the master goal complete.

## Accepted predecessors

PR #139 recovered scoped merchandising loads/drafts with server MFA/audit retained. Final head `e51820bd17033bc54fd780ffc528a61e2371e814`; merge `912e64b3ef91644abe9b8c2475ea3faffb519597`. Exact-head quality `36370738788`, browser `36370738741`, security `36370738852` passed; author-side review `5333509722` was not an independent approval.

PR #140 repaired Movies/Series/TV/Creators indexes, policy-aware pagination, primary-TV ownership, canonical Clips/Upload aliases, manifest shortcuts and catalog detail shells. Final head `d4e66ad3d5c9e4239944d674cd982db3afb4e0d6`; merge `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`. Quality `36377946484`, browser `36377946464`, security `36377946520` passed. Reviews `5333986738` and `5334016117` were author-side. Fixed missing Account fixtures rather than weakening foreign keys or the rolling discovery rule.

**Last independently observed production release:** `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`. Validation `36378738334`; deployment `36379170040`, job `108791137393`; direct-origin health and immutable proof artifact `10952038374`. Verified archive SHA-256 `73d59985ffd39be4a769657960d5965244091ef90ab179410fe52d9c92775303`. Cloudflare sync `36379289647` succeeded. This is release-at-deployment-time evidence, not blanket acceptance of every journey or a claim about later production state.

PR #141 reconciled the source inventory without changing product runtime. Final head `88230732bfb81b3a522a7fc802ada6f84ad69c16`; merge `64df1952ba041b95c30e3139760bd9410059c5dc`. Quality `36380336982`, inventory `36380336245` passed; review `5334252911` was author-side. Historical snapshot counts are 73 feature labels, 70 pages, 8 handlers, 54 controllers, 364 endpoint paths, 119 models and 57 migrations; later files change counts. Source inventory is not full runtime, UI, security or device acceptance. No later production SHA is claimed here.

## Current master phase boundaries

Phase 0 baseline recovery and focused Phase 1 source reconciliation are recorded above. Focused Phase 2 public-route repairs are accepted. Phase 3 is under review. Phases 4–8 design-system, Viewer/Creator/Admin transformation and complete feature surfacing remain open. Phases 9–14 installed-PWA lifecycle, measured performance, official-policy advertising, route-by-route visual review, master E2E and security regression remain open. Phase 15 native preparation must wait for Web/PWA gates and current official platform research. Phase 16 whole-project documentation consolidation is not complete. Earlier working operator, creator and finance capabilities must be preserved, not blindly rebuilt.

## Phase 3 continuation — Studio landmarks and security gate

**Starting main:** `64df1952ba041b95c30e3139760bd9410059c5dc`. **Recovered PR head:** `9e7a9b98fb385b46bf4b88079379d2c6b15fb3f7`, tree `348ef8e90e50550eeaf997184dee107587ad2af3`. **Product repair head:** `b3ac3810b1c578d9ba3bab2a95081eadcb8e0564`. **Security-test head:** `415189cf52e8be2949cc20b70a130c0197106148`. Ending accepted, merged and deployed SHAs remain pending.

**Systems inspected:** actual PR/main/checkpoint state; quality, security and browser logs; Studio layout and playlist/channel/Creator TV wrappers; all three shared editor components; current workspace overrides and package-manager lock; generated remediation diff, registry integrity metadata and dependency paths; actual Fastify/Ajv runtime URI copies; upstream fixed-version tests; existing CI navigation contact sheet and individual workspace screenshots. The original navigation contract, server permissions and historical tests remain in scope.

**Implemented product changes:** the existing candidate groups Viewer navigation into at most five choices with a real Browse hub, keeps direct Upload prominent, groups all twelve Studio and nineteen Admin destinations with existing roles, localizes navigation/breadcrumbs and preserves keyboard/remote/mobile-dialog behavior. This continuation fixes nested main landmarks in three shared editors: `PlaylistManager`, `ChannelEditor` and `CreatorTvManager` accept an explicit embedded mode. Studio owns their main landmark; standalone creator routes retain theirs in all rendered states. No API, ownership, MFA, finance or moderation controls were changed.

**Local tests actually executed:** six new render tests in `creator-landmarks.test.tsx` pass for standalone/embedded initial states. Targeted formatting and lint pass. An older source/dependency snapshot was restored only to run these scoped tests; it is not an exact complete-current-branch local build. The local Node version differs from CI. No local full-suite or local browser acceptance is claimed.

**Browser regression and result:** recovered run `36484458814`, job `109137850698`, passed 56 of 58 tests and failed the two strict Studio landmark checks. The fix was published in `b3ac381...`; browser run `36496241866`, job `109176370501`, then completed successfully, including release build, browser acceptance and preserved visual evidence. The assertions were not weakened. Source inventory `36496241714` passed.

**Quality/security result:** recovered head `9e7a9b9...` passed quality `36484458743` and security `36484458770`. The subsequent `b3ac381...` quality `36496241839`, job `109176370279`, failed at production dependency audit; later steps were skipped, not passed. Security `36496241717` also failed. The unchanged dependency graph now reports two high-severity fast-uri advisories against both installed major versions: four high entries and one moderate entry overall. Do not merge based only on the green browser workflow.

## Verified dependency remediation — not yet published as the branch lockfile

The affected copies are fast-uri 3.1.6 through Ajv and 4.1.3 through Fastify schema/serialization dependencies. Reviewed same-major targets are **3.1.8 and 4.1.5**. Preserve Fastify, Ajv, all unrelated packages, integrity checks, audit threshold and frozen-install behavior.

Official upstream sources checked on 2026-09-28 include Fastify/fast-uri releases v3.1.8 and v4.1.5; advisories GHSA-qw65-cvwx-89v3 and GHSA-58mr-gqgx-xq4g; upstream `test/component-safe-serialization.test.js` at v4.1.5 and `test/ipv6-validation.test.js` at v3.1.7. The selected releases also include host-case normalization fixes. Package installation is not evidence of production exploitation or remediation deployment.

The temporary read-only preview used pinned pnpm 11.24.0, selected range-specific overrides, generated the lock with the package manager, then performed frozen installation and the unchanged production audit. It never had repository-write permission, retained credentials, production secrets or a deployment step. Preview run `36496794603` succeeded and produced artifact `11003557943`; its archive SHA-256 is `5971e94978abd94dd1ac45e89292be6fc3d4f0bd9d4b32cb1f58da9597e749a9`.

Added ten runtime regression tests resolving the actual transitive copies used by Fastify's schema compiler and Ajv, not an extra direct dependency. The original libraries fail six checks and pass four locally. A first candidate test used a bracket in userinfo rather than the malformed host addressed by the advisory; preview `36498517746` correctly exposed that fixture error (8 passed, 2 failed). It was replaced with three actual upstream-style malformed-host cases while retaining strict rejection assertions. The corrected original-library baseline still fails six of ten checks.

**Verified corrected preview:** run `36498826181` on source `415189cf52e8be2949cc20b70a130c0197106148` passed frozen installation, production audit and **all ten runtime tests**. The audit reports **one moderate entry and no high entries**, not zero vulnerabilities. Downloaded artifact `11003744073` and verified archive SHA-256 `5a2e0f92d8943b441a887a72ca7eef15423f52c460bcc0c34892464089f376c1`. The generated files and patch are byte-identical to the initial successful preview, so the test correction did not broaden the dependency update.

The verified lockfile is 227,910 bytes. Its expected Git blob is `c612a9d083eda41c1a2091d2eb4ebeaef19310fc`; SHA-256 `1efb634ebc9b755cc35e47adb7b5587670a7bbf08c88d1390ffd89e67014cb6c`. The workspace expected Git blob is `824edc74b90bde62490e56c29ccf97d1e83cafed`; SHA-256 `b223d51f3685104864603550c3c87faec2345202edc584b282f5ea61b5ded881`. The exact two-file patch is preserved at `docs/security/fast-uri-remediation.patch`, SHA-256 `d5366013554ea81e1c43d058e444dc308aa022b6e8f6fe6c19d96806b2e38e9f`.

**Publication boundary:** the branch's actual lockfile and workspace overrides have not yet been replaced. The generated candidate exists as verified evidence and a durable patch, not as an accepted or deployed dependency update. An authorized publication step is still needed. Native content edits are available, but no local authenticated Git push or supported local-file/patch write action is connected. A previous automated branch-writing request was rejected; it has not been recreated or bypassed. The temporary read-only preview workflow is removed in this checkpoint update now that its evidence is preserved.

## Review, performance, risks and next action

The existing navigation contact sheet and Arabic Studio/mobile finance views were actually inspected. They demonstrate grouped navigation on seeded CI screens, not universal finished design, physical-TV certification or production data. Dense finance forms, remaining consumer/developer copy, failed artwork and full route-family accessibility are later-phase findings. The landmark fix is backed by targeted rendering tests and browser acceptance, not just screenshot appearance.

No migration, native signing, provider activation or production-data mutation occurred. No new performance improvement is claimed. Existing limited Phase 2 script-size measurements remain in `PERFORMANCE_BASELINE_AND_RESULTS.md`; request-count assertions are not full CWV, API, database, playback or upload measurements.

**Next required operation:** publish exactly the two verified dependency files on the existing PR #142 branch without touching main or production. Then execute complete exact-head quality, security/dependency review, new runtime tests, integration/build and browser gates; inspect final visual evidence, complete review and fix material findings. Only after green acceptance may PR #142 be marked ready and merged with expected-head protection. Observe actual main/deployment proof before claiming release. Do not start dependent Phase 4 merely because the preview passed.

**Remaining risks:** the untouched branch dependency graph still fails the high-severity audit; the moderate advisory requires triage. Full page redesign, PWA, performance, advertising/provider, native-device and security-master acceptance remain open. Rollback the navigation separately through a validated release; once the dependency patch is adopted, do not reintroduce vulnerable URI versions merely to revert UI changes.
