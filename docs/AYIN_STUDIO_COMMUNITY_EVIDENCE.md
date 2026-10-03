# Studio Community review and acceptance evidence

This focused Phase6 Creator slice replaces the unbounded English post manager. It is not closure of the full master phases6–16.

## Source corrections

- Added authenticated `GET /creator/community/posts/page`: bounded take1–50/default30, deterministic createdAt/id keyset ordering, ownership-checked cursor, nonremoved posts only. The existing list endpoint remains compatible. No schema or speculative index change.
- Shared EN/AR page/form/action/status/dialog primitives, explicit read/retry/loading/empty states and bounded presentation parsing. User-authored text keeps its own direction.
- Synchronous read/write guards; no automatic mutation retries. An uncertain root-write acknowledgment retains the draft and requires explicit list review. A known saved write followed by a failed read is reported as saved, rather than as an uncertain mutation.
- Root creation acknowledges its ID before image upload. Partial image failure retains that ID and draft, preventing an implicit duplicate root create. Image bytes are inspected before root creation. Storage PUT omits cookies and rejects insecure URLs except the exact configured loopback API origin; image completion and publish acknowledgments are validated.
- Selected-post metadata survives first-page refresh. Named confirmations replace native dialogs, discard cancellation preserves the editor, and beforeunload warns about unsaved edits. Same-document navigation interception remains outside this focused acceptance.

## Validation scope

Local candidate Web301 unit tests, API378 existing unit tests, Web/API lint, type checks and Web production build passed; two new API cursor/bounds tests were added subsequently and require final checks. Existing instrumentation Edge-runtime warnings remain in the build. Exact-head CI, PostgreSQL integration, browser screenshots and expected-head release remain pending. No real audience, storage provider, physical-device or performance certification is claimed.

New PostgreSQL acceptance checks cover equal-timestamp traversal, removed/foreign exclusions, authentication and strict paging bounds. New browser journeys use real registration/posts plus explicit response-loss and read-failure injection, draft/confirmation recovery, invalid image prevalidation, and EN/AR mobile bounds. Fixture screenshots must be inspected after CI before visual acceptance.
