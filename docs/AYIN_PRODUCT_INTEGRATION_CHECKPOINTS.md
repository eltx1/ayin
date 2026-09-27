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
