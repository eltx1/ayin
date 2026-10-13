# Bounded creator upload rollout — 2026-10-13

## Application change

- PR [278](https://github.com/eltx1/ayin/pull/278) adds explicit `canary` / `all` audience selection, a maximum declared source size, bounded global outstanding sources, and the effective file-size limit in the picker.
- PR [279](https://github.com/eltx1/ayin/pull/279) gives concurrent test registrations distinct channel names. It changes a fixture only; simultaneous upload admission remains tested.
- Final release: `d29d539ae31b988714113b3a865ada9e996c5a8f`.
- Current owner/session/channel checks, ordinary administrator quota, immutable source/output reservations, global UNKNOWN barriers, pending processing/output cleanup barriers and issuance-off drain are preserved.

## Validation evidence

- Application quality on unchanged application code: [38415736776](https://github.com/eltx1/ayin/actions/runs/38415736776), successful.
- Isolated V2 acceptance: [38417322994](https://github.com/eltx1/ayin/actions/runs/38417322994), successful: 47 PostgreSQL integration tests and the browser offline/multipart scenario.
- The browser scenario transfers three real local HTTP bodies (5 MiB, 5 MiB, 137 bytes), goes offline between parts, reloads, verifies the original file again, and completes with one allocation, three authorizations, three PUTs, one completion and one integrity-verification job. Full-file SHA-256: `ae243b382bee66948d3daae4d8c55a2c752f12cda707b0d41d29fdeae3efecdb`. No cookies or authorization headers reach the synthetic byte receiver. This is synthetic-provider coverage, not live R2 outage certification.
- Exact final-main quality run: [38419809971](https://github.com/eltx1/ayin/actions/runs/38419809971), successful.
- Two harness issues were corrected: accepting V2's untyped Blob in the test receiver, and asserting the mandatory integrity queue instead of the later processing queue. A repeated full run also exposed a same-name registration race in fixture setup; distinct fixture names remove that unrelated race from the upload concurrency test without relaxing upload assertions.

## Active production bounds

| Setting | Value |
| --- | ---: |
| Audience | all authenticated creators, subject to current authority |
| Declared source ceiling | 134217728 bytes (128 MiB), also bounded by admin upload limit |
| Unretired sources | 8 globally |
| Part size | 16777216 bytes (16 MiB) |
| Lifetime output envelope | 536870912 bytes (512 MiB) |
| Account and channel physical-debt accounting budgets | 43486543872 bytes each (40.5 GiB) |

These conservative accounting reservations are not actual provider-size or billing guarantees. Processing and uncertain provider effects can block new admission even when source-count slots remain.

## Live verification

- Exact production deployment [38422078088](https://github.com/eltx1/ayin/actions/runs/38422078088) succeeded for the release above, using quality run 38419809971. Origin readiness and public edge verification [38422315325](https://github.com/eltx1/ayin/actions/runs/38422315325) passed.
- Read-only preflight [38422706314](https://github.com/eltx1/ayin/actions/runs/38422706314) verified the exact deployed release, two historical sessions, issuance disabled and zero outstanding processing, cleanup or uncertain effects.
- Guarded activation [38422829528](https://github.com/eltx1/ayin/actions/runs/38422829528) succeeded. API and worker environment readback confirmed issuance enabled, all-creators audience and the bounds above. No database writes or provider requests were made by activation.
- Authenticated Mr Lord browser test created one 67109001-byte upload, uploaded parts, stopped, reloaded the page, read back 99% progress, reselected and verified the identical original file, resumed to 100%, and finished. Studio then displayed “Your video is ready to publish.” The synthetic video remains a draft.
- Read-only inspection [38423166781](https://github.com/eltx1/ayin/actions/runs/38423166781) confirmed one new fixture session, five part grants, one CREATE and one output reservation; no uncertain operations or unacknowledged output writes.
- Fixture session fingerprint: `e417f43a651c8aaf516b82f86a0b8cd70f10a32311a9d664272668f778ffce3a`.
- Initial provider verification confirmed COMPLETED / READY, one COMPLETE, byte-matched output (543960 bytes, SHA-256 `6c885b5d4fe66d72aea396ebc1d55d7571fb9a527046b055430c1c449f0f6006`) and a 19292-byte thumbnail. Its source HEAD hit the verifier's three-request budget: the adapter first HEADs the output before GET. The read-only verifier budget was corrected to exactly four requests (output HEAD + GET, thumbnail HEAD, source HEAD); no application behavior or security gate was relaxed.
- Final four-request provider verification [38423753192](https://github.com/eltx1/ayin/actions/runs/38423753192): successful, VERIFIED. The sanitizer request limit was aligned with the same four-request budget. Output integrity and thumbnail presence passed; the observed source HEAD returned 404 (`sourceAbsent=true`). There were zero database writes, deletions, uncertain operations or unacknowledged output writes.
- Three source-cleanup jobs were still pending final settlement at verification time (`sourceCleanupDone=0`), despite source HEAD returning 404. The 15-minute signed-grant safety horizon remains in force; absence alone does not prove settled cleanup or freed debt. Video readiness and output integrity were verified independently.

The new fixture is a synthetic six-second MP4 with a valid trailing `free` box to exercise five parts without unnecessarily increasing transcoding load. It contains 67109001 bytes. File SHA-256: `04d2a5d27dbafff44128b861ae441c99784e27842f77994c72b8fb44c8b737c6`; AYIN chunk-root identity: `ada7a437a1d9d70021cee510add19c3adfe0718f1c5ca1127bfd7cb710c6e3a3`.

The original 2026-10-10 fixture journals and evidence remain unchanged. Production rollout tooling uses a separate exclusive activation journal, verifies the deployed SHA, changes only the rollout settings, checks API/worker environment readback and readiness, and disables new issuance after an activation failure. Database inspection uses read-only connections. Provider verification permits only bounded GET/HEAD requests against the exact fixture and derived output. No provider fixture replay, direct database acceptance writes, infrastructure permission changes or video-signing changes are introduced.

## Rollback and remaining bounds

Disable `AYIN_UPLOAD_RECOVERY_V2_ENABLED` while retaining configured budgets and existing reservations so accepted work can drain. Do not reset immutable counters or interpret UNKNOWN effects as free capacity. Browser reload/stop recovery on live R2 and synthetic browser offline recovery must be reported separately.

