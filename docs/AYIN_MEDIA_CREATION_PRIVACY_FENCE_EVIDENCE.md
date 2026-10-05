# Media creation and the privacy cleanup snapshot

This is a separate follow-on to the existing-asset lock-order repair in `78e2981eb37b25e902150f1c3bb0d9e5b1601b93`. It fences source-session creation against the actual owner-account anonymization snapshot and provides the shared account helper consumed by the separate caption implementation. It does not certify every media producer or physical R2 cleanup.

## Executed failure

An actual AppModule/PostgreSQL diagnostic paused `PrivacyLifecycleService` at cleanup-job insertion, after the service had selected its cleanup asset set. A different OPERATIONS administrator's real content-seeding upload-session request committed a new source asset during that pause. After actual anonymization and the media cleanup batch, the request was ANONYMIZED with `mediaCleanupCompletedAt` set, while the new source remained PENDING, untombstoned and absent from cleanup jobs. The existing-asset deadlock correction alone did not protect this creation boundary. This source-session path is closed by the account fence below; other producers retain their separately stated acceptance boundaries.

## Account fence and authority

The shared helper observes the channel's current OWNER account IDs, then allows an acting account plus that server-derived owner set to be locked in canonical UUID order. Ordinary creator/caption transactions take Account SHARE locks; administrator source creation passes the additional server-derived IDs into the existing administrator authority helper's sorted Account acquisition. Its existing staff advisory lock, MFA credential lock, account/version, role, session, privileged MFA and step-up ordering/checks remain intact. No actor-first/owner-second lock sequence or generic deadlock retry is introduced.

After account locks are acquired, OWNER membership rows are locked and reread; a changed set is rejected rather than acquiring newly discovered accounts out of order. The existing privacy service already takes its owner Account FOR UPDATE before enumerating channels, videos and assets. Creation therefore either commits before that snapshot or waits for privacy and rejects the resulting removed scope. A channel retained by another owner remains usable after a fresh ownership observation. No additional privacy-service mutation is introduced by this follow-on.

Source creation checks current authority/scope before provider work and again at final insertion. Generic upload, Quick Upload, and admin content seeding now pass the actual authenticated actor. When a video is supplied by an internal caller, its channel/status/tombstone are checked under the existing generation advisory and video row lock before the channel check. Source insertion, video attachment/status, and seed-item state commit together through narrow database-only hooks. This removes the old unfenced attachment transaction.

Single-PUT presigning and multipart allocation run outside database transactions. The final creation transaction inserts metadata only after provider work and current authority/lifecycle revalidation. It returns no URL/token if that transaction fails. A newly allocated multipart session is then aborted outside all database locks. Caption adoption of the same helper remains a separate implementation/artifact and must be validated together before declaring that union ready.

The admin content-seeding creation controller now maps `MediaUploadError` to its intended HTTP status; otherwise the new stale-lifecycle denial was incorrectly exposed as 500 at that boundary.

## Validation

The first 18 new cases plus the unchanged upload/authority/timezone/privacy/processing regressions passed **160 actual PostgreSQL cases across 13 suites**. After adding explicit unavailable-abort and creator-owner-removal checks, the final creation suite passed **20/20**. These totals overlap; they are not 180 distinct cases.

Coverage includes both actor-before-owner and actor-after-owner UUID arrangements, actual privacy snapshot waits, single and multipart provider gaps, current role/session/account/version/step-up/MFA changes, channel/video tombstones, OWNER insertion/removal during account-lock waits, preservation of shared-owner channels, generic creator and Quick Upload provider gaps, failed seed commit rollback, and compensating-abort failure. Provider-gap tests obtain the real staff advisory and mutate the owner Account with a short lock timeout, proving those locks are not retained through provider I/O.

The final 20-case creation suite also passed with PostgreSQL server timezone Pacific/Honolulu. API source tests passed **99 files / 421 cases**; API typecheck, full API lint, production declaration build, repository-wide formatting and `git diff --check` passed. These are local results; no remote CI, Web build, merge, production provider check or deployment is claimed.

## Review follow-up: canonical UUID identity and legacy sessions

Independent HTTP review caught a compatibility regression in the first creation-fence revision: upper-case channel UUIDs were accepted by input validation and PostgreSQL ownership lookups, but the new Quick Upload scope comparison used the raw spelling against PostgreSQL's lower-case video channel ID and returned 409. The same single-upload case passed on the lock-order prerequisite.

Creation now canonicalizes channel UUIDs and internal optional video UUIDs before authority/scope comparisons, object-key construction and new V1 token construction. Existing tokens are still verified against their original signature and strict payload schema first. Only their verified account/channel/asset UUID identities are then canonicalized for comparison; case-sensitive object keys, multipart upload IDs, original token bytes and the V1 signing protocol remain unchanged.

Sixteen added cases cover upper/mixed-case generic, Quick Upload and admin seeding entrypoints in single/multipart modes, canonical metadata/keys, part authorization, resume, completion, legacy signed identities with exact case-sensitive provider keys/IDs, and rejection of genuinely different channels or key casing. Before correction, twelve failed and four passed; all sixteen and the prior twenty creation cases now pass. Independent replay additionally passed all six ownerless, creation-wins and UUID compatibility cases on the frozen source. Final repaired-source validation passed **178 PostgreSQL cases in 13 focused suites**, **421 API source cases in 99 files**, API types/lint/declaration build and repository-wide formatting/diff checks. Independent review also passed **95/95** creation/upload-authority/upload-privacy/privacy-controls cases under PostgreSQL Pacific/Honolulu, including all 36 creation cases; these counts overlap the focused suite.

## Producer inventory and explicit limits

This source slice changes source-session creation through `MediaUploadService`, `ContentSeedingService`, and `QuickUploadService`; the separate caption slice changes caption create/replacement through `CaptionService`. The following asset producers are inventoried but not privacy-certified by this slice:

- channel avatar/banner authorization in `creator/channel.service.ts`
- creator thumbnail authorization in `creator/quick-upload.service.ts`
- community images in `community/community.service.ts`
- canonical output upserts in `media/media-processing-lifecycle.service.ts`
- generated thumbnail upserts in `media/media-auto-thumbnail.service.ts`
- live-recording VOD handoff in `live/live-recording-worker.service.ts`

Content-seeding batch creation, general membership-management redesign, generic privacy reconciliation, account-wide cleanup scaling and already-issued presigned URL lifetime are also outside this bounded correction. Current production ownership creation is account provisioning; membership deletion is privacy cleanup. The helper revalidates observed OWNER rows, not an arbitrary future membership-writing protocol.

The controlled adapter proves attempted compensation, not physical R2 deletion. If R2 rejects the compensating abort, the original authority/lifecycle denial is preserved and no new source row or capability is returned, but the remote empty multipart allocation can remain. Existing abandoned-upload cleanup skips allocations with no MediaAsset row; durable reconciliation of that failure is not implemented or claimed here. No production account, provider configuration, privacy request, or object was changed during validation.

## Publication and independent review

Publication preserves the public discovery/detail and existing-asset prerequisites from PR245/PR244. The final repaired source was independently accepted after the reproduced UUID regression was corrected, including 95 PostgreSQL cases under Honolulu, six extra ownerless/creation-wins/UUID cases and earlier 133-case UTC shared-helper compatibility. Six older non-UTC expiry polling failures were reproduced unchanged on the prerequisite; those test-oracle failures are not attributed to this source change.

The OWNER-row recheck is not a general predicate lock for arbitrary future membership insertion. Current production ownership creation is part of atomic new-account provisioning, and no supported transfer/add-owner endpoint exists. Any future existing-channel OWNER mutation must join the locking protocol and add race tests before that new capability is accepted.

The exact publication union still requires its own complete quality/security/browser gates, fresh review checks, expected-head merge and deployed-SHA proof. Caption adoption and other producers remain separately tracked; no global privacy completion is implied.
