# Clips progress identity and freshness acceptance

## Scope and reproduced defect

This is the Clips follow-on identified by
`AYIN_PLAYER_PROGRESS_LIFECYCLE_FRESHNESS_EVIDENCE.md`. It reuses the existing
viewer identity coordinator, progress hook, and conditional progress API. It
adds no coordinator, API behavior, migration, or media engine.

On unchanged main `5995ff4cde57beea72f50ef50186f2c31e3a1d7d`, a native Chromium
case left Clips at 17 seconds under account A, replaced its real shared session
cookies with account B, then paused the retained clip. The old unscoped helper
created B's real PostgreSQL progress row at 17,000 ms. The failing report, trace,
and database assertion are retained in the external evidence bundle.

`ClipVideo` now supplies the exact verified account/profile, current lease and
pre-suspension subscription to `useWatchProgress`. Reads and ordinary writes are
aborted on owner teardown; every PUT carries `expectedRevision`. The existing
hook drops stale ACK effects, refreshes once after a freshness conflict, and
requires a new explicit checkpoint before replay. Native controls, feed
pagination, keyboard navigation, and existing Clips analytics remain in place.
Unmount explicitly releases the media source after the progress run is revoked.

## Clips-specific review corrections

Two independently reproduced integration issues required a bounded extension to
the shared hook:

- Native `seeking` events also follow the hook's own resume and owner-reset
  assignments. Treating every one as deliberate input suppressed B's saved
  resume. The hook tracks its internal target and provides native seeking/seeked
  adapters; custom Watch controls continue using their existing explicit seek
  function. The marker survives same-owner revalidation.
- Metadata can load for an offscreen completed clip without the viewer watching
  it. A final checkpoint must not rewrite its completed timeline to zero. An
  optional persistence predicate now lets Clips require play, a running
  timeupdate, or a deliberate native seek by the current owner. Internal
  resume/reset and pause/end callbacks alone do not establish participation.
  Adopting a different verified owner clears participation, including A→B→A.

The independent actual-source hook harness reproduced both problems before
these corrections. Its revised checks also cover continuous playback after an
owner change and a queued internal seek across same-owner suspension.

Decoded synthetic WebM checks independently confirmed two further native event
orders. A prior `seeked` can arrive while a newer reset is still seeking, so the
adapter retains its current target while `video.seeking` is true. A queued
trusted `play` can arrive after the media is already paused, so it establishes
participation only while `video.paused` is false. Focused regressions preserve
both observed orders.

## Verification chronology

The production Web build and unchanged API build passed. Full Web lint and type
checks passed, as did all 712 Web unit tests. Source formatting, fixture syntax,
and patch whitespace checks passed.

The first combined production browser run passed 58 of 60 cases. All 18 new
Clips regressions and all 27 Watch progress regressions passed. Two preservation
failures were retained and investigated:

- The new Clips fixtures accumulated in the public feed, causing the existing
  Clips EN/AR test's exact title selector to match multiple rows. The new suite
  now hides only its own bounded, verified synthetic video IDs after each test;
  progress/history rows remain available for evidence.
- One existing Account→Home coordination case encountered a renderer target
  crash during its menu click. It does not mount Clips or the player hook.

The final guarded build passed all 62 production Chromium cases: 20 Clips,
27 Watch progress, and 15 existing Clips/HLS/MP4/IMA/Watch/Kids/account
preservation cases. The existing Account coordination cases also passed an
independent isolated 2/2 replay. EN 1440-pixel and AR 390-pixel originals are
retained as historical full-page captures, not viewport-layout acceptance.
`AYIN_CLIPS_NATIVE_LAYOUT_EVIDENCE.md` records the later decoded viewport
inspection, layout correction, and replacement originals. The final independent source review passed seven focused hook cases
and found no remaining blocking issue in this bounded scope.

The final guarded production build also passed a separate 3/3 decoded synthetic
WebM replay: actual native account reset/resume and keyboard rewind, trusted
overlapping seek-event ordering, and unchanged offscreen completion/revision.
These cases use real Chromium media properties and decoded frames, with no
media prototype overrides. They do not certify an external media provider or
physical device. The earlier independent decoded run and its initial
exact-position fixture failure are preserved separately.

Controlled auth/API/database regression tests use real session cookies, the real
progress handlers, and disposable PostgreSQL; media readiness, time and
play/pause are controlled DOM seams. They do not prove physical-device behavior.
Independent decoded-media checks are identified separately from those
controlled-media cases. Exact built-source hashes and final runtime results are
recorded in the external source manifest and reports.

Existing controlled HLS/IMA tests emitted the previously observed AdPlacement
setup-conflict errors while their assertions passed. All owning and independent
PostgreSQL/browser runtimes were shut down; final logs report no PostgreSQL
server and an empty same-shell service process list.

## Bounds

Final keepalive delivery retains the accepted Watch bounds: it is best effort,
requires an established revision and idle writer, has its own short deadline,
and never starts a background replay after suspension. A soft route change does
not promise an unsaved final checkpoint; the Home/Back regression first saves a
pause checkpoint and verifies teardown plus later restoration.

Progress reads remain scoped per rendered clip. Untouched clips cannot create a
checkpoint solely because their metadata or saved resume loaded. No broader
social-action, account, feed-policy, or analytics redesign is claimed. Legacy
API clients that omit `expectedRevision` remain intentionally unconditional;
this change removes that legacy path from the Web Clips player only.

Raw baseline/final logs, browser traces, EN/AR originals, source hashes, review
artifacts, and runtime shutdown proof live outside the source patch in the
`ayin-clips-progress-evidence` and `ayin-clips-progress-review` bundles.
