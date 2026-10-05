# Creator caption recovery and localization

Scope: bounded caption UI/transport work on `c8234f8897d029860ab4d7e6f82c202ed4b1d8eb`. This evidence does not certify the entire Studio, the parallel caption-service lifecycle changes, production R2, or a deployment.

## Reproduced before changing the transport

Three regression tests failed on the original source: an object in place of the caption list was accepted; a finalize acknowledgement naming a different track was accepted; and `{ removed: false }` was accepted as successful removal. The original UI also combined a committed mutation and its follow-up GET under one catch, permitted immediate replay after lost acknowledgements, and hid the replacement input with `display: none`.

## Implemented

- Route-local English/Arabic caption copy, one simple track list and an explicitly opened add/replace form. Optional name/type/default controls are disclosed separately. Replacement selects a file without starting a write; the actual native file input remains focusable. Removal uses the existing confirmation dialog.
- Caption-specific transport with bounded decoded responses and exact track/value acknowledgements. Existing exports remain available through `lib/studio.ts`; routes and payloads are unchanged. API operations use the existing expected-account transport. The direct storage PUT sends the actual file with no cookies, and finalization still validates server-side WebVTT.
- Confirmed commits remain saved when refresh fails. Unconfirmed prepare, PUT, finalize, update or remove stops further mutation; the original target and file stay in memory. An explicit fresh read and a separate review action are required before another deliberate action. Lost create acknowledgement reconciles the existing language/kind track, so recovery cannot silently create another upload.
- Background/account loss synchronously conceals caption data and native inputs. Once caption account scope is established, its selected parent editor's private heading/details also conceal. Native fields are scrubbed synchronously and their private subtrees are removed from the closed render, so React cannot refill hidden or detached nodes. Same-account verification recreates the controlled fields from the retained draft. A retained File is identified in text after recovery, while its cleared native input remains empty. No File is persisted or automatically uploaded.
- Parent busy/draft coordination remains. A synchronous recovery guard blocks closing, navigation replay and editor mutation until required review is complete. `useRemoteResource.reload()` already clears its snapshot synchronously; this change does not claim a whole-Studio account-scope redesign.

## Validation

- Web unit suite: 581 tests across 95 files passed, including 16 focused caption tests and 27 account-scope transport tests.
- Web lint, focused fixture/config lint, TypeScript, package builds, API build and Web production build passed. The Web build reports the pre-existing Edge `process.stderr` instrumentation warnings.
- Eighteen Playwright journeys passed against real Nest controllers/authentication, local PostgreSQL 17 (UTF-8, C.UTF-8, UTC), and a separate test-only HTTP byte store. The browser performed actual PUT requests; finalization independently observed HTTP HEAD metadata and GET bytes. No production provider was called.
- Journeys cover EN/AR at 390 and 1440 pixels, native keyboard replacement, retained draft across tabs, removal Cancel/Escape, exact lost-finalize and lost-prepare acknowledgements after actual commits, lost PUT acknowledgement after actual byte receipt, duplicate clicks, acknowledged PATCH followed by failed GET, malformed list, account replacement, original-account recovery, and synchronous pagehide concealment/native-value clearing. Four additional privacy regressions cover a validated PATCH followed by failed identity transport, a validated PATCH followed by an actual account switch, validated finalization followed by failed identity transport, and retained native nodes across React frames and after recovery. Eight further stage regressions cover failed verification before preparation, after preparation, before direct PUT, after direct PUT for new and replacement uploads, after replacement preparation, after a list response, and after removal. Frozen parent Back remains disabled.
- All four full-page EN/AR width originals plus recovery/account-concealment originals were visually inspected. No document overflow, clipped text or hidden replacement input was observed.

The initial HTTP-provider run correctly failed because the local provider origin was not in the existing CSP. The test build was corrected to use the explicit local media origin; CSP was not bypassed. Two intermediate assertions were also corrected to reflect non-optimistic checkbox state and intentionally hidden controls.

## Privacy review corrections

Independent review of the first candidate reproduced two gaps: a validated write followed by a generic identity-read failure left private content visible, and a later React commit refilled native fields that had been synchronously scrubbed. The final candidate conceals after every acknowledged-write identity failure, including finalization; generic saved feedback remains visible outside the private subtree. Failed follow-up reads also conceal rather than expose stale private data. Closed private form subtrees unmount after scrubbing, keeping their original drafts only in component state. Retained-node tests verify blank value/defaultValue/attributes synchronously, after two animation frames, and after detached-node recovery; restored same-account fields contain the intended original draft. The new network and mismatch regressions failed against the first candidate before the fix.

A second independent review reproduced the same privacy gap after a successful direct PUT: verification was a GET, so its failure had `acknowledged=false` even though identity was unverified. A focused replacement-PUT browser test reproduced that leak on the prior compiled candidate. The account transport now classifies failed identity verification explicitly as `identityUnverified`, independently of request method and write acknowledgment. Classification covers every pre/post actor check and the explicit `/auth/me` request itself, including transport, HTTP and decoding failures. Ordinary operation-response uncertainty remains distinct.

The caption transport separately records PREPARED and UPLOADED intermediate outcomes. A validated prepare may retain its track ID in memory when the trailing identity check fails, but never its signed URL in an error. A successful direct PUT followed by failed identity verification is uploaded-but-unfinalized; it is never a saved or READY caption. The UI conceals on the explicit identity flag and retains only a generic, stage-accurate notice. There is no automatic next stage or replay.

### Verification-stage audit

| Site                                                        | Failure handling                               | Outcome retained                  |
| ----------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| List/read pre/post identity                                 | Conceal; explicit original-account read/review | No accepted private snapshot      |
| Create/replacement prepare preflight                        | Conceal; no prepare request                    | No new upload claimed             |
| Validated prepare trailing identity                         | Conceal; no direct PUT                         | PREPARED plus validated target ID |
| Direct PUT pre-verification                                 | Conceal; no file sent                          | PREPARED                          |
| Direct PUT post-verification                                | Conceal; no finalize request                   | UPLOADED, not finalized           |
| Finalize preflight after successful PUT                     | Conceal; no finalize request                   | UPLOADED, not finalized           |
| PATCH/finalize/remove trailing identity after validated ACK | Conceal; generic saved feedback                | Confirmed final commit only       |

The final browser matrix verifies preserved track IDs, zero automatic stage advancement, unchanged creation/PUT/finalize counts after recovery, and absence of a false saved notice for intermediate outcomes. The previous ACK and retained-native-node controls remain in the same run.

Readiness now probes the actual Nest health endpoint. The HTTP byte store is already bound before Nest can become healthy. The final eighteen-test run uses fresh config-owned server processes and a disposable, uniquely named local PostgreSQL data directory.

## Reproduce the dedicated browser suite

The dedicated suite avoids treating the default E2E adapter's hardcoded caption object as real uploaded-byte evidence. It is separate from the ordinary `tests/e2e` suite, which still tests its documented simulated adapter.

Use a disposable local `ayin_e2e` PostgreSQL database and the repository's pinned toolchain. Set `APP_ENV=test`, `DATABASE_URL` and `TEST_DATABASE_URL` to that same local database; set the ordinary test auth/upload/payout configuration. Then run:

```sh
pnpm packages:build
pnpm db:migrate:deploy
pnpm --filter @ayin/api build
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001 NEXT_PUBLIC_MEDIA_BASE_URL=http://127.0.0.1:3002 pnpm --filter @ayin/web build
pnpm test:e2e:captions
```

The config launches the test-only Nest/storage fixture and Next bound to `0.0.0.0`. Storage uses transient memory exclusively and is never loaded by the production API. The fixture refuses a non-local/non-test database. Test account resets are limited to that disposable database. The browser workflow owns a separate ten-minute-bounded step for these eighteen journeys, after the ordinary and PWA suites. Its local-media-origin build is isolated to that step. Caption PNG originals, failure traces and its HTML report are preserved as a separate artifact; unrelated evidence globs are unchanged. Playwright owns fresh server processes with bounded SIGTERM shutdown and a three-minute suite deadline. Ordinary/PWA totals do not include these eighteen.

Remaining integration gate: combine with the caption-service authority/race patch and run exact combined-source quality and browser gates before review/merge/deployment. Real R2, installed PWA, physical-device and broader Studio identity/navigation acceptance remain outside this evidence.

## Exact combined-source validation on PR246

On 2026-10-05 the independently accepted caption authority and recovery UI patches were combined on PR246 source `f1ea72a08fec4fc8e724579dad6a0966e95647f1`, then the separately reviewed credentialed-CORS navigation fixture correction was applied. Reconstructing just that prerequisite produced tree `4f5cf655df02eb2d09e1a3ab1df2af6ed6126b08`, exactly matching updated PR246 parent `d28642288bf141274cd6e363dddd7e7e12cdb37a`. The caption publication patch excludes that already-upstream fixture correction.

The owner-account helper, source-upload service and ordered privacy lifecycle retain the exact prerequisite SHA256 identities recorded in the [caption authority evidence](AYIN_CAPTION_LIFECYCLE_AUTHORITY_EVIDENCE.md). No source-creation helper change or additional application correction was needed to integrate the accepted caption implementations. Existing public, Kids and other workflow evidence blocks are preserved; the caption artifact block is additive.

Executed against the actual combined application source:

- Pinned Node.js 24.19.0 and pnpm 11.24.0; frozen offline dependency installation and Prisma generation passed.
- API source units: **498 cases in 101 files**, all passed.
- Full source-only API gate against clean PostgreSQL 17, UTF-8/C.UTF-8, UTC: **1,267 cases in 183 files**, all passed in 419.85 seconds. This gate includes the 498 source-unit cases; the counts are not additive. Generated `apps/api/dist` tests were explicitly excluded.
- Database bootstrap integration: **four cases**, all passed; all committed migrations applied to disposable local databases.
- Full Web source units: **621 cases in 101 files**, all passed.
- Root typecheck, recursive lint, repository-wide formatting, focused caption/config/fixture lint, strict caption browser/config TypeScript, API declaration build and diff checks passed.
- Production Web builds passed with the ordinary media origin and, separately, the explicit HTTP caption-provider origin. The pre-existing Edge-runtime stdout/stderr instrumentation warnings remain.
- **56 existing browser cases in 13 files** passed across fresh server groups: nine content/account-scope, fifteen account-workspace/session/finance, nine privacy, fifteen public account/detail/hero lifecycle, and eight navigation/channel/playlist-policy cases.
- **18 dedicated caption browser cases** passed separately in **41.2 seconds**, using fresh config-owned Nest/Next processes, disposable PostgreSQL, and actual HTTP PUT/HEAD/GET bytes. These are the full eighteen journeys described above, now exercising the integrated authority service rather than the older backend.
- All **nine caption PNG originals** were individually inspected: EN/AR at 390/1440, lost-ack review, account concealment, acknowledged-write network/account failures, and post-PUT identity failure. Controls, recovery text and native replacement input are visible and unclipped; closed views disclose no private video title, track label or filename. Two existing content-editor EN/AR originals were also inspected.

Two local runner errors are retained separately from passing acceptance. An initial Web unit command inherited the browser API origin and failed the unchanged localhost-only upload-URL fixture; the clean quality environment passed without a source change. The first ordinary browser startup encountered unavailable network-interface enumeration before any journey ran and was stopped. An untracked local config supplied the documented explicit `0.0.0.0` Next bind; tracked ordinary CI configuration and production code were unchanged. The dedicated caption config already specifies that bind.

This establishes the requested local union gates, not the entire ordinary/PWA suite or production acceptance. Owning remote quality/security/browser checks, final review, expected-head merge and exact deployed-SHA proof remain the publication task's responsibility. Real R2, installed PWA, physical-device coverage, and a complete Studio-wide identity redesign remain outside this evidence.
