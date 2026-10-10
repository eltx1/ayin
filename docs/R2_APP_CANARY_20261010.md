# R2 application canary — published, cancellation settled, issuance closed

Final checkpoint: 2026-10-10 02:24 UTC. This section supersedes the historical checkpoints below.

[PR 277](https://github.com/eltx1/ayin/pull/277) merged to `8badd33265e09662c6727f7c8d454cf50f99719c`. [Production deployment 38015250853](https://github.com/eltx1/ayin/actions/runs/38015250853) succeeded and live inspection verified that exact release in both API and media worker. The fixes add guarded Studio publication for ready recoverable uploads and accept omitted empty R2 first-page marker echoes without weakening continuation validation.

Real authenticated browser actions: Finish upload, processed READY, Studio Publish with rights confirmation, Published/Public, one visible channel video, and successful playback to 6.016 seconds (ended=true, readyState=4, no media error). [Public video](https://ayin.stream/watch/ayin-resume-test-20261010-e6e209f7) and [Mr Lord channel](https://ayin.stream/c/mr-lord).

[Post-fix verification 38015517224](https://github.com/eltx1/ayin/actions/runs/38015517224) confirmed all three original cleanup obligations DONE, zero retained/uncertain/unaccounted debt, source absent, PUBLISHED status, canonical readback integrity, and thumbnail present. Channel quota counts 521,854 bytes once. The same CREATE/AUTHORIZE/RESUME/COMPLETE counts remain one each. Four read-only provider requests; no provider writes/deletions or database writes in this verifier. [One-time retry 38015441556](https://github.com/eltx1/ayin/actions/runs/38015441556) advanced only the original ALLOCATION due time after the parser fix; ordinary worker cleanup supplied the settlement evidence.

Validation completed: exact-dependency PR and main quality gates, security/source inventory, focused content-editor browser suite (7 passed, run 38014169092), and full V1 browser acceptance (run 38013142339: 642 passed and 3 skipped across the reported suites). Local 77 R2 observation tests, 15 related web tests, typecheck/lint/build also passed; local cached Next differed from the pinned version, so CI is the authoritative pinned build.

A separately journaled cancellation fixture used the same 478,196-byte synthetic bytes under `ayin-cancel-test-20261010.mp4`. Activation 38015758167 required the predecessor fully settled and respected the same source/envelope/debt limits. Browser Save draft and Continue upload reached 100%. [Closure 38015882823](https://github.com/eltx1/ayin/actions/runs/38015882823) verified issuance disabled again in API and worker, one active source, CREATE=1, AUTHORIZE=1, grant=1, COMPLETE=0, CANCEL=0, and zero UNKNOWN outcomes. Cancellation session fingerprint: `617d3eedbeaba057c4685e1c504871598c9e8899317585305c3d0927a108773b`. After the unchanged grant expired, Cancel upload was pressed through the real UI at approximately 02:23:45 UTC. The UI acknowledged cancellation. No cancellation cleanup obligation was manually rescheduled.

[Final cancellation verification 38016827050](https://github.com/eltx1/ayin/actions/runs/38016827050), tooling commit `14d4edaffc52bceec78c88d05a9165d94da0d76d`, succeeded on the deployed application SHA. It enforced the exact cancellation fingerprint, owner/channel and activation journal before three bounded GET/HEAD provider observations. It performed zero database writes or direct provider deletions.

| Final cancellation check                          | Result                                 |
| ------------------------------------------------- | -------------------------------------- |
| Session / revision                                | ABORTED / 3                            |
| CREATE / AUTHORIZE / CANCEL                       | 1 / 1 / 1                              |
| RESUME / COMPLETE / UNKNOWN                       | 0 / 0 / 0                              |
| Grant reservations / remaining validity           | 1 / 0 seconds                          |
| Source removed / grants revoked                   | true / true                            |
| Processing jobs / output bytes dispatched         | 0 / 0                                  |
| Cleanup obligations / outstanding                 | 3 / 0                                  |
| Valid finite cleanup evidence / retained rechecks | 3 / 3                                  |
| Source HEAD                                       | 404, absent                            |
| Exact allocation ListParts                        | 404 NoSuchUpload, absent               |
| Exact source-key multipart prefix                 | zero allocations                       |
| Active account/channel sessions                   | 0 / 0                                  |
| Retained/uncertain/unaccounted debt               | all zero                               |
| Account/channel retained exposure                 | 0 / 0 bytes                            |
| Channel live source quota                         | 521,854 bytes, original canonical only |
| New V2 issuance in API and worker                 | disabled, before and after             |

Remaining records are deliberate history: two upload sessions, two 32 MiB output-envelope records, immutable activation/retry journals, and finite cleanup evidence with scheduled rechecks. The canceled video's metadata still has UPLOADING status, while its source asset is removed; it has no processing job, output writes, live quota or active source debt. No broad metadata deletion was performed. The published original canonical and thumbnail remain available.

The browser acknowledgment says “Upload canceled. Cleanup is pending.” This is the existing provisional command message, not an authoritative settlement display. The subsequent runtime/provider verifier above established all three DONE obligations, absence and released accounting. The explicit saved-upload history read displayed only the published original video.

Evidence images: `ayin-published-video-proof-20261010.jpg` shows the original on Mr Lord's Videos page; `ayin-cancel-accepted-proof-20261010.jpg` records the UI cancellation acknowledgment. The earlier screenshot showing only the channel banner was superseded by the visible-video proof. Ten guarded operational tests passed in the final verification workflow. Supplemental broad quality gates triggered by the operations/report commit are not needed to infer application deployment or provider settlement; app PR/main gates and the scoped workflow are the completed evidence above.

Important changed application paths: `apps/web/src/components/studio/studio-video-editor.tsx`, `apps/web/src/lib/i18n/resources/content-editor.ts`, `tests/e2e/content-editor.acceptance.spec.ts`, `apps/api/src/media/r2-media-storage.adapter.ts`, and `apps/api/src/media/r2-upload-observations.test.ts`. Operational changes remain isolated under `.github/scripts/r2-app-canary/` and the dated canary/regression workflows.

No further configuration is required for this closed canary. The exact owner tuple and positive bounds remain for safe draining, with `AYIN_UPLOAD_RECOVERY_V2_ENABLED=0`. Do not replay enable/resume/cancel_enable/retry_cleanup or remove their exclusive journals. Read-only cancellation verification is the final workflow mode.

This completes the available browser upload/reload/finish/processing/publication/cancellation cycle. Real network-loss and multiple-part recovery remain acceptance gaps in Task 06; no unsupported result is claimed. The next roadmap task is Task 07 (Quick Upload and one-click publishing); no additional roadmap scope was started.

Original journals, cancellation journal and cleanup-retry journal remain immutable. No provider acceptance fixture commands, Cloudflare settings/permissions, signed-link/protection behavior or Horus changes occurred. No real offline outage, interrupted PUT, multiple-part or byte-offset resume has been proven; the demonstrated recovery is reload/reselect of one completed part.

---

## Historical checkpoint before deployment

# R2 application canary — processing verified; two fixes in CI

Current checkpoint: 2026-10-10 UTC. Following the user's explicit approval of source cleanup, Finish upload completed through the real UI and the worker produced a ready draft. New V2 issuance remains disabled. The original release is still `ab8355f3c45e5208ef9fe6477666b8f834c231b4`.

## Verified application and provider results

- Same session fingerprint: `d88f09decfb9c8be70902626236a92dec4578ee52d6b778f85b6ca2ab59868fc`.
- One CREATE, AUTHORIZE, RESUME and COMPLETE; zero UNKNOWN outcomes; one session, one processing job, one output reservation and one output attempt.
- Source size 478,196 bytes. Its independent AYIN chunk-root `cb4c9d221282c056fe9ad2ff587bba9d884461e202e8c34cb11bd766e73c3ab1` matches the retained processing-job proof.
- The source-session digest is intentionally retired by source cleanup registration. Initial audit run 38012439051 blocked on an incorrect comparison to that retired digest and made zero provider requests; corrected readback run 38012667861 succeeded.
- Canonical output: 521,854 bytes, independently read back with matching stored integrity digest and length. SHA256: `757b9f09ff9d1184d3a900bd94e4dedf2f1f78b015f24c6801c8c4f3fbce3569`.
- Thumbnail: 19,136 bytes and present. Exact source HEAD returned 404. Channel quota counts the canonical SOURCE_VIDEO once: 521,854 bytes.
- Two cleanup jobs DONE; one ALLOCATION PENDING after five INVALID_RESPONSE observations and a six-hour retry delay. No cleanup evidence was discarded or manually marked settled.

[Readback 38012667861](https://github.com/eltx1/ayin/actions/runs/38012667861): four GET/HEAD requests, zero database writes/deletions. [Cleanup inspection 38012949948](https://github.com/eltx1/ayin/actions/runs/38012949948): zero provider requests/writes/deletions.

## Proven defects and pending correction

[PR 277](https://github.com/eltx1/ayin/pull/277), head `295c9bb4fc92f1a5df7be7435d3fa4e306549129`, fixes two actual blockers:

1. Studio lacked Publish for the processed recoverable-upload draft. The patch uses existing processing/publish APIs, readiness and saved-details guards, rights confirmation, pending latching and uncertain-result protection; English and Arabic labels are included.
2. R2 omitted empty KeyMarker and UploadIdMarker echoes from a valid empty initial multipart listing. The adapter required them and rejected it. [One-request observation 38013033007](https://github.com/eltx1/ayin/actions/runs/38013033007) confirmed HTTP 200, correct bucket/prefix/encoding, MaxUploads=1000, IsTruncated=false, zero Upload rows and absent empty markers. No provider XML or sensitive identifiers were logged. The patch only allows omitted empty initial markers; subsequent pages still require exact paired echoes.

Local validation: 77 R2 observation tests (five new cases), 15 relevant web tests, targeted lint/format checks, web typecheck and production build with cached dependencies. Pinned-dependency CI and two new browser journeys are pending. No corrective application version is yet verified live.

The original activation/continuation journals remain intact. Local guarded tooling for a one-shot exact ALLOCATION retry and a later single cancellation fixture is prepared but not executed. Retry only advances the existing obligation's due time; it does not alter cleanup status/evidence or directly delete objects. Cancellation activation requires the completed predecessor's three cleanup obligations to be DONE.

Still pending: deploy and live publication, channel appearance, normal cleanup settlement/debt release, separate cancellation with concrete cleanup confirmation. Actual offline interruption, interrupted PUT, multiple-part and byte-offset recovery remain unproven. Prior browser reload/reselection evidence is limited to a single uploaded part.

## Earlier checkpoints (historical)

# Authenticated R2 application canary: upload and reload recovery observed

Latest checkpoint: 2026-10-10 UTC. This is partial live application acceptance; completion, processing and cleanup remain pending explicit owned-source deletion approval.

## Latest continuation result

Production and main remained `ab8355f3c45e5208ef9fe6477666b8f834c231b4`. No application code was changed and no application release was deployed.

- [Read-only runtime inspection 38007377942](https://github.com/eltx1/ayin/actions/runs/38007377942) verified the exact owner tuple, current release, health and closed issuance.
- [Bounded continuation 38007498234](https://github.com/eltx1/ayin/actions/runs/38007498234), tooling commit `23e8ef1e525f1bd2ad0d708a9327c8c6f71ae68f`, verified the prior closed environment and unchanged backup/journal, zero V2/channel sessions, zero output reservations, zero active processing and zero retained/unknown debt before opening the same approved scope.
- The new exclusive host journal is `/home/ayin/env/r2-app-canary-20261010.resume-1.json`. The original journal and backup were preserved. Resume refuses replay, changed ownership/bounds/fixture/backup, an open predecessor, or unresolved work. Do not rerun enable or resume.
- Browser navigation and the ordinary existing signed-in Mr Lord session worked. The exact synthetic fixture was selected through **Choose original video**, followed by **Save draft** and **Continue upload** in Recoverable uploads.
- The live application reached **100%**, **Parts received: 1 / 1**, and **Your upload is ready to finish**. This is an R2 multipart part observation through the application's real inspection path, not a completed source object.
- The Stop attempt lost its target because this small transfer had already finished. It did not prove an interrupted request.
- The page was reloaded; **Check saved upload** restored 100% without a selected file. The original fixture was reselected, and **Continue upload** verified it and returned to ready-to-finish.
- The available browser API has no documented offline/fault-injection control. Actual network disconnection, stopping an in-flight PUT, multiple-part recovery and byte-offset recovery were not established.
- [Pre-reload accounting 38008213392](https://github.com/eltx1/ayin/actions/runs/38008213392) and [verified closure 38008331587](https://github.com/eltx1/ayin/actions/runs/38008331587) independently observed the same source session with the following counters.

| Measurement                               | Before reload | After reload/reselect/resume |
| ----------------------------------------- | ------------: | ---------------------------: |
| V2/channel sessions                       |         1 / 1 |                        1 / 1 |
| CREATE operations                         |             1 |                            1 |
| AUTHORIZE operations / grant reservations |         1 / 1 |                        1 / 1 |
| RESUME operations                         |             0 |                            1 |
| COMPLETE operations                       |             0 |                            0 |
| UNKNOWN provider outcomes                 |             0 |                            0 |
| Source declared / quota-counted bytes     |       478,196 |                      478,196 |
| Output envelope reservations              |             1 |                            1 |
| Output envelope bytes                     |    33,554,432 |                   33,554,432 |
| Conservative source exposure bytes        | 5,368,709,120 |                5,368,709,120 |
| Processing / cleanup jobs for fixture     |         0 / 0 |                        0 / 0 |

Session fingerprint (SHA256 of internal session ID):
`d88f09decfb9c8be70902626236a92dec4578ee52d6b778f85b6ca2ab59868fc`.
No raw provider upload ID, object key, grant or credential is published.

The unchanged single grant and CREATE counters, same session fingerprint and observed complete part inventory support recovery without issuing a second upload authorization or creating another source. Browser network-level PUT counts were not independently recorded.

The 5 GiB source exposure and 32 MiB output envelope are conservative accounting reservations, not physical storage measurements or billing. One 478,196-byte part was observed through the application's provider inspection. No completed source object or output has yet been verified. Channel quota remains 107,374,182,400 bytes, with 478,196 bytes counted once.

## Final closed state and pending approval

[Closure commit 45f79332b85827afc906fecc2a2311d2320f4c01](https://github.com/eltx1/ayin/commit/45f79332b85827afc906fecc2a2311d2320f4c01) restores workflow mode `disable`. The run verified new issuance false in both API and media worker with health passing and the application release unchanged. The exact tuple and positive bounds remain for safe draining. The session remains OPEN; its part and both conservative reservations remain. No cleanup was requested.

The named fixture is `ayin-resume-test-20261010.mp4`, 478,196 bytes,
SHA256 `184bb9e5d9ad3218af8c4f4552558c24c506d166c293dbbc83becd810e4db98c`.

**Finish upload and Cancel upload have not been pressed.** Finishing permits required-integrity processing, whose successful lifecycle calls `registerProcessingSourceCleanup`. Obtain explicit confirmation to permanently clean this specific temporary source after successful processing, while retaining the resulting playable video and thumbnail. This is not permission to delete other media or to cancel an additional future fixture.

Remaining: provider COMPLETE and completed-source identity, integrity/processing, normal channel appearance, output/accounting verification, cancellation and settled cleanup. Actual network-loss acceptance remains unproven. No application defect was established in the exercised stages.

Operational tooling only was changed: guarded continuation and sanitized read-only accounting. Seven local tests passed, and the same seven passed in each new runtime workflow. Syntax and formatting/diff checks passed. No broad application unit-test rerun is claimed for this continuation. No provider acceptance fixture was rerun, no Cloudflare/permission/signing/video-protection change was made, and Horus was untouched.

A browser screenshot of the restored 100% / 1-of-1 state is saved as `ayin-r2-recovery-proof-20261010.jpg` in the conversation deliverables.

---

# Earlier attempt: blocked before file selection

Checkpoint: 2026-10-09 UTC (2026-10-10 in Cairo). This is not an end-to-end upload acceptance result.

## Application and approval scope

The current main and running production release were independently checked as
`ab8355f3c45e5208ef9fe6477666b8f834c231b4`. No application release was deployed in
this attempt. The preceding production deployment was run `37875713923`.

The user approved temporary new V2 issuance for the exact owner account and
channel `@mr-lord` only. The application owner relationship and the normalized
email digest were verified on the production host without publishing account
identifiers, credentials, or storage keys. Permanent test-data deletion has not
been approved.

Approved limits:

| Setting                                 |                                    Value |
| --------------------------------------- | ---------------------------------------: |
| Source maximum                          |                          1,048,576 bytes |
| Lifetime processing output envelope     |                         33,554,432 bytes |
| Conservative account debt budget        |                      5,402,263,552 bytes |
| Conservative channel debt budget        |                      5,402,263,552 bytes |
| Existing multipart part size, unchanged |                         16,777,216 bytes |
| Outstanding unretired V2 sources        | 1, enforced by existing application code |

Debt budgets reserve conservative exposure; they are not measured physical
storage or billing. This source ceiling allows only a single-part application
fixture, so it cannot establish recovery across multiple multipart parts.

## Configuration actually applied and closed

[Activation run 38005499539](https://github.com/eltx1/ayin/actions/runs/38005499539)
used operational tooling commit `0cdb8408fc385eba52cb37f8f07e580010282e2f`.
It verified the exact owner, an available canary slot, idle processing, quota and
debt capacity, then changed only the seven approved application canary settings.
The existing AYIN API and media processor restarted and passed readiness and
live-environment checks. Baseline channel live source usage was 0 bytes against
the configured 107,374,182,400-byte quota. Both running services matched the
approved scope; new issuance changed from false to true.

[Closure run 38005621807](https://github.com/eltx1/ayin/actions/runs/38005621807)
used operational tooling commit `ec17e62623afd35ee8cf78b64ec7d0a6e41db98a`.
It verified that new issuance changed from true to false in both running
services, with readiness passing and the release unchanged. Positive bounds
and the exact tuple were retained for safe draining; they do not enable new
issuance while `AYIN_UPLOAD_RECOVERY_V2_ENABLED=0`.

Both configuration operations reported zero provider requests, zero database
writes, and zero data deletions. No Cloudflare settings, permissions, Workers,
video-protection or signed-link behavior, or Horus configuration were changed.
The previous provider acceptance commands were not run.

## What was actually observed in the browser

- Normal secure sign-in had succeeded and the page identified Mr Lord.
- The authenticated `/upload` recovery panel initially reported recovery
  unavailable.
- After scoped activation, `Check saved upload` displayed “Choose a video to
  prepare a recoverable upload” and “Choose original video”.
- The first file-chooser attempt failed before the command with the browser
  runtime error `retained_data_restricted`, referring to retained state after
  native credential delivery. The browser then refused a new tab with “native
  credential state cannot be safely resumed”. Resetting the browser tool and
  opening a new tab did not resolve it.
- No file selection, Save draft, Continue upload, Finish upload, or Cancel
  upload action completed. No upload was initiated by this attempt. No fresh
  screenshot could be obtained after the browser runtime became unavailable.

The synthetic local fixture remains available for a later authorized attempt:
`ayin-resume-test-20261010.mp4`, 478,196 bytes, 6 seconds, 640x360, H.264/AAC.
SHA256: `184bb9e5d9ad3218af8c4f4552558c24c506d166c293dbbc83becd810e4db98c`.
It contains generated test patterns and a generated tone, not user media.

## Code and validation boundaries

Application upload code was reviewed but not modified: this attempt established
no application defect. The branch adds isolated configuration tooling and its
four passing environment-edit tests. The current-code review also ran 40 API
and 110 web unit tests successfully. These are local/unit results, not live
upload, processing, provider completion, or cleanup evidence.

The existing UI separates Continue upload from Finish upload. Code inspection
shows that finishing and processing a V2 source eventually requests irreversible
staging-source cleanup; cancellation also requests cleanup. Stop before those
actions until the user confirms the concrete owned test-data cleanup scope.

## Remaining work

1. Recover a functioning browser runtime and recheck the current release,
   runtime scope, account/channel and resource baseline. Do not remove the
   activation journal or rerun enable blindly: its exclusive journal is a
   deliberate replay barrier, and closure has already succeeded.
2. Perform the application upload with the small synthetic fixture. The browser
   API available in this attempt exposed no offline/network-fault injection
   control. Reload or Stop alone must not be described as a demonstrated loss
   of network connectivity.
3. Obtain concrete deletion confirmation before completion/processing or
   cancellation triggers permanent source/part cleanup. The current activation
   approval is not deletion approval.
4. Establish actual R2 completion, integrity and processing readiness, channel
   appearance, absence of duplicate objects/quota charges, cancellation and
   settled orphan cleanup. All these stages remain untested through the app.

Final state of this attempt: new V2 issuance disabled, application version
unchanged, authenticated application acceptance incomplete.
