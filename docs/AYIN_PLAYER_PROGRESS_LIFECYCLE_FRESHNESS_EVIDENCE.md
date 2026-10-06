# Watch lifecycle delivery and atomic freshness acceptance

## Relationship to the initial identity work

This is a bounded follow-up to `AYIN_PLAYER_IDENTITY_PROGRESS_EVIDENCE.md`.
That document and its original baseline/final-20 evidence describe the initial
identity fence; they do not establish the lifecycle/freshness behavior below.
The initial API-unmodified scope is superseded by this follow-up's backward-
compatible progress API contract. There is no database migration.

## Reproduced defects and correction

The first identity-fenced candidate cancelled or skipped an idle final checkpoint
on pagehide/hidden. The viewer coordinator synchronously invalidated its lease,
while ordinary requests shared the run's abort signal. The existing TV runtime
could also pause media before the player captured its final value.

The bounded lifecycle correction lets a verified Watch subscriber capture one
immutable, already-authorized snapshot before identity suspension. The existing
TV runtime emits its pre-suspend event before its native pause/stop event; the
coordinator invokes subscribers before invalidation. The already-started keepalive
PUT gets an independent five-second delivery deadline. Reads and ordinary writes
remain tied to the owner run's abort signal. After invalidation, late delivery
cannot acknowledge progress, emit checkpoint analytics, resume media, clear a
new run's busy flag, or schedule another write. Subscription cleanup is explicit.

An independent reviewer then reproduced a distinct same-account ordering bug:
final position 37 was held **before server commit**, the same account refocused
and committed position 53, then releasing 37 overwrote the real database row.
Holding only the response after commit would not have found this race.

The progress API now returns `revision`, a canonical UTC millisecond ISO alias of
existing `WatchProgress.lastWatchedAt`. Watch writes send explicit
`expectedRevision`: null requires absence; a string requires that exact stored
revision. Comparison and INSERT/UPDATE happen in one parameterized SQL statement
inside the existing progress/history transaction. A conflict returns HTTP 409
`WATCH_PROGRESS_CONFLICT` before modifying progress, completion, or history.

The existing column is `TIMESTAMP(3)`, verified in both the migration and actual
PostgreSQL metadata. Every accepted writer advances its revision, including
legacy callers: the next revision is the greater of the database's UTC
millisecond clock and the old revision plus one millisecond. This prevents token
reuse for rapid writes or a clock moving backward. Position remains freely
rewindable; completion and history view-count semantics are preserved. Progress
responses are private/no-store.

The client treats freshness conflict separately from identity failure. It drops
the conflicted/queued intent, reads the current snapshot once, and allows a write
only after a new explicit checkpoint. Routine timeupdates cannot blindly replay
it. Failed or lost ACKs never advance the acknowledged revision. Expected account,
exact profile, bounded response validation, and current coordinator lease checks
remain in force.

## Owning verification

Application code was built at frozen tree
`b1b6fe4ce74244cd512cae3a1748bf25fa6573b1`. The final browser tree
`6c96ae2683de6d876df921db21aca530f2787ff9` changes only four test-harness lines,
with identical application source/binaries.

- API and Web production builds passed.
- All 8 real PostgreSQL integration cases passed, including absent-row create
  contention, same-revision update contention, stale history/completion rollback,
  strict millisecond advancement under an older clock, deliberate rewind, legacy
  interference, removed rows, malformed preconditions, and existing policies.
- All 41 production Chromium cases passed: 27 focused Watch regressions and 14
  existing HLS/MP4/IMA, Watch/Kids, and account-coordination preservation cases.
- All 672 Web unit tests and 516 API unit tests passed. Full API/Web lint and
  type checks passed.

The focused browser cases use real authentication, shared cookies, API handlers,
server sessions, and PostgreSQL. Media time/readiness/play/pause remain controlled
DOM seams. These results do not certify decoded playback or a physical device.

The actual cross-document unload case sets ready media to 37 without a pause or
progress timeupdate, verifies no progress row exists, navigates to `about:blank`,
verifies document replacement, and observes the real scoped DB row at 37,000 ms.
No synthetic lifecycle event, progress interception, or API write delivers it.
An initial run failed while unrelated media/ads Playwright routing was still
active. Removing all page routing before destruction made the unchanged
production build pass in a single-case replay and the full rerun. Both failed and
passing evidence are retained. A destroyed-document keepalive can be invisible
to the page-scoped Playwright trace/CDP observer even when the database commits;
absence from those observers alone is not evidence of no request.

The Home → Back test models `load()` resetting time and readiness after source
release. It passed but created a new media element on Back. It does not prove the
separate hypothetical case of reusing the exact retained element after a source
reset, and no speculative source change was made for that hypothesis.

## Independent acceptance

The reviewer independently reran both before-commit races: one began with no row,
the other with an existing 13-second revision. In each, the newer 53-second PUT
returned 200, releasing the old 37-second PUT returned 409
`WATCH_PROGRESS_CONFLICT`, and the winning progress/history rows stayed unchanged.
The reviewer also reran all 8 PostgreSQL integration cases successfully.

The independent actual-unload check waited 6.5 seconds before navigation so the
browser's default preflight cache could expire. Its first run saved the real
37,000 ms row, but an added CDP-observation assertion failed: the request outlived
the document observer and was not visible there. That instrumentation failure is
preserved. A repeat with native Chromium network logging passed the DB/revision
assertions and recorded a fresh OPTIONS 204 followed by PUT 200. The request kept
JSON content type and the exact expected-account header; the authenticated result
and DB row matched the exact profile/video. The sanitized network summary is
included in the evidence bundle; the raw native network log is excluded.

No production change was needed for the unload fixture or observer corrections.
The reviewer verified PostgreSQL shutdown and an empty same-shell service process
report before releasing the runtime slot.

## Bounds and compatibility

- Final delivery is best effort. If a read has not established a revision or an
  ordinary write is already outstanding, suspension declines another final PUT;
  the latest seconds may be lost. It does not queue a background retry.
- Browser keepalive does not guarantee delivery after hard OS/browser termination,
  offline loss, or expiry of the bounded delivery deadline.
- Expected-account/profile checks stop cross-owner writes, and conditional Watch
  revisions stop delayed same-owner conditional writes. Legacy callers omitting
  `expectedRevision` intentionally remain unconditional for compatibility; a
  delayed legacy caller can still overwrite newer state. Every legacy write
  invalidates previously observed conditional tokens.
- The separate Clips progress helper remains an explicit follow-on. The shared
  viewer lease alone does not cover it; no Clips correction is claimed.
- No media engine, ad provider, captions, chapters, or new identity framework was
  introduced. Creator TV and anonymous non-progress playback do not require the
  Watch provider.

## Evidence locations and chronology

Raw artifacts stay outside the source patch:

1. `ayin-player-identity-evidence`: original unchanged-baseline failures and
   initial final-20 evidence.
2. `ayin-player-lifecycle-delta-evidence`: lifecycle before/after proof and
   `independent-lifecycle-report.json`, the confirmed old-37/new-53 failure.
3. `ayin-player-freshness-evidence`: production build logs, initial 40/41 report,
   unchanged-app unload isolation, final 41/41 report, 8-case PostgreSQL report,
   full source gates, shutdown proof, and independent follow-up review.

The runner uses the pinned installed tools, a disposable UTF-8 PostgreSQL cluster,
Next on `0.0.0.0` with browser origin `127.0.0.1`, and one process environment for
PG/API/Web/browser. The final owning PG log confirms shutdown, `pg_ctl status`
reports no server, and the same-shell target service process report is empty.
Existing HLS/IMA controlled-ad tests emitted AdPlacement setup-conflict errors
while their browser assertions passed; this is not a new Watch progress failure.
