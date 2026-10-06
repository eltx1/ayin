# Watch player identity and progress acceptance

This document records the initial identity-only phase. See
`AYIN_PLAYER_PROGRESS_LIFECYCLE_FRESHNESS_EVIDENCE.md` for the later reproduced
exit-delivery and same-account ordering defects, API contract changes, and current
acceptance. Original phase counts and scope below are preserved as history.

## Scope

This bounded change fences the retained AYIN Watch player against account/profile
changes and interrupted progress operations. It reuses `ViewerProductProvider` as
the identity authority. The reusable player and Creator TV do not acquire a provider
dependency; anonymous playback and Creator TV's disabled progress remain available.

The API's existing authenticated `x-ayin-expected-account` guard remains authoritative.
There are no API, database-schema, media-source, ad-provider, caption, or chapter changes.

## Unchanged baseline

Application source was verified unchanged from commit
`a307cb7948438586a64ef2f7aff0262fb0393df8`, tree
`2b419fa82c5f7d47ae238c37da4fa4c792a6da57`, before and after its production build and
browser run. The initial 18-case regression run failed 16 cases and passed 2 controls.

Observed failures include:

- After A's retained Watch sat at 37 seconds, registering B through the shared
  browser cookie store and refocusing Watch wrote `positionMs=37000` into B's
  actual PostgreSQL progress row. A cookie switch without a focus signal also
  wrote into B.
- A held response containing A's 42-second progress resumed at 42 after B was
  authenticated, rather than B's stored 13 seconds. Held progress also resumed
  after actual logout and database session revocation.
- Changing the account's default profile retained the original profile's resume.
- Metadata arriving before progress left resume at zero. A late response
  overwrote a deliberate 10-second keyboard seek with 42 seconds.
- Pause before metadata overwrote stored progress of 42 seconds with zero.
- A failed checkpoint was treated as acknowledged, preventing the next pause
  from retrying the same position. A separate replay reached a real committed
  write, dropped its response, and showed the queued final pause never retried.
- Mismatched video/profile and malformed position responses were accepted.
- A transient first progress read did not recover on a later pause.

The two passing baseline controls were progress-before-metadata resume and
preserving current playback across same-account refocus. Additional unchanged-
baseline ACK replays showed that an outstanding A write blocked B's checkpoint
(no B row appeared), and a wrong-profile ACK prevented retry of the same value.
The delayed-ACK harness was refined to inspect B's independent row rather than
waiting on A's intentionally held response; that bounded replay reproduced the
failure and its final-source counterpart passed.

One additional test is explicitly a controlled **white-box coordinator regression**:
it obtains the mounted coordinator through the test's React-fiber inspection,
invokes non-flushed `retryNavigation`, and immediately dispatches media readiness
in the same JavaScript stack. The baseline applied old progress immediately.
This is not presented as a reproduced user-visible focus/visibility leak: those
provider lifecycle handlers already use `flushSync`. No production test hook or
window exposure was added.

## Behavior after the change

- Watch passes the verified account, exact profile, and identity revision to
  the player. The coordinator also exposes a narrow validity callback capturing
  its existing epoch/path, invalidated synchronously before a React commit.
- GET and PUT carry the expected account and explicit profile, use no-store,
  cancellation and a deadline, and validate bounded response bodies at runtime.
  A response must match the requested video/profile with valid progress/policy.
- Superseded or unverified runs cannot resume, start another checkpoint, publish
  an acknowledgment, invalidate a newer identity, or release a newer run's busy state.
- Confirmed account/profile changes start a separate media timeline. Same-account
  revalidation preserves current playback. Readiness and progress can arrive in
  either order; explicit seek intent takes precedence over delayed resume.
- Only a validated response updates the last acknowledged time/position and
  checkpoint analytics. Routine failed writes are throttled; an explicit later
  pause can retry. A final pause received during a write is coalesced, not dropped.
- A failed initial read retries only on the next explicit forced checkpoint,
  with one read in flight. Time updates never create an automatic retry loop,
  and no write starts before a trusted snapshot.

## Verification

- Production API and Web builds passed for baseline and fix. Web output retains
  two existing Edge-runtime warnings from `instrumentation.ts`.
- 20 focused Chromium production-browser cases passed, including real expected-
  account 409 rejection, distinct profile rows, delayed reads/ACKs, malformed
  snapshots/ACKs, lost responses, retry/coalescing and transient-read recovery.
- 14 existing production-browser cases passed across `player-hls`,
  `watch-viewer`, and `public-account-coordination` acceptance suites.
- 3 actual PostgreSQL watch-progress integration cases passed.
- All 663 Web unit tests and 512 API unit tests passed. Full Web lint, focused
  formatting and Web type checking passed.

The browser tests use real registration, shared cookies, server sessions, Watch
endpoints and PostgreSQL rows. Media readiness, current time and play/pause are a
controlled DOM harness, not evidence of decoded media playback. Existing HLS/IMA
preservation tests likewise use their documented controlled adapters. Real device
playback, provider delivery and native/PWA suspension certification remain external.

Raw build/test reports, failure traces and disposable PostgreSQL shutdown logs are
retained separately in `ayin-player-identity-evidence`, outside the source patch.
The sandbox runner binds Next to `0.0.0.0`, uses `127.0.0.1` as browser origin and
keeps PostgreSQL, servers and browser in one process environment. Installed pinned
Prisma/TypeScript/Next executables were used directly after the shell's pnpm wrapper
attempted an unavailable cache/install path. No dependencies or lockfile were changed.

An initial fix run passed 13 cases and stopped five on ambiguous unscoped media
locators caused by Next's hidden retained DOM. The harness was corrected to the
single visible player; application code did not change for the subsequent passing run.

## Explicit follow-on

`app/(viewer)/clips/clips-feed.tsx` has a separate local progress helper without
an expected-account header, explicit profile, or viewer-coordinator consumption.
The shared shell alone does not fence that helper. This source-only observation is
outside this Watch change; no Clips runtime reproduction or fix is claimed here.
