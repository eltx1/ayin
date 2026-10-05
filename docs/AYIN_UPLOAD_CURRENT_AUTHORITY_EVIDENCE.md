# Current upload continuation authority

This bounded continuation of the Web/PWA master addresses current administrator authority for existing signed upload tokens. It does not implement durable upload resumption or enable any production provider.

## Reproduced boundary

Content-seeding creation already requires a content-scoped administrator, privileged-role MFA where applicable and recent step-up. Its signed V1 upload token records `adminOverride: true`. Previously, the four generic continuation endpoints passed only the authenticated account ID; that flag bypassed channel ownership without rechecking present staff authority.

Supported staff demotion already increments the account authentication version and revokes sessions. The actual regression therefore performs that supported demotion, proves the old cookie is rejected, logs in again, and reuses the still-valid earlier upload token. The fresh login must not recover the former administration grant. Separate regressions cover stale step-up and current privileged MFA assurance/version/status.

Before implementation, the first 20 actual AppModule/PostgreSQL cases produced 17 failures and three valid-role passes on main `bd8f2f637d5020b2d567743503bc192a5fa47189`. Denied authority/lifecycle cases incorrectly returned 201, and the absent transactional authority lock did not produce the expected observed database lock wait. These are executed regressions, not only authored tests.

## Implementation boundary

All four continuation endpoints carry the complete authenticated actor. The signed V1 protocol remains unchanged; administrator provenance selects current OPERATIONS/CONTENT_MODERATOR authority, with existing ADMIN/SUPERADMIN MFA behavior, current account/authentication version/session and five-minute step-up checks.

Short database transactions validate authority before storage work and again before returning part authorization or resumed parts, acknowledging completion, or committing source changes. They use the existing staff/MFA/account/session authority helper. No staff-role lock or database transaction spans an R2 request. Upload expiry and step-up are rechecked after row-lock waits.

Current channel, attached video and source asset lifecycle are also checked, including tombstones. Source completion and idempotent processing enqueue commit together. The processing lifecycle's existing public enqueue entry point is preserved; its new transaction-aware variant permits the upload state and job to roll back together. Generation/source/video ordering preserves generation serialization; video NO KEY UPDATE avoids conflicting with unrelated foreign-key key-share reads. Quick Upload passes its existing authenticated actor through the failure-cleanup abort path.

## Validation

Final focused coverage passed **88 actual PostgreSQL cases in seven suites**, including 37 new continuation-authority cases. Coverage includes supported demotion plus fresh login; unrelated roles; privileged MFA; current session/account/version authority; initial and post-row-wait expiry; channel/video/source removal before and during provider work; single and multipart provider-period revocation; source/job rollback on injected enqueue failure; simultaneous explicit HTTP completions; and duplicate HTTP completion waiting behind actual worker finalization. The tests observe real database lock waits. Valid creator upload, metadata, content seeding, media queue and generation cases remain active.

The initial implementation passed 42 focused cases; an expanded intermediate candidate passed 51. Final full API source tests passed 99 files/421 cases, API types and production declaration build passed, and focused lint/format/diff checks passed. Independent source review caught a channel tombstone-only omission; the final check and both pre-provider/post-provider tombstone regressions include that correction.

### Rejected local broad runs and environment correction

An early broad run after declaration build discovered compiled test copies as well as source tests: 270 files passed, six existing SESSIONEXPIRY tests failed, and five JSON-action cases were skipped after their suite rejected the disposable database's nonstandard name. Its counts are not final-source certification. A subsequent isolated run with the supported `ayin_test` database passed those five JSON-action cases and retained the same six expiry failures. The exact three expiry suites on untouched main `bd8f2f637d5020b2d567743503bc192a5fa47189` likewise produced six failures and 50 passes.

The isolated embedded PostgreSQL server had inherited `Africa/Cairo` timezone, whereas Prisma session expirations are UTC-naive timestamps. A temporary diagnostic on pristine main observed Node time17:18:13, database local wall time20:18:13 and a stored expiry17:18:14; SQL current-session authority rejected with401 before the expected target lock. The diagnostic was removed. Setting **only the isolated test server's timezone to UTC**, without changing assertions or application code, made all 56 unchanged cases pass. This identified a shared authority correctness prerequisite; the additional source correction below removes the timezone dependency rather than requiring a production setting change.

A further pre-final broad run was terminated with SIGKILL, and first UTC retries encountered shared temporary-filesystem exhaustion before test execution. Their failures are retained. Disposable synthetic clusters were moved into this worker's workspace; other workers' data was not changed. Declaration output was moved outside the checkout before the final normal integration command so compiled test copies cannot inflate its count.

An earlier complete UTC run passed 175 files/937 cases. The final normal API integration-suite command passed **176 files/946 cases**, including all 46 new PostgreSQL regressions, with no failures or skips. The integration-suite count includes source tests selected by the repository command; it is not relabelled as 946 distinct PostgreSQL cases. The final focused authority/timezone run passed 122 actual PostgreSQL cases across six suites. Final API source tests again passed 99 files/421 cases, API typecheck/declaration build/full lint passed, and repository-wide formatting passed after a formatting-only test-chain correction. `git diff --check` passed. No CI, merge or production-deployment acceptance is inferred from local checks.

### Timezone-independent shared authority prerequisite

The shared authority helper now compares the indexed UTC-naive `expiresAt` column against `(clock_timestamp() AT TIME ZONE 'UTC')`. This preserves the real database wall clock and current row-lock semantics while avoiding implicit conversion through the PostgreSQL connection timezone. No production/database setting is changed.

Nine additional actual helper/HTTP cases run with test-connection-local `UTC`, `Africa/Cairo` and `America/Los_Angeles` options, and verify the actual connection timezone. Before the one-expression correction, three failed and six passed: Cairo wrongly rejected a live session; Los Angeles wrongly accepted an expired session directly and committed an HTTP account write after session expiry during an observed account-lock wait. The tests preserve live acceptance, expired denial, clock-based expiry and unchanged target/audit state in all three zones. The correction is a prerequisite for safely reusing this helper for upload continuation, and leaves its other authorization contracts unchanged.

## Explicit limits

- R2 control-plane operations and previously issued presigned URLs are not retractable by a later database denial. When authority changes during a provider request, the response or source mutation is denied; an already performed provider effect remains a reconciliation concern.
- Provider calls use the controlled test adapter. The tests prove actual API/authentication/PostgreSQL boundaries, not physical R2 bytes, availability or provider rollback.
- The ordinary creator path retains owner checks and does not acquire administrator MFA/step-up requirements. Full creator membership/session race redesign remains separate.
- Upload-session creation and content-seeding batch/item transactions are not redesigned here.
- No browser token persistence, token renewal, full-file identity verification, cross-reload recovery, automatic replay or publication is introduced.
- Full durable resumption, provider reconciliation, cleanup certification and completion of the master remain open.
