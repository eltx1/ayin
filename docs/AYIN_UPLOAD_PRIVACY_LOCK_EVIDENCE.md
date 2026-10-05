# Upload continuation and privacy media lock ordering

This focused maintenance change repairs two executed database deadlocks. It does not change upload-token authority, provider behavior, deletion eligibility, or the set of media selected for account anonymization.

## Reproduced failures

On main `78cbc45bb35a931b963800d9b9cbc4c2c8b57823`, a real OPERATIONS administrator continuing a content-seeding upload for a different channel owner could deadlock with that owner's actual `PrivacyLifecycleService.advanceDue` anonymization. Upload continuation held the Channel SHARE lock while waiting for MediaAsset; privacy held MediaAsset and later waited to update Channel. An observed Video lock wait made this interleaving deterministic. All four HTTP continuation routes (part authorization, resume, complete, and abort) returned 500 rather than the expected stale-state 409 before the change.

A separate multi-asset interleaving reproduced PostgreSQL `40P01`: privacy's unordered bulk MediaAsset update locked a physically earlier high UUID before a later low UUID, while a multi-asset editor locked rows in UUID order. A test-only trigger pauses the real privacy update at the high UUID; the application lifecycle is not mocked. The committed regression preserves this failure independently of the caption implementation. The corresponding exact real-caption active-plus-pending asset regression also returned HTTP 500 on the frozen caption implementation tree `f2214655bcded9836447eb07f101454b17af89b3`, then returned 409 with the privacy prerequisite applied.

## Narrow correction

Upload continuation retains the existing current administrator/session/MFA/step-up helper, the observed-source reread and scope checks, per-video generation advisory lock, source lock, and Video NO KEY UPDATE lock. The Channel SHARE lock and its status/tombstone check now follow source and video locking. Expiry and current authority are still checked after all lock waits. Source completion and processing enqueue still commit atomically. No database transaction spans R2 I/O.

Privacy locks the exact already-selected cleanup asset IDs in database UUID order before its existing bulk status/tombstone update. NO KEY UPDATE matches the non-key status mutation and permits unrelated foreign-key key-share readers. The asset selection predicates, cleanup jobs, account/ownership eligibility, video/channel removal ordering, and transaction atomicity remain unchanged. There is no generic deadlock retry and no new deletion scope.

The prerequisite adds one row-locking SELECT when the cleanup asset set is nonempty, returns one ID per selected asset, and requires ordered access or a sort. Large accounts therefore incur an additional linear-size query/result and possible sort within the existing transaction. Existing bulk updates already retain conflicting asset locks until commit; this acquires them explicitly in a deterministic order. The existing all-at-once cleanup memory/transaction scaling is not redesigned here.

## Validation

Final source passed **142 actual PostgreSQL cases in 12 focused suites**, including the 17 new overlap regressions, existing upload authority and helper-timezone cases, privacy export/lifecycle/shared-ownership checks, deletion request/cancellation authority, payout/privacy overlap, and creator upload/content seeding/media queue/generation coverage. The exact real-caption two-asset reproduction additionally passed on the isolated combined caption tree with the final privacy prerequisite.

API source tests passed **99 files / 421 cases**. API typecheck, full API lint, and the production declaration build passed. One concurrent final typecheck attempt was terminated with SIGKILL 137; the isolated retry with a 1536 MiB JavaScript heap cap passed, followed by lint and build. PostgreSQL was isolated, UTF-8/C.UTF-8, database `ayin_test`, and server timezone UTC; the existing authority suite separately exercises connection-local UTC, Africa/Cairo, and America/Los_Angeles.

Repository-wide formatting and `git diff --check` passed. These are local focused acceptance results, not remote CI, merge, Web build, or deployment certification.

The new integration suite covers real privacy-first overlaps on all four continuation routes; upload-first overlap while privacy waits on a different owner's multi-asset cleanup; privacy completion during multipart and single-object provider work; final channel-lock status/tombstone rereads; and reverse physical asset order. Every applicable case verifies preserved tombstones, cleanup-job registration, and absence of live processing jobs. Provider calls use the controlled adapter, not a real R2 account.

## Limits

Already-issued provider effects cannot be rolled back by a later database denial. The work proves database/API lock ordering and current lifecycle fences; it does not certify physical R2 cleanup, all unrelated editing subsystems, production deployment, or general account-deletion scalability. No production data, credentials, provider configuration, schema, browser persistence, or caption implementation is changed by this slice.

## Publication boundary and follow-on findings

This focused publication preserves accepted Kids classification source from PR243 and the already accepted dependency/R2 prerequisites. Its own full union CI and exact deployment remain required; the preceding local 142-case results are not substituted for them.

Creation-time lifecycle concurrency and complete provider cleanup remain separate acceptance boundaries. This maintenance change addresses existing-asset lock ordering only. The ongoing caption/creation-boundary integration requires its own regressions, source review and complete union gates before acceptance; no general account-deletion completion is claimed here.
