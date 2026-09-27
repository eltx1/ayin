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

## Phase 1 — in progress

- Starting SHA: `5de155c19832e55a1d19450eb78d029432c01680`.
- Latest persisted audit checkpoint SHA: `dfb2bcea480c138f8139435a77a81abeefbad385`, Draft [PR #109](https://github.com/eltx1/ayin/pull/109). Phase ending SHA remains pending because Phase 1 is not complete.
- Findings: see `AYIN_PRODUCT_INTEGRATION_AUDIT.md`; source inventory has 73 feature domains, 65 page routes, 8 route handlers, 53 controllers, 357 endpoint paths (355 decorators), 119 models and 57 migrations.
- Changes: master plan; deterministic source inventory script and JSON; human evidence matrix; initial risk register and workflow baseline. Read-only production HTTP probes additionally confirmed placeholder browse destinations and static-manifest precedence; controller guards and Admin/Studio integration entrypoints were inspected. No product implementation changes yet.
- Migrations: none.
- Tests added: none; this is a source/audit artifact. Verify script syntax, deterministic output at a fixed SHA, matrix structure, paths and formatting.
- Tests executed: inventory scanner and probe syntax checks; two scanner runs at baseline SHA were byte-identical; 355 route decorators reconciled to 357 concrete paths; read-only Service Worker and compiled DiscoveryService probes reproduced the documented cache/cursor hazards. Phase 0 results are baseline evidence, not evidence for future code.
- Performance measurements: repository counts only. No production latency, CWV, bundle comparison or device benchmark claimed.
- Remaining issues: complete semantic classification of candidate evidence, per-route mobile/RTL/accessibility review. Filename matching alone is explicitly insufficient for Phase 1 exit.
- External blockers: physical iOS/Android/TV device/store checks and real production traffic/credential-dependent integrations unavailable in this workspace. CI provides PostgreSQL integration coverage; local PostgreSQL is not installed and the package installer failed on UID/group permissions; no permission bypass attempted.
- Next phase: finish Phase 1; then Phase 2 backend integration. Later phases are NOT started.
- Rollback: audit files and scanner are additive; remove their commit without database or runtime effects.
