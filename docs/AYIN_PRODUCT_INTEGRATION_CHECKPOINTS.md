# AYIN product integration checkpoints

## Resume contract

Read this file before every phase. Verify the remote branch and CI rather than trusting the last prose update. Preserve the Web/PWA as the primary product. Do not start Phase 2 before Phase 1 acceptance. Do not mark inventory matches as complete product integration.

## Phase 0 — complete, merged

- Starting main SHA: `70b54af1963203711eb9bb07bba17ddc4b4ec45b`.
- Starting PR #108 head: `c1671d97339024b375d141269b728a1d9006e3d4`.
- Verified ending PR head: `f32a5da34abfcc6c79e401964ad50784808e74cd`.
- Ending main / new program baseline: `5de155c19832e55a1d19450eb78d029432c01680`.
- Findings: Task 87 was open; security and browser passed, quality failed only in discovery pagination. The three fixed dates August 27–29 aged out of the rolling 30-day NEW_ON_AYIN window. At CI time September 27 03:05 UTC only August 29 remained eligible, so the null cursor was correct. Policy enforcement runs after page construction and was not the cause. Offset and maxItems have separate review items in the audit.
- Changes: relative fixture dates from one captured reference instant; include a real 31-day-old video; assert all three page titles, final null cursor and full-row exclusion of old content. No production behavior changed or assertion weakened.
- Migrations: none added by Task 87 or this fix; existing clean migration gate passed.
- Tests added: expanded discovery pagination regression, end-of-row and rolling-window exclusion assertions.
- Tests executed: format, lint, typecheck, unit/schema, production build passed locally. Full CI quality run [36291281131](https://github.com/eltx1/ayin/actions/runs/36291281131) passed including 483 API integration tests in 123 files and 4 DB integration tests. Browser run [36291281127](https://github.com/eltx1/ayin/actions/runs/36291281127) passed all 31 tests. Security run [36291281133](https://github.com/eltx1/ayin/actions/runs/36291281133) passed. All runs target the same verified PR head.
- Measurements: local API unit suite 345 tests / 6.76s; Web unit suite 94 / 1.75s; local Next compilation 4.2s; browser CI suite 3.1 minutes. These are test/build measurements, not production performance claims.
- Remaining issues: product integration audit gaps; historical TASK_PROGRESS.md ended at Task 38.
- External blockers: none for Phase 0. Production credentials, device certification and live-load testing remain separate.
- Next phase: Phase 1 master audit.
- Rollback: the regression fix changes tests only. Task 87 adds no schema migration. Reverting its merge removes the operations dashboard and its settings/service additions; do not confuse this with a data rollback.
- Merge: [PR #108](https://github.com/eltx1/ayin/pull/108), squash, expected-head protection used and success confirmed.

## Phase 1 — complete, merged

- Starting SHA: `5de155c19832e55a1d19450eb78d029432c01680`.
- Historical initial audit checkpoint SHA: `dfb2bcea480c138f8139435a77a81abeefbad385`, Draft [PR #109](https://github.com/eltx1/ayin/pull/109). Verified final audit head: `14f9c37870700f39455a62bcb51acaf748484b84`; ending main SHA: `99ba69657dd8db6a951f6eae7b996155617b0fd5`. PR #109 was safely squash-merged with expected-head protection.
- Findings: see `AYIN_PRODUCT_INTEGRATION_AUDIT.md`; source inventory has 73 feature domains, 65 page routes, 8 route handlers, 53 controllers, 357 endpoint paths (355 decorators), 119 models and 57 migrations.
- Changes: master plan; deterministic source inventory script and JSON; human evidence matrix; initial risk register and workflow baseline. Read-only production HTTP probes additionally confirmed placeholder browse destinations and static-manifest precedence; controller guards and Admin/Studio integration entrypoints were inspected. No product implementation changes yet.
- Migrations: none.
- Tests added: none; this is a source/audit artifact. Verify script syntax, deterministic output at a fixed SHA, matrix structure, paths and formatting.
- Tests executed: inventory scanner and probe syntax checks; two scanner runs at baseline SHA were byte-identical; 355 route decorators reconciled to 357 concrete paths; read-only Service Worker and compiled DiscoveryService probes reproduced the documented cache/cursor hazards. Phase 0 results are baseline evidence, not evidence for future code.
- Performance measurements: repository counts only. No production latency, CWV, bundle comparison or device benchmark claimed.
- Remaining issues: implementation findings R01–R21; full visual/device acceptance and production measurements stay assigned to Phases 2–5. Semantic classification of all 73 domains and source/boundary/role/mobile/RTL evidence review of all 73 route entrypoints are complete; no claim that unresolved UI behavior passes.
- External blockers: physical iOS/Android/TV device/store checks and real production traffic/credential-dependent integrations unavailable in this workspace. CI provides PostgreSQL integration coverage; local PostgreSQL is not installed and the package installer failed on UID/group permissions; no permission bypass attempted.
- Next phase: Phase 2A secure re-authentication and media/database operator integration after audit validation. Later implementation phases are NOT started.
- Rollback: audit files and scanner are additive; remove their commit without database or runtime effects.

### Phase 1 completion delta

- Starting continuation SHA: `0a696122e9031e10ccca80becc1d39490f949aa3`; its full quality gate passed in run `36292205722`.
- Added authored semantic ownership for every requested domain, validated against actual backend files, 119 model names and mounted routes; retained source candidates separately.
- Added per-entrypoint layout/error/loading boundary, role/data-ownership and mobile/RTL evidence scope for all 73 route entries. Reviewed global focus/reduced-motion, RTL inheritance and known shell gaps.
- Verified inventory regeneration retains the authored review; formatting, schema/path integrity and deterministic generation are required for the final audit revision.
- No product code, data, migrations, credentials or deployment changed in Phase 1. No production-performance measurement or physical-device certification claimed.

### Phase 1 acceptance

- Full quality run [36292626251](https://github.com/eltx1/ayin/actions/runs/36292626251), attempt 2, passed on the final audit head: format, lint, typecheck, unit/schema, 4 DB integration and 483 API integration tests, production build.
- Attempt 1 stopped while downloading pinned FFmpeg; a read-only local download returned a verification HTML page, not the archive. The checksum was not changed or bypassed. One rerun downloaded and verified the original pinned binary successfully.
- Local production build and isolated cache/cursor probes passed again. Incremental Next compilation 484ms is a warm build measurement, not a production performance claim.
- Browser/security workflows did not trigger for audit-only changes; Phase 0 browser/security results remain baseline evidence, not reruns.

## Phase 2A.1 — shared Admin re-authentication, complete and merged

- Starting SHA: `99ba69657dd8db6a951f6eae7b996155617b0fd5`; checkpoint read before implementation.
- Findings: the server already enforces step-up but Admin web error handlers only show a message. Existing observability metadata includes SUPERADMIN as a hard boundary; do not broaden access as an incidental frontend change.
- Changes: shared Admin error handling opens a native modal only for HTTP 403 / STEP_UP_REQUIRED; manual verification entrypoint for signed-in administrators. MFA status controls code visibility; real step-up endpoint rotates the session. No automatic replay of privileged operations. Cancel/close clears form secrets and aborts pending client requests. English/Arabic labels and modal focus/RTL/responsive behavior.
- Migrations: none; backend authorization, audit and rate limits unchanged.
- Tests added: error-code/status discrimination, malformed response, listener cleanup, no automatic retry; browser journey for cancellation, password failure, real MFA success, mobile sizing and Arabic direction.
- Tests executed: Web unit suite 100/100, lint, typecheck and production build passed locally; full quality run `36293273970`, security run `36293273862` and all 32 browser tests in run `36293273908` (3.2 minutes) passed on the verified implementation SHA.
- Performance measurements: Web unit suite 1.14s; no product performance claim.
- Remaining issues: detailed media/database operator integration is the next subphase; this is not completion of Phase 2A or Phase 2.
- External blockers: local PostgreSQL unavailable; real database/browser coverage will run in CI.
- Next phase: 2A.2 media/database operational visibility.
- Verified implementation SHA: `2d22fc6d0a1e7519e2ce57f643d41e3cc7f2e3e6`; ending main SHA: `f2440c3b3d5aaf9863ba7aeeae3f69bdd08a4ef7` via safely merged PR #110.
- Rollback: revert this additive UI/error-handling change; no schema or server assurance changes to reverse.

## Phase 2A.2 — media/database operational visibility, complete and merged

- Starting SHA: `f2440c3b3d5aaf9863ba7aeeae3f69bdd08a4ef7`; checkpoint read before implementation.
- Findings: existing media queue/adaptive and PostgreSQL endpoints expose operational evidence without adequate detailed UI. Database endpoint is SUPERADMIN-only under the existing guard; this boundary remains intact. Queue retry/backfill/recovery mutations need a separate safety review before adding controls.
- Changes: two canonical nested Operations destinations; bounded recent-job title search, workers/capacity/adaptive rollout metrics, connection pools/application counts and aggregate statement timings; no SQL text. Shared access fetch for Sidebar and new workspaces; role-aware links; cancellable reads keyed to account/roles/request revision so stale responses cannot populate a newer view. Explicit loading, no-data, failure/retry and fetched-time states, English/Arabic and keyboard-scrollable tables. Read-only surfaces only.
- Migrations: none; no API authorization or schema changes.
- Tests added: role matrix, uncached authenticated cancellable endpoint reads and error-vs-empty behavior; browser journey for actual media/database APIs, ADMIN denial and SUPERADMIN acceptance, error/retry, one shared session request, Arabic mobile overflow and absence of privileged writes. The browser fixture explicitly resets media state (account reset alone does not clear channels/jobs), then seeds a real failed job to exercise populated tables, title search and null-stage rendering.
- Tests executed: local Web unit suite 109/109, lint, typecheck and production build passed. Full quality run `36294290296`, security run `36294290288` and all 33 browser tests in `36294290317` passed on `95db413a1ee228266922fda9d6da05be706452a1`. An initial lint finding rejected synchronous state resets inside effects; implementation was refactored to request-keyed results rather than weakening the lint rule.
- Performance measurements: local Web unit suite 1.96s; new workspaces issue one shared session read, then two parallel media reads or one database read; browser assertion passed. The full browser suite took 3.1 minutes. No production latency/load benchmark claimed.
- Remaining issues: recommendation/trending evaluation, detailed observability, warehouse visibility and all other Phase 2 gaps remain open. Queue retry/backfill/recovery controls are reserved for 2A.3; this subphase is not completion of all media operator capability.
- External blockers: local PostgreSQL and Playwright Chromium unavailable; CI runs real integration/browser tests. Physical devices remain external.
- Verified ending PR head: `95db413a1ee228266922fda9d6da05be706452a1`; ending main SHA: `de1cc33fca438b05be1f67acb3d8ece2dca7d82c`, merged as PR #111 with expected-head protection.
- Next phase: 2A.3 safety-reviewed media actions; implementation has NOT started.
- Rollback: revert additive routes, shared access provider and links; no database/data rollback.

### 2A.2 validation follow-up and resume point

- Initial head `90a6a2d43b53db185d1bc6378064193be411ca2f` passed quality/security, but browser run `36294065346` failed the empty-job assertion. The actual screenshot/trace showed a real prior Task 42 job: truncating Account does not truncate Channel and its media jobs. Isolated media fixtures retain the empty assertion and then seed a failed job, verifying populated tables/search/null-stage, error-state data clearing and both Arabic mobile destinations. Final gates above passed.
- Visual inspection of the failed-run screenshot confirmed the mounted media workspace and existing brand/navigation. It is not comprehensive desktop/TV/device certification; Phase 5 remains required.
- R22 before 2A.3: `AdminMediaProcessingController.retryFailed` reads FAILED, then unconditionally updates by id. A controlled compiled-controller probe with two FAILED snapshots allowed both requests, two updates and two audit records. This is a code-path reproduction with mocked transactions, not a PostgreSQL concurrency test or observed production incident. Add a real concurrent regression and conditional update before exposing retry. Also review superseded generations, retry vs worker claims, and reprocess/backfill generation creation/fencing.
- Do not expose retry/reprocess/recovery controls before that safety work. The merged 2A.2 workspaces are read-only.
- Resume from main `de1cc33fca438b05be1f67acb3d8ece2dca7d82c`, after reading this checkpoint and verifying remote state. Phase 2 is still incomplete; Phases 3–5 have not started.
- This checkpoint follow-up changes documentation/inventory provenance only. Scanner syntax, deterministic output and formatting are checked separately; no new runtime acceptance is claimed.

## Phase 2A.3a — atomic failed-job retry, complete and merged

- Starting SHA: `6329fa29f19687dadd1db0ad6abccb16a7f34c38`, after PR #112 passed quality run `36294723098` and merged with expected-head protection. Checkpoint read before implementation. Restored a fresh checkout after the previous worktree's parent Git metadata became unavailable; retained the old files.
- Findings: retry used an unconditional write after reading FAILED. Two requests could both succeed and audit, or a stale request could reset a newly acquired worker lease. Retry also retained the old `leaseWorkerId`.
- Changes: conditional update on id, FAILED status and observed `updatedAt`; a changed snapshot returns `MEDIA_JOB_RETRY_CONFLICT`. Only the winning transition writes the audit in the same transaction. Clear the worker id alongside the other expired lease fields. No frontend mutation controls yet.
- Migrations: none.
- Tests added: PostgreSQL regression with a barrier after two real reads, exactly one committed retry/audit, preservation of a concurrently acquired lease, rejection after a newer failure and rollback when the audit actor foreign key fails. These exercise controller transaction behavior; existing HTTP authorization/step-up guards remain unchanged.
- Tests executed: local formatting, API lint/typecheck and all 345 API unit tests (87 files, 30.97s) passed. Full quality `36325811865`, security `36325811875` and browser `36325811876` passed on `734235e9e38cd4523b5ec413fb5d08a1f9e9ccbb`. Quality includes clean migrations, 4 database tests, all 487 API integration tests in 124 files (including the four new PostgreSQL regressions), all unit/schema suites and the production build. All 33 browser tests passed. The initial implementation head also passed quality; the final head strengthens audit rollback verification to require the actual foreign-key error `P2003`.
- Performance measurements: four new PostgreSQL regression cases took 829ms; full API integration suite 126.97s; browser suite 3.2 minutes. These are test timings, not production concurrency/load measurements.
- Remaining issues: R22 is only partially addressed. Superseded generations and concurrent retry/reprocess/backfill/recovery generation creation still require a shared consistency review. Timestamp comparison adds stale-snapshot protection but is not a new monotonic generation/revision contract. Do not expose mutation controls until that follow-up is validated.
- External blockers: local PostgreSQL/Chromium remain unavailable; real database/browser acceptance passed in CI. Physical-device/production checks are not claimed.
- Verified ending PR head: `734235e9e38cd4523b5ec413fb5d08a1f9e9ccbb`; ending main SHA: `3d8e6c261f4a40df0cda785beb86263d3734a7a0`, safely merged as PR #113 with expected-head protection.
- Next phase: 2A.3b generation consistency before media mutation UI; implementation has not started. Phase 2 and Phases 3–5 remain incomplete.
- Rollback: revert the controller change and tests; no schema/data migration. Reverting restores the known retry race.

### Resume review for 2A.3b

- Read this checkpoint and verify main/PR/CI state before editing. Current completed implementation baseline is `3d8e6c261f4a40df0cda785beb86263d3734a7a0`.
- Review a shared transaction lock for generation creation/revival across initial upload, administrator retry/reprocess, adaptive backfill and FAILED_BACKFILL recovery. The queue claim lock and backfill lock currently protect different operations; do not assume they cover these cross-path races.
- Check latest processing and playback generations, other active jobs, stale worker finalization, lock ordering and legacy inconsistent rows. Avoid introducing a video-row/job-row deadlock or allowing obsolete failed jobs to starve bounded recovery selection. Preserve worker ownership fencing and backfill capacity/pause semantics.
- Add real PostgreSQL concurrency regressions for the selected contract before exposing write controls. This is a review agenda, not a claim that these paths are fixed or that a particular locking design has been accepted.

## Phase 2A.3b — media generation consistency, complete and merged

- Starting SHA: `ed6bec72cc5c489a916ab186d6e80f9d9f90a896`; checkpoint read, main fetched, PR #114 merge and successful quality run verified before editing.
- Findings: creation/revival paths had unrelated locks; retry could revive obsolete generations; generation numbers ignored playback-only history in upload/reprocess; recovery could select obsolete failed jobs ahead of eligible work. Backfill reused an output key and final asset owned by an older job despite database uniqueness constraints. A late worker failure callback could unconditionally overwrite a newer terminal job state. Retry/reprocess also returned raw Prisma BigInt fields: a local Fastify inject probe confirmed HTTP 500 serialization after returning such a row.
- Changes: shared per-video transaction advisory lock for upload/reprocess/backfill/retry/recovery, normalizing UUID case before deriving the lock key; existing backfill capacity lock always precedes it. Reject obsolete processing/playback generations and other active jobs, including inconsistent legacy rows. Filter obsolete/blocked failures before the bounded recovery LIMIT and recheck under lock. Manual adaptive retry shares backfill pause/capacity enforcement. Generation numbers advance beyond both job and playback history. Backfill receives an independent fallback key and copies validated MP4 bytes instead of transcoding again. Obsolete workers cannot advance stages, publish canonical/adaptive state or endlessly requeue; failure transitions remain lease-conditional. Retry/reprocess return a JSON-safe outcome projection, without internal storage keys, so a committed action does not subsequently fail response serialization.
- Migrations: none; existing unique constraints and video/generation indexes retained.
- Tests added: real PostgreSQL races for parallel reprocess, retry versus reprocess, backfill versus reprocess and initial upload; obsolete processing/playback and legacy-active rejection; bounded recovery past obsolete rows; pause/capacity across manual/batch retry; obsolete stage/finalization rejection and late-failure fencing. A Fastify/real-database response regression covers successful serialization of both committed mutations. Unit test verifies backfill copies bytes into a distinct key, preserves the source object and never invokes FFmpeg.
- Tests executed: local API typecheck/lint and all 346 API unit tests (88 files, final run 28.30s) passed; full quality `36328032954`, security `36328032936` and browser `36328032937` passed on `b1a02f55ae3374e57734286530c632a95360d404`. The API integration gate passed 500 tests in 126 files, including all 12 new PostgreSQL scenarios; all 33 browser tests passed. Formatting, lint, typecheck, unit/schema tests, clean migrations and production builds passed.
- Performance measurements: new PostgreSQL scenarios 2.158s; API integration gate 125.01s; browser suite 3.2 minutes; final local API unit suite 28.30s. Generation checks add indexed reads to worker stages/finalization; no production throughput claim. Recovery result batches remain bounded; its correlated predicates use existing per-video indexes. Independent fallback objects add one MP4 copy per new backfill generation; no extra re-encode.
- Remaining issues: media mutation UI and complete Phase 2 integration remain open. Legacy data is rejected/fenced, not automatically rewritten or deleted. Physical storage/device/load acceptance remains external.
- External blockers: local PostgreSQL/Chromium unavailable; real integration/browser gates passed in CI. No physical-device, production storage or load verification claimed.
- Verified ending PR head: `b1a02f55ae3374e57734286530c632a95360d404`; ending main SHA: `554eac6507a29b3013f3206ea2fea35b80460594`, merged as PR #115 with expected-head protection.
- Next phase: 2A.3c media action UI with role/step-up/confirmation/audit feedback; implementation has not started. Phase 2 remains in progress; Phases 3–5 remain unstarted.
- Rollback: revert code; no schema rollback. Already created generation-specific fallback objects remain valid. Reverting restores generation races and the old backfill-key collision; do not delete media objects as part of code rollback.

- Validation finding: the uppercase-UUID regression exposed a case-sensitive audit entity id even though PostgreSQL resolves UUIDs case-insensitively. The winning reprocess committed, but lookup by the canonical video id found no audit. Normalize controller UUID inputs as well as advisory lock keys; retain the exact audit assertion. Quality run `36327619772` failed on this assertion; no failed head was merged.

### Resume point after 2A.3b

- Verify current main, PRs and CI, then read this checkpoint. Completed implementation baseline: `554eac6507a29b3013f3206ea2fea35b80460594`.
- Add contextual retry/reprocess controls to the existing media workspace, using video titles and generation state. Keep advanced backfill/recovery controls bounded and clearly scoped; pause/resume remain SUPERADMIN-only. Preserve the shared step-up dialog's no-automatic-replay behavior.
- Validate action success/error/pending states, fresh state after completion/conflict, exact HTTP authorization and response contracts, EN/AR/mobile/keyboard behavior and committed audit evidence. A queued job is not a completed media processing result.
- Operator actions remain unexposed in the web product until that next implementation is accepted. Other Phase 2 domains and Phases 3–5 remain open.

## Phase 2A.3c.1 — contextual media actions, verified and merged

- Starting SHA: `1593ba2a76bb0010637ed2c7dbda5fc362d1d0dc`; checkpoint read, main fetched unchanged, PR #116 merge and quality `36328656478` verified before editing.
- Findings: the media snapshot lacked generation display and actionable retry/reprocess controls. Snapshot freshness must be renewed after rejected as well as successful mutations; an interrupted response cannot establish cancellation.
- Changes: title/generation confirmation, contextual failed-job retry and terminal-video reprocess, duplicate-submit prevention, scoped role visibility and account/role-keyed state. Shared step-up opens only after closing confirmation and never replays the operation. Refresh both snapshots after outcomes; distinguish queued work from completed processing and report transactional audit evidence. Keep search context. Server remains authoritative beyond the recent 100-job snapshot.
- Migrations: none. No backend/worker changes.
- Tests added: authenticated mutation transport, exact target entity, no replay after step-up or network error; real browser/HTTP/database retry/reprocess/audit, denied role, aged assurance, keyboard cancellation/focus, stale confirmation conflict and Arabic mobile dialog bounds. Browser source readiness is seeded because E2E has no running worker; no claim of media encoding/storage verification.
- Tests executed so far: web typecheck/lint and 113 unit tests across 27 files passed (4.87s). Full quality `36331086791`, security `36331086795` and browser `36331086787` passed on `92528e82fb5c0d77905b9de7f0f00798105e4dc5`. All 34 browser tests passed, including pending-state protection. Quality passed formatting, lint, types, unit/schema suites, clean migrations, 500 API tests in 126 files in the integration gate and production builds. No failing head was merged.
- Performance measurements: one mutation followed by two existing bounded snapshot reads; no per-job fetches. CI web units 3.66s; API integration gate 124.16s; browser suite 3.3 minutes. These are test timings, not production load measurements.
- Remaining issues: advanced bounded backfill/recovery and SUPERADMIN pause/resume deferred to 2A.3c.2; this is a reviewable subphase, not completion of 2A.3c or Phase 2.
- External blockers: local PostgreSQL/Chromium unavailable; browser/database acceptance passed in CI. Production storage/load and physical-device acceptance are not claimed.
- Verified ending PR head: `92528e82fb5c0d77905b9de7f0f00798105e4dc5`; ending main SHA: `43d5e81b6b11b100dccce5181c45147a026a0f21`, merged as PR #117 with expected-head protection.
- Next: 2A.3c.2 bounded recovery and backfill controls after the safety review below. Phase 2 remains incomplete; Phases 3–5 remain unstarted.
- Rollback: revert frontend/test changes; no schema rollback. Already queued jobs and committed audits remain valid and must not be deleted.

### Resume point after 2A.3c.1

- Read this checkpoint and verify main/PR/CI before editing. Runtime baseline is `43d5e81b6b11b100dccce5181c45147a026a0f21`; only PR #117 was open in the pre-merge repository query, and it is now merged.
- Advanced actions are not exposed yet. Review `MediaAdaptiveRolloutService.recover`: STALE_PROCESSING computes a batch size but delegates to `queue.recoverStale` without it; that service selects all expired active jobs and reports a count taken before conditional updates. Do not present a bounded-action UI until the actual mutation scope and result count honor that contract. Preserve existing automatic queue-recovery semantics where appropriate.
- Review pause/resume concurrency: `setPaused` does not acquire the backfill lock; batch enqueue and recovery read controls before the lock. Determine the intended pause linearization contract and verify with real concurrent transactions before promising immediate pause in UI. This is a review finding, not a claim that a reproduced race is fixed.
- Advanced UI must retain role boundaries (pause/resume SUPERADMIN only), explicit scoped confirmation, step-up without replay, batch validation, accurate result categories and audit evidence. Disabled/no-op paths do not all write an audit, so do not reuse the individual-job success text indiscriminately.
- The machine inventory still identifies its historical `554eac65` source baseline; this checkpoint and the human audit record the newer runtime change. Refresh source inventory with the next integration audit rather than mislabeling historical evidence as current.

## Phase 2A.3c.2 — bounded recovery and pause consistency, verified and merged

- Starting SHA: `926b3558a88bb3375bae5c5eed8942534bbcdd8a`; checkpoint read, main fetched unchanged, PR #118 merge and quality `36331588157` verified.
- Findings: STALE_PROCESSING ignored its bounded request and counted rows before conditional writes; pause/settings writes did not share the mutation lock and mutation paths trusted preflight controls. Reading settings/flags through the outer client while a transaction holds a connection also unnecessarily requires another pool connection.
- Changes: explicit recovery batches validate 1–20, select oldest expired jobs deterministically, preserve a changed lease and count actual requeued/failed transitions. Audit these results transactionally. Automatic recovery retains its unbounded housekeeping; explicit operator batches only mutate selected jobs. Pause, kill switches, batch and capacity settings share the existing backfill advisory lock through the settings service, including the generic Admin settings path. Every backfill mutation rechecks controls inside the transaction after acquiring the lock; settings/flag reads use that same transaction connection.
- Pause contract: a batch already inside the boundary may commit first; pause waits for it and blocks subsequent backfill mutations until resume. Pause does not cancel already queued work. STALE_PROCESSING is queue lease recovery, independent of the adaptive rollout switch, as before.
- Migrations: none.
- Tests added: real PostgreSQL bounded batches and result/audit totals, concurrent recoveries, lease renewal race, audit rollback, stale-preflight pause/resume and a settings writer demonstrably waiting on the PostgreSQL advisory lock. Four unit cases recheck pause across every adaptive recovery mode.
- Tests executed: local API lint/typecheck and all 350 unit tests passed (23.46s). Full quality `36332695630`, security `36332695651` and browser `36332695627` passed on `cc134a58516813b34c5811ff4b41b95ea6a0d543`. All seven new PostgreSQL regressions passed; the API integration gate passed 511 tests across 127 files, including unit suites. All 34 browser tests passed. Formatting, types, unit/schema suites, clean migrations and production builds passed.
- Performance measurements: manual stale selection has a database LIMIT (maximum 20) and no preliminary count query; control reads batch settings into one transaction query. Seven new PostgreSQL scenarios took 1.431s; API integration gate 125.98s; browser suite 3.2 minutes. No production load measurement claimed.
- Remaining issues: advanced UI is still unexposed; storage recovery error classification and scan-cursor behavior require review before exposing storage-reconciliation modes. Phase 2 remains incomplete.
- External blockers: local PostgreSQL/Chromium unavailable; real database/browser verification runs in CI.
- Verified ending PR head: `cc134a58516813b34c5811ff4b41b95ea6a0d543`; ending main SHA: `d1c722fc0e1f048bbdcc918b76d68dab481f0d8b`, merged as PR #119 with expected-head protection.
- Next: 2A.3c.3 review storage reconciliation correctness, then integrate advanced controls with role/step-up/confirmation/result semantics. Individual video actions are already integrated in PR #117; Phase 2 remains incomplete.
- Rollback: revert code only, no schema rollback. Preserve committed jobs, pause values and audits; reverting restores the reviewed races/unbounded operator scope.

### Resume point after 2A.3c.2

- Read this checkpoint and verify remote main/PR/CI before editing. Verified runtime baseline is `d1c722fc0e1f048bbdcc918b76d68dab481f0d8b`. No other open PR existed before PR #119 was created.
- Bounded queue recovery and pause ordering are verified prerequisites; advanced controls are not yet mounted. Preserve the distinction between requeued jobs and terminal failures, and between a committed pause and cancellation of existing work.
- Review before exposing storage recovery: `objectExists` catches every storage error and returns false; DB_MANIFEST_MISSING can consequently treat an outage/403 as an absent object. `R2SigV4.request` currently throws an untyped Error for HTTP failures. Distinguish confirmed absence from inability to verify and test that uncertain storage never downgrades healthy playback.
- `findMissingManifestRows` marks a short page exhausted even if its loop stopped early after reaching the requested batch size. Verify continuation when unvisited rows remain in that page; do not weaken cursor expectations.
- `pendingCandidates` materializes the entire eligible catalog before slicing. Mutation count is bounded, but read/scan cost is not yet catalog-size independent. Review bounded candidate selection and stable cursors before promising scalable batch operations.
- Updated semantic review and machine inventory record PRs #117/#119 against this baseline. Source scanning is inventory evidence, not a substitute for runtime acceptance. No production storage, load or physical-device acceptance is claimed.

## Phase 2A.3c.3 — storage recovery correctness, verified and merged

- Starting SHA: `474bace77b5c6327b8027e3faa253ba33ab8f11d`; checkpoint read, remote main fetched unchanged, PR #120 quality `36333240948` passed and no open PRs found.
- Findings: every HEAD error was treated as absence; missing size metadata became zero. A short scan page could lose continuation after reaching the result limit. Candidate selection materialized the whole catalog, orphan checks issued per-video SQL, and capacity exhaustion could skip unqueued candidates. A changed manifest was not fenced against stale verification.
- Changes: typed R2 HTTP failures; only HEAD 404 or confirmed zero-length objects count as unusable. Authentication, outage, timeout, network and invalid metadata failures abort before mutations. Compare the observed manifest key/timestamp under the generation lock. Stable UUID keyset scans survive deleted anchors and preserve unvisited short-page rows. Candidate selection applies eligibility before a database LIMIT of at most 250; latest-job/playback reads are batched. Maintenance selection now orders by UUID, not publication date. Overview catalog reads are unchanged and remain a separate performance concern.
- Continuation contract: orphan recovery preserves the input cursor when capacity prevents enqueueing all detected candidates. `hasMore` is authoritative: true with a null cursor means retry the initial range when capacity returns, not completion. Already queued candidates are filtered on the next scan. Cursor consumers must use this contract before the advanced UI is exposed.
- Migrations: none.
- Tests added: typed HEAD failures and invalid/zero/nonempty metadata; PostgreSQL regressions for uncertain storage, all-or-nothing verification, short-page/deleted-anchor continuation, changed manifests, capacity resumption and 260 eligible videos with a query-count bound independent of candidate count.
- Tests executed: local formatting, API lint/typecheck and 361 unit tests passed (26.76s). Full quality `36334516303`, security `36334516289` and browser `36334516292` passed on `80a0175ad423797d93b542b950b20dd615ca5c0a`. The API integration gate passed 531 tests across 128 files (including unit suites), with all nine new PostgreSQL regressions passing. All 113 Web unit tests and all 34 browser tests passed. Formatting, lint, types, schema tests, clean migrations and production builds passed.
- Performance measurements: orphan candidate materialization and HEAD checks are bounded at 250 per request. The real PostgreSQL test proves the 250-candidate and 10-candidate scans use the same number of Prisma operations, at most 15, without per-video SQL checks. Nine new regressions took 2.002s; API integration gate 104.91s; browser suite 3.4 minutes. These are test measurements, not production latency/load evidence; database execution may still depend on catalog distribution and indexes.
- Remaining issues: advanced controls remain unexposed; Phase 2 is incomplete. An object can change after HEAD without a database update; this is not a storage transaction or object-version guarantee.
- External blockers: local PostgreSQL/Chromium unavailable; real database/browser acceptance must run in CI. Storage faults are simulated; production R2/device acceptance is not claimed.
- Verified ending PR head: `80a0175ad423797d93b542b950b20dd615ca5c0a`; ending main SHA: `03077fd11a10f1e60b7c78ad95325c1ab0afffc3`, merged as PR #121 with expected-head protection.
- Next phase: advanced media controls with precise cursor/result, role, step-up and audit semantics, subject to the mode-specific review below. Phase 2 remains incomplete; Phases 3–5 are not started.
- Rollback: revert code, no schema rollback. Preserve already committed recovery jobs and audits. Reverting restores false-absence and skipped-candidate risks.

### Resume point after 2A.3c.3

- Read this checkpoint and verify remote main/PR/CI before editing. Runtime baseline: `03077fd11a10f1e60b7c78ad95325c1ab0afffc3`. Only PR #121 was open during the runtime change, and it is merged.
- The next UI slice can integrate verified backfill, pause/resume, failed/stale recovery and the reviewed storage modes with explicit scoped confirmation. Preserve no automatic replay, role boundaries, transactional audit distinctions and capacity-dependent continuation. Do not add a generic raw response console.
- Review `INCOMPLETE_HLS` before exposing that specific mode: it limits old BUILDING/FAILED rows before checking current eligibility, then deduplicates by video. Old blocked/obsolete rows may hide eligible work indefinitely. This is a source-review finding, not a reproduced or fixed regression. Either establish and test a fair bounded selection contract or keep that mode unexposed while shipping the verified actions.
- Old Task 42 documentation has been corrected to describe generation-specific MP4 copies, pause ordering, audit/no-op semantics and storage cursor/error contracts. Existing source inventory still explicitly identifies its historical `d1c722fc` baseline; this checkpoint records newer runtime acceptance without relabeling inventory evidence.
- No migration, production R2, physical-device or production load validation. Do not claim the entire advanced-media integration, Phase 2 or the product program is complete.

## Phase 2A.3c.4 — advanced media action UI, verified and merged

- Starting SHA: `778de5d7860a475ae640e94d4c4afedb0826aa05`; checkpoint read, remote main fetched unchanged, PR #122 quality `36335036165` passed and no open PRs found.
- Findings: verified bounded recovery and rollout mutations had no product controls. Response shapes differ across queue recovery, storage reconciliation, disabled no-ops and audited capacity exits. Null cursor alone cannot determine orphan-scan completion.
- Changes: progressive-disclosure maintenance controls in the existing media workspace; bounded batch validation, SUPERADMIN-only pause/resume visibility, reviewed backfill/stale/failed/storage actions and shared confirmation/pending guard. Preserve mode, batch, open section and per-mode scan continuation across snapshot refresh. Each continuation is explicitly submitted; no automatic replay or scan loop. Parse success bodies before reporting queue/audit results, distinguish terminal failures and no-op audit behavior, and refresh snapshots after success/error. EN/AR, keyboard and mobile reuse existing product primitives. `INCOMPLETE_HLS` remains unexposed pending selection fairness review.
- Migrations: none. No backend/worker changes; E2E helpers seed and clean isolated test settings.
- Tests added: authenticated exact transport, bounds, malformed success responses, stale result categories, null-cursor continuation, no-op audit text and no replay after step-up/network errors. Browser tests cover real HTTP/DB backfill, capacity, role denial, pause/resume, stale recovery while paused, changed confirmation state/audit absence, keyboard/mobile RTL, plus explicitly mocked storage response/pending/error/continuation contracts.
- Tests executed: local Web typecheck/lint and 130 unit tests in 28 files passed (5.52s); helper syntax and Playwright test discovery checked. Full quality `36339495464`, security `36339495444` and browser `36339495447` passed on `12a7b84798964aada6938e5399a5b1f42ad1b3af`. All 36 browser tests passed, including both new real HTTP/database and mocked storage-client journeys. Quality includes formatting, lint, types, all unit/schema suites, clean migrations, 531 API tests in 128 files in the integration gate and production builds. No local PostgreSQL/Chromium pass claimed.
- Performance measurements: one mutation followed by the existing two snapshot reads; no automatic polling, scan loops or per-row UI requests. CI Web units 3.70s; API integration gate 127.42s; browser suite 3.6 minutes. No production load claim.
- Remaining issues: `INCOMPLETE_HLS` fair candidate selection, overview catalog read cost, other Phase 2 domain integrations and Phases 3–5 remain open.
- External blockers: production R2/encoding/load and physical-device acceptance remain separate; mocked storage browser fixtures only establish client continuation/error behavior.
- Verified ending PR head: `12a7b84798964aada6938e5399a5b1f42ad1b3af`; ending main SHA: `0475932d53f57db32332c6522791f7336d5b1ce7`, merged as PR #123 with expected-head protection.
- Next: verify this UI slice, then continue remaining backend-product integrations with the master audit as the coverage baseline.
- Rollback: revert frontend/tests, no schema rollback; preserve already queued jobs, settings and audits.

## Phase 2B — recommendation evaluation and trending, verified and merged

- Starting SHA: `0475932d53f57db32332c6522791f7336d5b1ce7`; checkpoint read and Phase 2A.3c.4 accepted before this phase. Remote main fetched after PR #123 merge; only that PR was open during the preceding implementation.
- Findings: OPERATIONS evaluation and trending endpoints exist without dedicated product surfaces. Offline fixture versions are baseline/balanced/watch-only; they are not production release identifiers. Observed exposure coverage cannot establish recall for unshown candidates. Trending mutations already require step-up, a reason and a transactional audit.
- Changes: `/admin/operations/discovery` linked from Operations for authorized staff. Distinct offline fixture comparisons and observed versions; explicit samples of at most 100 exposures over 14 days with attribution coverage and recorded outcomes, never inferred production recall. Trending controls show ranking/audience first, advanced weights/caps behind details, bounded validation, preserved drafts, change review, required reason, shared step-up without replay and transactional-audit feedback. Role/account-scoped state, authenticated no-store reads, error/retry states, EN/AR/mobile/keyboard controls. Detailed exposure score components and raw exports remain internal debugging data rather than a raw JSON product surface.
- Migrations: none. No API behavior or native UI changes.
- Tests added: authoritative API/client validation parity, bounded authenticated observed reads, attribution summary, exact settings/audit-reason transport, malformed config rejection and no automatic replay. Real browser/HTTP/database journey covers denied role, navigation, fixed-fixture failure, empty/seeded observed data, required limits/reason, step-up, preserved draft, pending guard, committed audit, upstream error/retry, signed-out access and Arabic mobile confirmation.
- Tests executed: local Web types/lint and 138 units in 29 files passed (5.17s); helper syntax and browser discovery checked. Full quality `36340688996`, security `36340688991` and browser `36340689004` passed on `e18dfd182bbd906ba33e6d0fba337d276c44ab17`. Formatting, lint, types, all unit/schema suites, clean migrations, 531 API integration-gate tests across 128 files and production builds passed. All 37 browser tests passed, including the new real HTTP/database journey.
- Performance measurements: initial evaluation uses two parallel reads plus one independent settings read. Observed sampling is explicit and bounded at 100 exposures, with no per-row fetches or polling. The existing export service may still process many attributed event rows; no catalog-independent query/load claim. CI browser suite: 3.7 minutes.
- Verified ending PR head: `e18dfd182bbd906ba33e6d0fba337d276c44ab17`; ending main SHA: `f4763ab83bca8530d96d3678c1c3adc3c047a830`, merged as PR #124 with expected-head protection.
- Next: sanitized warehouse status and Creator/live, compliance/provider/analytics integration review (2C), after this phase passes all gates.
- Rollback: revert UI/routes/test fixtures only. Preserve saved settings and audit history; no schema rollback. Existing trending writes remain last-write-wins, without a new multi-operator revision contract.
- External blockers: local PostgreSQL/Chromium unavailable; browser/database acceptance runs in CI. No production telemetry, real-device or load verification claimed.
- Remaining issues: other Phase 2 domains, `INCOMPLETE_HLS` selection fairness, overview read cost and Phases 3–5 remain open. No production/device claims.

## Phase 2C.1 — warehouse operational visibility, verified and merged

- Starting SHA: `f4763ab83bca8530d96d3678c1c3adc3c047a830`; checkpoint read, PR #124 accepted and remote main fetched before implementation.
- Findings: warehouse exports have durable dataset/version checkpoints but no operator surface or durable worker heartbeat. The deployed module binds a disabled adapter. Existing compliance, payout-provider and privacy-aware cohort surfaces are mounted; do not duplicate them. Studio Live network/pending/credential workflows need a separate reviewed slice.
- Scope: OPERATIONS-authorized, uncached, read-only status; one bounded projection of current dataset/version checkpoints, configuration and scheduling context. Never expose cursor identifiers, batch IDs, raw facts, secrets or a new export-execution endpoint. Historical checkpoint success does not establish current worker health.
- Changes: read-only `/admin/warehouse-status` and `/admin/operations/warehouse`, linked from Operations, with shared role/account-scoped loading/error/retry UI, EN/AR and mobile table scrolling. Adapter configuration, batch cap, configured interval and current-version delivery timestamps only. No delivery or worker behavior changes.
- Migrations: none.
- Tests added: bounded current-version database projection, field redaction and read-failure propagation; authenticated cancellable client reads and error/no-retry handling. Browser journey covers real auth/roles, database checkpoints, no-store response, historical success under a disabled adapter, excluded future schema, errors/retry, no mutations, Arabic mobile and sign-out.
- Tests executed: local API/Web types and lint passed; 363 API units (89 files, 25.91s) and 140 Web units (30 files, 7.68s) passed. Helper syntax and browser test discovery passed. Full quality `36341693227`, security `36341693229` and browser `36341693234` passed on `cce80f99d2b70259570d8303a9fca177cd29fd96`. Formatting, lint, types, all unit/schema suites, clean migrations, 533 API integration-gate tests across 129 files and production builds passed. All 38 browser tests passed.
- Performance measurements: one database query, at most five current-version checkpoint rows; one explicit UI snapshot request, no polling or per-dataset requests. CI API integration gate: 128.79s; browser suite: 3.6 minutes. No production latency/load evidence.
- Verified ending PR head: `cce80f99d2b70259570d8303a9fca177cd29fd96`; ending main SHA: `bc0fc5fc9174db122b4aa95cbdd4669b673f043b`, merged as PR #125 with expected-head protection.
- Remaining issues/external blockers: disabled connector by design, no independent worker heartbeat; production delivery and local PostgreSQL/Chromium unavailable. Real browser/database verification runs in CI. Studio Live and remaining Phase 2/Phases 3–5 remain open.
- Next: finish and verify this slice, then Studio Live reliability and remaining Phase 2 findings. Phases 3–5 remain open.
- Rollback: remove status endpoint/UI only; preserve export checkpoints and delivery semantics.

## Phase 2C.2 — Studio Live reliability, verified and merged

- Starting SHA: `bc0fc5fc9174db122b4aa95cbdd4669b673f043b`; checkpoint read, PR #125 accepted and remote main fetched before implementation.
- Findings: initial and mutation network errors are unhandled, loading misrepresents provider availability, duplicate submissions are possible and credential rotation has no confirmation. Existing channel-owned chat toggle has transactional moderation evidence but no Studio control.
- Scope: improve the existing shared Web surface, preserve server ownership/provider gates and no automatic mutation replay; keep one-time keys in memory and preserve a successful credential response across a subsequent network refresh failure. Add explicit cache protection to sensitive Studio read/credential responses. Integrate the existing chat toggle. Do not expose raw recording diagnostics or claim real provider acceptance.
- Changes: explicit loading/error/retry and sign-in entry, draft retention, one pending guard, reviewed key rotation, validated one-time encoder responses, no replay, provider-neutral playable feedback, contextual viewer links and channel-owned chat control. Clear secrets on hide/auth failure/channel change/page departure; restore from page cache re-reads state without replay. EN/AR layout and keyboard/mobile confirmation reuse Studio styles. API list/provision/rotation responses are private/no-store.
- Migrations: none. Existing provider/ownership/moderation transaction behavior is unchanged.
- Tests added: title/date validation, exact authenticated uncached transport, typed flat/nested errors, malformed results and no credential retries. Browser tests cover real create/pending protection, failed-create draft retention, chat evidence and cross-channel denial; separately mock provider responses for rotation/cancel, uncertain network outcomes, key retention after read failure, hide, no browser storage, provider confirmation, Arabic mobile and keyboard.
- Tests executed: local API/Web typecheck and lint passed; all 149 Web units in 31 files passed (6.22s). E2E helper syntax and discovery passed. Initial head `aaca2b94` passed security, credential prerequisite, local units and 39/40 browser tests. The remaining failure expected English after clearing cookies on `/ar/studio/live`; downloaded page evidence confirms correct Arabic signed-out UI. Corrected the test to assert the canonical Arabic URL, Arabic sign-in/retry, absence of creation controls and HTTP 401. Corrected head `579ba562c7af9a9c9eecf2e4757d5dbf39b4fd34` passed full quality `36343270412`, security `36343270422`, browser `36343270404` and Mux credential prerequisite `36343270389`. All 40 browser tests, 149 Web units, 363 API units and 533 API integration-gate tests across 129 files passed. Formatting, lint, types, clean migrations and production builds passed. The Mux prerequisite is not a real provider control-plane/encoder proof.
- Performance measurements: one initial list read; each explicit mutation has one state refresh; no polling/per-stream requests. Existing list remains unbounded. CI API integration gate: 129.72s; browser suite: 3.9 minutes. No production latency/load claim.
- Verified ending PR head: `579ba562c7af9a9c9eecf2e4757d5dbf39b4fd34`; ending main SHA: `be01beebc7c207ecfe2aec95c30684973ee28bfe`, merged as PR #126 with expected-head protection.
- Remaining issues: terminal live-state mutations need separate provider/concurrency review; Studio stream list remains unbounded; production provider/encoder and physical-device verification external.
- Next: verify this slice, then remaining Phase 2 correctness/integration findings before route and design phases.
- Rollback: revert UI/cache-header changes, preserve created live sessions, provider resources and moderation history. Never restore invalidated stream keys.

## Phase 2D — incomplete HLS selection and integration, verified and merged

- Starting SHA: `be01beebc7c207ecfe2aec95c30684973ee28bfe`; checkpoint read, PR #126 accepted and main fetched before implementation.
- Findings: INCOMPLETE_HLS limits stale playback rows before checking video/source eligibility, current generations or active jobs, then deduplicates. Blocked/obsolete rows can permanently hide eligible work; pre-lock snapshots can change.
- Scope: select only eligible latest stale generations before a bounded limit, serialize capacity, recheck and fence changed candidates under the generation/row lock, preserve audited transactional outcomes. Add the existing mode to reviewed advanced controls only with passing database/browser acceptance.
- Changes: eligibility and latest-generation SQL selection before the batch limit, transactional capacity serialization, locked generation/timestamp recheck, canonical backfill lifecycle reuse and atomic supersession/audit. Reviewed EN/AR operator action validates distinct detected/requeued results without inventing a continuation cursor.
- Migrations: none.
- Tests added: seven PostgreSQL cases for starvation, historical duplicates, eligibility, capacity concurrency, changed candidates and audit rollback; client contract validation and real browser recovery/cancel/capacity evidence.
- Tests executed: local API/Web typecheck and lint passed; 363 API units in 89 files (22.83s) and 150 Web units in 31 files (5.44s) passed. Browser discovery and helper syntax passed. Full quality `36344865230`, security `36344865242` and browser `36344865271` passed on `0c71d183f24dc960d94fd30cc028a27b4b48f75e`: 540 API integration-gate tests in 130 files, all seven new database cases, 363 API units, 150 Web units and all 41 browser tests; formatting, lint, types, clean migrations and production builds passed.
- Performance measurements: selected rows and per-candidate processing bounded by batch/capacity (maximum 20); eligibility SQL may scan more database rows and no catalog-independent execution or production-load claim is made.
- External blockers: no local PostgreSQL/Chromium; production storage, encoding and physical-device acceptance remain separate.
- Verified ending PR head: `0c71d183f24dc960d94fd30cc028a27b4b48f75e`; ending main SHA: `ee56af7bf186c449365cf3d5aecbc12c732de095`, merged as PR #127 with expected-head protection. CI integration gate: 113.43s; seven new cases: 1.220s; browser suite: 3.7 minutes.
- Next: overview aggregation and remaining Phase 2 findings.
- Remaining issues: overview catalog materialization, detailed API observability, account MFA management, discovery policy pagination and other Phase 2 review gaps; Phases 3–5 remain open. General profile CRUD is not established by current controllers and must not be invented as production-ready integration.
- Rollback: revert selection/UI code; preserve new generations/jobs and audits. Do not revive superseded generations automatically.

- Phase 2D first CI head `453167ff7a89a25a3a5c63a99e6a3b4d1c2a9c78`: quality `36344339759` and security `36344339734` passed, including all seven new PostgreSQL cases (1.719s), 540 API integration-gate tests in 130 files (135.42s), 363 API units and 150 Web units. Browser `36344339650` passed 40/41; the new test incorrectly used the selected option label as the review-button name. Existing component source and locator log establish that the action button is "Review recovery". Corrected the locator and added an explicit selected-action assertion inside the dialog; no product behavior, authorization, audit or queue assertions weakened. Corrected-head full acceptance passed as recorded above.

## Phase 2E — adaptive overview aggregation, verified and merged

- Starting SHA: `ee56af7bf186c449365cf3d5aecbc12c732de095`; checkpoint read and PR #127 accepted before implementation.
- Findings: overview materializes all eligible videos/source metadata and a catalog-sized generation-ID query merely to count ready/pending videos and identify one oldest video. Existing metrics already cap sampled generations at 1,000.
- Changes: single PostgreSQL statement returns pending/ready counts and at most one oldest-video projection using the existing eligibility/readiness predicates. Counts and oldest selection share one statement snapshot. Preserve JSON shape, published-date ordering/null fallback, role boundaries and bounded metric sampling; no UI or worker behavior changes.
- Migrations: none.
- Tests added: empty catalog; distinct video counting with duplicate sources/generations and excluded/private/removed/unpublished sources; readiness protocol and oldest-date semantics; 512-video fixture asserts one transferred summary row and rejects catalog materialization, with measured fixture timing.
- Tests executed: local API typecheck/lint and 363 unit tests in 89 files passed (25.30s). Initial new fixture used a container name as a protocol enum; typecheck caught it and the fixture now uses the actual PROGRESSIVE protocol. Full quality `36345645385`, security `36345645384` and browser `36345645388` passed on `78221e146648210856d25785da82d2ef4518451b`. All 544 API integration-gate tests in 131 files, 363 API units, 150 Web units and 41 browser tests passed, including four new PostgreSQL cases; formatting, lint, types, clean migrations and production builds passed. No local PostgreSQL execution claimed.
- Performance measurements: before, up to N video/asset records plus ready IDs and an N-ID query parameter set; after, one catalog summary row independent of N. SQL still scans eligible data; this is bounded API transfer/memory, not constant-time database work. CI 512-video fixture: one catalog summary row, 41ms for the overview call; four new tests 1.392s, API integration gate 134.28s, browser suite 3.8 minutes. This single fixture timing is not production load evidence.
- Remaining issues: detailed API observability, account MFA management, policy pagination and remaining Phase 2 integrations; Phases 3–5 open.
- External blockers: production workload/load, actual storage/provider and physical-device checks remain separate.
- Verified ending PR head: `78221e146648210856d25785da82d2ef4518451b`; ending main SHA: `4b2d2e9f3d60e38d23accc618536a2696237c61b`, merged as PR #128 with expected-head protection.
- Next: detailed API observability and remaining Phase 2 findings.
- Rollback: revert aggregate implementation; no data or schema changes to reverse.

## Phase 2F — detailed service observability, verified and merged

- Starting SHA: `4b2d2e9f3d60e38d23accc618536a2696237c61b`; checkpoint read, PR #128 accepted and main fetched before implementation.
- Findings: existing detailed observability endpoint lacks a product surface; its SUPERADMIN metadata is a hard boundary even for ADMIN/OPERATIONS. Request metrics retain at most 1,000 events over 60 seconds in one process, so displayed requests/second must not be described as platform throughput. Error counters span process lifetime; worker counts are database records, not a heartbeat; local telemetry does not prove external delivery.
- Changes: read-only `/admin/operations/observability`, linked only for SUPERADMIN, shared account-scoped loading/error/retry/fetched states, EN/AR mobile tables and explicit scope/sample-limit/empty-data text. API adds source-of-truth sample/scope metadata and private/no-store headers; no new metric collector or external adapter. Client rejects malformed snapshots instead of inventing healthy zeroes. No raw JSON, secrets or privileged mutations.
- Migrations: none.
- Tests added: process sample cap/expiry versus lifetime counters, client role/transport/error contract and real browser role denials/cache/failed-job evidence/error recovery/sign-out/RTL, plus explicitly mocked empty and capped sample presentation.
- Tests executed: API/Web typecheck and lint passed; 364 API units in 90 files (35.62s) and 153 Web units in 32 files (9.73s) passed. New browser test discovery passed, existing health/trace diagnostics tests retained unchanged. Full quality `36347090009`, security `36347090055` and browser `36347090023` passed on `c67974803fe1008fc4c41a0f12ad2b5879fecf56`: 545 API integration-gate tests in 132 files, 364 API units, 153 Web units and all 42 browser tests. Formatting, lint, types, migrations and production builds passed. No local PostgreSQL/Chromium claim.
- Performance measurements: one explicit snapshot request; existing five bounded-result database queries and process window collection reused. No polling or per-row requests. Database scan cost and production latency remain unmeasured.
- Remaining issues: account MFA management, discovery policy pagination and remaining Phase 2 review gaps; Phases 3–5 open.
- External blockers: no connected external telemetry or fleet-wide collector; production/hardware verification remains separate.
- Verified ending PR head: `c67974803fe1008fc4c41a0f12ad2b5879fecf56`; ending main SHA: `f5104bcc917ddfee22bff3b49755c7e7a6b4d368`, merged as PR #129 with expected-head protection. API integration gate: 133.89s; browser suite: 3.6 minutes.
- Next: restore the disconnected execution workspace, fetch accepted main, reproduce MFA concurrency findings before integrating account security controls; continue discovery policy pagination and remaining Phase 2 findings.
- Rollback: revert additive UI/metadata/cache headers; no stored data or schema changes.

- Phase 2F initial head `d49d151d68912a8a217226f9fea717e0c925b342`: quality `36346437805` and security `36346437621` passed (545 API integration-gate tests in 132 files, 92.84s; 364 API units; 153 Web units). Browser `36346437734`: 39 passed, two failed, one did not run. The new test used an unsupported ADMIN value in the restricted operator-role fixture; use the existing grant-admin helper. Existing mobile preroll test selected `.last()` among two play controls and hit the underlying player behind the gesture overlay; logs and component source establish the intended TV-focusable gesture gate. Select that gate explicitly and require it enabled, preserving pre-gesture zero ads and post-gesture playback assertions. Corrected head passed all gates and all 42 browser tests as recorded above.
- Execution environment disconnected with `409 environment_offline` after initial CI. All implementation is saved on GitHub; these narrow test fixes and this checkpoint are applied through the repository connector. No local validation of the correction is claimed; CI remains mandatory.
- Next security review before MFA UI: reproduce concurrent different recovery-code consumption (current read/filter/write can overwrite another consumption), enrollment-start versus confirmation, and regeneration/disable versus credential reset or staff-role change. Existing MFA tests cover sequential behavior, not these races. These are source-review findings pending regression reproduction, not completed fixes.

## Resume checkpoint after PR #129

- Product main: `f5104bcc917ddfee22bff3b49755c7e7a6b4d368`. PRs #127, #128 and #129 are accepted; exact gate evidence is above. Phase 2 overall and Phases 3–5 remain incomplete.
- Workspace `/workspace/scratch/f419afa1d147/ayin-restored` was clean at `d49d151d` before disconnection. The remote branch subsequently received `c6797480` test fixes, then PR #129 merged. Fetch main and inspect status before continuing; do not assume the local checkout contains those remote changes.
- Execution attempts repeatedly return `409 environment_offline`. GitHub connector remains usable and preserves the work; no new broad implementation phase started after disconnection.
- Next concrete work: reproduce/fix MFA concurrency with database tests, then account MFA UI; resolve discovery policy-pagination semantics before route/IA reconstruction. Continue using the existing Web/PWA as the shared product.

## Phase 2G.1 — MFA recovery-code concurrency, verified and merged

- Starting SHA: `f7625fae8543dfa204a7239a900edb4b48e23cd4`; workspace restored, clean older checkout fast-forwarded after PR #130 passed quality `36347523296` and merged with expected-head protection. Checkpoint read before implementation.
- Findings: recovery consumption reads the entire hash list, filters one hash and writes the derived list later. Distinct concurrent codes can overwrite each other's removal; the write does not recheck ENABLED status. These findings require PostgreSQL reproduction before acceptance.
- Reproduction: unchanged production head `37d7dbbbd6dc274819ba1d5a680c6d25933ad795`, quality run `36349970543`, reproduced exactly two failures: different-code consumption restored one used hash; a credential changed to PENDING after the read still authenticated. Other 548 API integration-gate tests passed; five new cases took 662ms. No assertion was weakened.
- Changes: atomic PostgreSQL array removal from the current credential row, conditioned on version, ENABLED status and present matching hash. Return the actual remaining count from that update for the transactional audit. Same-code contention still allows only one success; audit failure rolls back removal.
- Migrations: none.
- Tests added: different-code concurrency with audit counts and replay rejection; same-code single use; status/version changes after read; rollback on audit failure (five cases).
- Tests executed: initial local typecheck passed and real PostgreSQL regression evidence recorded above. Fixed implementation passed local API typecheck, lint and all 364 unit tests in 90 files (5.79s); full fixed-head gates pending. Local PostgreSQL and Chromium remain unavailable.
- Performance measurements: one keyed conditional UPDATE returning one scalar, then the existing audit INSERT in the same transaction; no extra read or unbounded scan. Fixed-head test runtime pending; no production latency claim.
- Remaining issues: enrollment/confirmation and regeneration/disable/reset/role-change concurrency review before account MFA UI; discovery pagination and remaining Phase 2/Phases 3–5 remain open.
- External blockers: real database/browser verification runs in CI; no production or device claim.
- Next: run complete gates on the fixed head, then remaining MFA lifecycle concurrency review before account UI.
- Rollback: no schema changes; preserve consumed-code state and audit evidence, never restore used recovery codes.

- Fixed head `14642d4d` passed state/audit-count and changed-status regressions; quality `36350419208` had 549/550 tests pass. The replay assertion reached a pre-existing Nest error-shape mismatch: the domain text is in the structured response, while Error.message is "Auth Http Error". Corrected the test to require exact HTTP 401, UNAUTHORIZED code and full domain message; no rejection, persisted-state or audit check weakened. Corrected-head full acceptance pending.

- Phase 2G.1 accepted: quality `36350846031`, security `36350846236` and browser `36350846065` all passed on `58a9d11a7e1de1dfbaaa39f937d653cbb3e0705a`. All 550 API integration-gate tests in 133 files (112.85s), 364 API units, 153 Web units, four migration tests and 42 browser tests (4.1 minutes) passed, including all five new PostgreSQL cases (475ms). Formatting, lint, types and production builds passed. PR #131 merged with expected-head protection; ending main SHA `bab6f8582d401af2d5396ec85a407d4582810721`.

## Phase 2G.2 — MFA enrollment concurrency, verified and merged

- Starting SHA: `bab6f8582d401af2d5396ec85a407d4582810721`; checkpoint read and accepted main fetched before implementation.
- Findings: unconditional enrollment upsert can replace a credential confirmed after the initial read; concurrent starts can return secrets sharing one version. Confirmation checks neither the observed secret nor current account authVersion at its writes.
- Tests added: delayed restart versus confirmation; two simultaneous initial/pending starts; confirmation versus changed secret/account version; audit rollback (six cases).
- Tests executed: local typecheck passed for the test-only change. Unchanged-code PostgreSQL reproduction running on `06e986d5759ea9d41156ca5be40c2a149afca545`, draft PR #132. No acceptance claimed.
- Changes under review: conditional pending replacement / insert-if-absent; confirmation binds observed secret and conditionally increments the active account's observed authVersion, throwing within the transaction to roll back credential changes on conflict.
- Migrations: none.
- Performance measurements: keyed credential write and existing account/audit writes; no catalog scans, extra polling or automatic mutation replay. Runtime pending.
- Remaining issues: regeneration/disable/reset and role-change concurrency, account MFA UI, discovery policy pagination and remaining product phases.
- External blockers: PostgreSQL/browser execution requires CI; production/device evidence remains separate.
- Next: establish regression evidence, run full corrected-head gates, then continue lifecycle review and account UI.
- Rollback: no schema changes; preserve enabled credentials, consumed factors and audit history; do not restore old enrollment secrets.

- Phase 2G.2 initial CI `36352506834` stopped before PostgreSQL tests: pinned FFmpeg preparation exited 1 without diagnostic output. Direct retrieval of that exact upstream archive returned HTML (`One moment, please…`), SHA256 `e3bce4030920f6d342aec245812fe225ee3f537aab63bd21767ebdf4e7f44848`, not the required archive hash. Integrity verification remains unchanged. One failed-job rerun requested. No regression reproduction or full acceptance is claimed yet.
- Local correction passed API typecheck/lint and 364 unit tests in 90 files (5.81s). Attempt to provision local PostgreSQL was blocked by execution-environment setgroups/seteuid permissions; no privilege workaround attempted. This does not substitute for PostgreSQL or browser gates.
- Failed-job attempt 2 (`108714295271`) again stopped at pinned FFmpeg installation before database tests. Repeated retry did not resolve the external archive delivery problem. Local full `pnpm build` passed (API, packages and Web; all 65 static pages), with pre-existing Edge-runtime stdout/stderr instrumentation warnings. Corrected code remains a draft pending genuine PostgreSQL reproduction and complete CI acceptance. Do not substitute the HTML hash, skip media verification, or claim the master program complete.
- External runtime recovery: located a public mirror at `https://software.frc971.org/Build-Dependencies/www.johnvansickle.com/ffmpeg/old-releases/ffmpeg-6.0.1-amd64-static.tar.xz`; downloaded bytes match the existing pinned SHA256 `28268bf402f1083833ea269331587f60a242848880073be8016501d864bd07a5` exactly. Add fallback only after failed download/integrity validation, keep the same required hash for both sources, fail closed before extraction, and bound connection/download time. Extract as the current user without restoring archived ownership/permissions; explicit binary install mode remains 755.
- Five installer tests passed, covering primary success, invalid HTML fallback, network fallback, both-invalid rejection, both-network-failure rejection and cached reuse; reject cases never extract/install. Tests are part of root `pnpm test`. No runtime upgrade or checksum relaxation.
- Temporary regression head restores the MFA service from accepted main while retaining the new concurrency tests and verified-runtime fallback. The proposed correction is safely committed at `33b31b28` and will be restored after unchanged-code PostgreSQL evidence. This is a draft-only test-first step, never a merge candidate.
- Unchanged-code reproduction now established on `24d5f583760a189ad187413e0d5c71c1ef2d99ce`, quality `36353115227`: verified FFmpeg preparation succeeded, all four migration tests passed, and exactly five of the six enrollment regressions failed as predicted. Delayed restart and changed-secret/account-version confirmations incorrectly fulfilled; both simultaneous-start cases returned two successes. The other 551 API integration-gate tests passed (556 total, 134 files, 138.56s); six new cases took 865ms. Audit rollback already passed. Restored the previously reviewed correction without weakening any regression assertion; final full acceptance pending.
- Actual local fallback installation and cached runtime verification both succeeded with the original pinned archive/hash. The upstream availability blocker is resolved by verified fallback; PostgreSQL/browser correctness still requires final-head CI.

- Phase 2G.2 accepted: final head `7a8a0259fca237dc9bcce7dc62cf55eb6805c217` passed quality `36353453580`, security `36353453568` and browser `36353453591`. All 556 API integration-gate tests in 134 files (123.27s), six new enrollment regressions (675ms), 364 API units, 153 Web units, five installer tests, four migration tests and 42 browser tests (4.1 minutes) passed; formatting, lint, types and production builds passed. PR #132 merged with expected-head protection; ending main SHA `8b3cddc851e2655c34501d2973ed7807a796295b`.

## Phase 2G.3 — MFA management lifecycle, regression investigation

- Starting SHA: `8b3cddc851e2655c34501d2973ed7807a796295b`; checkpoint read and accepted main fetched before implementation.
- Findings: regeneration and disable consume TOTP before their mutation transaction; their later writes do not bind the verified credential/account version. TOTP consumption itself lacks ENABLED/secret fencing. Disable checks administrator policy before its writes; reset relies on the earlier controller role check. These are source findings awaiting database reproduction.
- Changes: test-first regression suite only at this checkpoint; no production change yet.
- Migrations: none.
- Tests added: regeneration/disable versus changed credential/account version; audit failure restores both TOTP and mutation; disable versus administrator assignment; TOTP verification versus changed status/secret; reset versus actor demotion with another superadmin retained (ten cases).
- Tests executed: new suite typechecked locally; real PostgreSQL execution pending. No database success claimed.
- Performance measurements: pending; no added product requests or polling.
- Remaining issues: establish and fix lifecycle races, integrate account MFA UI, discovery pagination, remaining Phase 2 product surfaces and Phases 3–5.
- External blockers: local PostgreSQL provisioning unavailable; verified FFmpeg fallback restored CI execution. Production/provider/device evidence remains separate.
- Next: reproduce on unchanged production code, apply narrowly scoped transactional/authorization fences, complete all gates, then shared account MFA UI.
- Rollback: preserve enabled credentials, factor-consumption state and audit history; never restore consumed recovery codes or old secrets.
