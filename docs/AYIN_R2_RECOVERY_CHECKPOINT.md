# R2 recovery implementation checkpoint

Verified checkpoint: 2026-10-08, 21:32 UTC. Inspect the current PR heads and workflow results before repeating any action.

## Merged provider reconciliation

[PR273](https://github.com/eltx1/ayin/pull/273) was reviewed and merged at `654092a7a0bcf526d97b84c03f2d48aeb711b8ae`. Its reviewed candidate was `30053abaefabf5237b671fea28d5fe96c56addff`.

This slice adds identity-bound R2 metadata, strict bounded completion observation, an explicit owner/revision-fenced reconciliation command, and browser recovery after a lost completion response. Reconciliation never replays Complete. It also fixes SigV4 query byte ordering. It does not enable durable upload issuance or adopt legacy uploads into recovery sessions.

Candidate quality, browser, security, and inventory CI passed. Focused real-PostgreSQL recovery passed 120 tests; browser recovery passed all 16 cases on the full rerun. API unit tests passed 926 and web unit tests passed 1,192. Serialized all-workspace lint, typecheck, formatting, and build passed. The initial local aggregate integration attempt used an incorrectly initialized SQL_ASCII/non-UTC database and is not passing evidence; the six affected baseline suites passed 134 tests on a fresh UTF-8/UTC database without product changes.

## Deployment recovery and activation hold

[Production deployment 37832988391](https://github.com/eltx1/ayin/actions/runs/37832988391) failed during the production-host Next.js build with exit 137 and `Killed`. This happened before database migration, release symlink change, or process activation. Do not report the merged slice as deployed.

[Read-only diagnostic 37836418061](https://github.com/eltx1/ayin/actions/runs/37836418061) at 20:02 UTC confirmed the previous `c05eedbfb7477836699654475160a71d2446bc58` release remains active. Web and API liveness returned HTTP 200; API readiness returned HTTP 503. The two-CPU host had approximately 282 MiB available RAM out of 3.72 GiB, 1.54 GiB swap in use, and load averages around 146/112/98. Historical OOM counters do not prove the exact cause of this build's termination. Bounded read-only diagnosis and a separately reviewed CI-built web artifact path are in progress. Avoid another production-host build or activation while readiness is degraded.

Subsequent bounded host/readiness verification was healthy at 21:28 UTC. [PR275](https://github.com/eltx1/ayin/pull/275), independently reviewed with all candidate CI passing, merged at `83faf1a249dfd083458a9c25646dc2fe6982b7db`. It promotes the exact CI-built Web artifact instead of compiling Next.js on the production host, and replaces automatic Cloudflare mutations with read-only endpoint verification. Its exact-main deployment is still being monitored; this checkpoint does not claim successful activation. PR274 includes these main changes, preserving both artifact and media-fixture regression checks and compiled media-import verification before artifact packaging.

## Finite cleanup and writer accounting

[Draft PR274](https://github.com/eltx1/ayin/pull/274), branch `codex/ayin-r2-cleanup-debt-v2`, contains the implemented, independently reviewed finite-cleanup slice. Preserved remote checkpoints include `7a476ab7bf0a7d376e72ca6d00ea391f6c960e2c`, `255089642ccaacc57f44df7fb6779bc65e984492`, and `6b167cd5e6e3a987b6bdb7fe0508fd35c02494fd`. Their reviewed source was consolidated at `b8e9d8189df29151cb832df77f44e2ca1c17f113`; the canary, output-reservation and completion-preflight fixes are at `fab8290fa3c635e8798575f606f16b5555814957`. The main-compatibility/documentation update supersedes that candidate and needs its own exact-head CI. Never overwrite a newer remote head without an expected-SHA lease.

V2 separates accepted source processing, active upload slots, unresolved physical-work reservations, and retained cleanup observations. It journals source CREATE/COMPLETE and immutable worker output writes, uses multipart-only source uploads with exact-length signatures, and retains UNKNOWN outcomes. Cleanup uses a frozen acknowledged application write set plus exact-address absence observations and bounded tombstone rechecks. This is a finite application/observation contract, not a promise of eternal provider absence. Historical V1 proof and jobs remain in their original lane.

The new rollout switch is off, byte budgets default to zero, and no canary account/channel tuple is configured. Issuance requires one explicit tuple, a source limit no greater than 16 MiB, one unretired source, and pre-reserved lifetime processing capacity. Each measured worker write consumes its stored envelope exactly once, including retry namespaces. Existing accepted work drains with issuance disabled. COMPLETE performs read-only multipart validation before its single dispatch reservation, leaving failed preflight retryable without fictional UNKNOWN writes. Positive budgets and the switch are not acceptance evidence. See [finite cleanup V2](FINITE_MEDIA_CLEANUP_V2.md) for the accounting and compatibility contract. Do not activate merely because mocked provider tests pass.

### Verification of the frozen application source

- Clean PostgreSQL 17 UTF-8/UTC migration deployment passed all 65 migrations; the populated forward-migration suite passed 5/5.
- Full local API integration command passed 355 files / 3,325 tests on `fab8290`. The command also discovers compiled unit-test copies, so this is the runner's aggregate count, not 3,325 unique integration scenarios. Coverage includes 51 completed source/output/READY/cleanup turnovers, concurrent reservations, over-envelope refusal before I/O, disabled-issuance drain, UNKNOWN retention, privacy races and direct invalid-evidence rejection.
- All workspace unit suites passed in a bounded serial rerun: API 1,039, Web 1,192, shared packages and FFmpeg checks. An earlier concurrent run lost one worker; it is not passing evidence.
- Workspace lint, formatting, typecheck and production build passed. Four fresh native compiled-import checks passed.
- Full real-Chromium recovery acceptance passed 20/20, including English/Arabic verification and completion/reconciliation when browser capability is off. Those browser flows use the synthetic provider; V2 kill-switch behavior is separately covered by PostgreSQL tests.
- The owned-fixture runner passed 38 offline tests; independent local HTTP/SigV4 browser length acceptance passed 6/6, including smaller and larger bodies rejected against signed length. Neither establishes live R2 behavior.
- Baseline `b8e9d818` full remote browser acceptance passed. At this checkpoint, `fab8290` remote security and inventory passed; its quality/browser checks and the superseding main-compatible candidate's exact-head checks remain pending.

## Live-provider acceptance boundary

The reviewed [owned-fixture runbook](R2_OWNED_FIXTURE_ACCEPTANCE.md) and manual-only workflow are tooling, not live evidence. Their 38 offline tests pass. Six real-Chromium local-server length/signature cases also pass, but they do not certify R2 enforcement or the production CORS path.

The reserved fixture is exactly `ayin-production-media/ayin-recovery-acceptance/34c4947c-ba13-4fc9-9087-0d1db8cc4d28/`, with only the three keys and bounded sizes in the runbook. Explicit approval for its creation and irreversible cleanup was received at 20:05 UTC. Execution remains held for healthy readiness and the reviewed deployment. No live fixture run, credential/access change, bucket policy change, or deletion of existing user media has been performed. The manual workflow must run from a successful, already-deployed reviewed main SHA, and refuses replay through a permanent manifest reservation.

## Remaining acceptance gates

- Finish exact-head remote quality/browser/security/inventory checks on the main-compatible PR274 candidate and review its CI-step merge; resolve genuine failures without weakening prerequisites.
- Preserve the completed independent application safety review. Any real activation still requires reviewed canary limits, provider evidence and an explicit rollout decision.
- Verify the merged deployment repair on its exact live release and readiness; do not substitute a merged PR or passing candidate build for deployment proof.
- Deploy the reviewed compatible schema and workers with V2 issuance disabled, then verify the exact live release SHA and readiness.
- Only after explicit fixture approval, run the bounded real R2/browser acceptance once and retain its sanitized evidence. A timeout or missing artifact is inconclusive, never permission to replay.
- Make a separate evidence-backed controlled activation decision. Report any remaining live application-flow, accounting, or provider uncertainty rather than claiming full resumable activation.
