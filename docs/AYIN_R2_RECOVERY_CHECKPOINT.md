# R2 recovery implementation checkpoint

Verified checkpoint: 2026-10-08, 20:06 UTC. Inspect the current PR heads and workflow results before repeating any action.

## Merged provider reconciliation

[PR273](https://github.com/eltx1/ayin/pull/273) was reviewed and merged at `654092a7a0bcf526d97b84c03f2d48aeb711b8ae`. Its reviewed candidate was `30053abaefabf5237b671fea28d5fe96c56addff`.

This slice adds identity-bound R2 metadata, strict bounded completion observation, an explicit owner/revision-fenced reconciliation command, and browser recovery after a lost completion response. Reconciliation never replays Complete. It also fixes SigV4 query byte ordering. It does not enable durable upload issuance or adopt legacy uploads into recovery sessions.

Candidate quality, browser, security, and inventory CI passed. Focused real-PostgreSQL recovery passed 120 tests; browser recovery passed all 16 cases on the full rerun. API unit tests passed 926 and web unit tests passed 1,192. Serialized all-workspace lint, typecheck, formatting, and build passed. The initial local aggregate integration attempt used an incorrectly initialized SQL_ASCII/non-UTC database and is not passing evidence; the six affected baseline suites passed 134 tests on a fresh UTF-8/UTC database without product changes.

## Deployment is blocked before activation

[Production deployment 37832988391](https://github.com/eltx1/ayin/actions/runs/37832988391) failed during the production-host Next.js build with exit 137 and `Killed`. This happened before database migration, release symlink change, or process activation. Do not report the merged slice as deployed.

[Read-only diagnostic 37836418061](https://github.com/eltx1/ayin/actions/runs/37836418061) at 20:02 UTC confirmed the previous `c05eedbfb7477836699654475160a71d2446bc58` release remains active. Web and API liveness returned HTTP 200; API readiness returned HTTP 503. The two-CPU host had approximately 282 MiB available RAM out of 3.72 GiB, 1.54 GiB swap in use, and load averages around 146/112/98. Historical OOM counters do not prove the exact cause of this build's termination. Bounded read-only diagnosis and a separately reviewed CI-built web artifact path are in progress. Avoid another production-host build or activation while readiness is degraded.

## Finite cleanup and writer accounting

[Draft PR274](https://github.com/eltx1/ayin/pull/274), branch `codex/ayin-r2-cleanup-debt-v2`, contains the next slice. Preserved remote checkpoints include `7a476ab7bf0a7d376e72ca6d00ea391f6c960e2c`, `255089642ccaacc57f44df7fb6779bc65e984492`, and `6b167cd5e6e3a987b6bdb7fe0508fd35c02494fd`; final verification and publication may supersede them. Local reviewed changes and the owned-fixture runner must be reconciled before any history fold. Never overwrite a newer remote head without an expected-SHA lease.

V2 separates accepted source processing, active upload slots, unresolved physical-work reservations, and retained cleanup observations. It journals source CREATE/COMPLETE and immutable worker output writes, uses multipart-only source uploads with exact-length signatures, and retains UNKNOWN outcomes. Cleanup uses a frozen acknowledged application write set plus exact-address absence observations and bounded tombstone rechecks. This is a finite application/observation contract, not a promise of eternal provider absence. Historical V1 proof and jobs remain in their original lane.

The new rollout switch is off and byte budgets default to zero. Positive budgets and the switch are not acceptance evidence. See [finite cleanup V2](FINITE_MEDIA_CLEANUP_V2.md) for the accounting and compatibility contract. Do not activate merely because mocked provider tests pass.

## Live-provider acceptance boundary

The reviewed [owned-fixture runbook](R2_OWNED_FIXTURE_ACCEPTANCE.md) and manual-only workflow are tooling, not live evidence. Their 38 offline tests pass. Six real-Chromium local-server length/signature cases also pass, but they do not certify R2 enforcement or the production CORS path.

The reserved fixture is exactly `ayin-production-media/ayin-recovery-acceptance/34c4947c-ba13-4fc9-9087-0d1db8cc4d28/`, with only the three keys and bounded sizes in the runbook. Explicit approval for its creation and irreversible cleanup was received at 20:05 UTC. Execution remains held for healthy readiness and the reviewed deployment. No live fixture run, credential/access change, bucket policy change, or deletion of existing user media has been performed. The manual workflow must run from a successful, already-deployed reviewed main SHA, and refuses replay through a permanent manifest reservation.

## Remaining acceptance gates

- Finish the exact frozen V2 aggregate PostgreSQL, unit, browser, schema, lint, formatting, typecheck, build, and remote CI checks; resolve genuine failures without weakening prerequisites.
- Complete independent activation-readiness review, including bounded usable debt budgets, UNKNOWN retention, old-worker rejection, ownership and privacy races, and winning playback preservation.
- Diagnose readiness degradation and safely restore a verified deployable state. Review and validate deployment packaging independently before merging it.
- Deploy the reviewed compatible schema and workers with V2 issuance disabled, then verify the exact live release SHA and readiness.
- Only after explicit fixture approval, run the bounded real R2/browser acceptance once and retain its sanitized evidence. A timeout or missing artifact is inconclusive, never permission to replay.
- Make a separate evidence-backed controlled activation decision. Report any remaining live application-flow, accounting, or provider uncertainty rather than claiming full resumable activation.
