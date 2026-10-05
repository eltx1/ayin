# Creator caption lifecycle and current-authority evidence

## Scope and reproduced defects

This bounded Phase 6/14 repair began on accepted source `c8234f8897d029860ab4d7e6f82c202ed4b1d8eb`. Its owner-account-fenced integration is based on corrected creation prerequisite `719cd9a7a6d2ae095d7a671d5a14d7d6acc3eb6b`, in a separate worktree that preserves the earlier frozen caption tree `9a6bb33c27f9712182ea058e29c41742fb54cc24`. It changes only caption management, not the shared R2 adapter, upload bodies, playback policy, or creator role scope.

Before implementation, 34 real PostgreSQL/Nest regressions failed while the three existing captions/chapters integration cases passed. The failures established:

- An older finalize could resurrect a removed pending asset, replace a newer upload, erase newer default/enabled state, or run after a concurrent removal.
- Transient HEAD/read failures rejected and deleted recoverable pending uploads. The same broad catch included database and lifecycle failures.
- An older delayed replacement authorization could overwrite a newer pending replacement.
- Create, replace, and finalize could commit after account suspension, auth-version change, session revocation/expiry, loss of channel membership, or channel/video removal during provider I/O.

A subsequent regression independently exposed a validated-but-tombstoned asset being listed as `READY`. Another test using the real privacy lifecycle service proved that taking Channel before MediaAsset deadlocks when a different channel editor overlaps the owner's anonymization. PostgreSQL reported the caption asset lock waiting on the privacy transaction while privacy waited to update Channel. The final order below corrects that inversion.

Independent review then established a cross-track default-intent race: after A began a default replacement, explicitly selecting B still allowed A to become default again when its delayed validation finished. Four PostgreSQL cases reproduced this across PATCH/finalize selection and replacement/pending-only older candidates; two unrelated-edit negative controls passed. The final caption correction clears both active and pending default intent on competing tracks only when an explicit default selection commits.

Independent review also proved a multi-asset ordering dependency: the privacy bulk update could lock an older high-ID active asset before a newer low-ID pending asset, opposite the caption order. Publication must inherit the separately reviewed exact-set, UUID-ordered privacy asset prelock. The caption patch itself does not modify privacy or add generic transaction retries.

## Owner-account snapshot fence

A further actual privacy-worker test paused `PrivacyMediaDeletionJob` insertion after the owner’s media snapshot. A different editor could still commit caption CREATE or REPLACE and receive an upload URL that escaped that snapshot. All four cases, covering both actor/owner UUID orders, returned 201 before the fence; the new regression requires a 409, no returned capability, no new asset, exact cleanup-job coverage, and successful real cleanup processing.

The caption wrapper now consumes the shared owner-account helper unchanged. Before any Account lock it observes the video’s channel and server-derived current OWNER account IDs, locks the canonical sorted union of those IDs and the acting account, and revalidates the owner membership set. This serializes both sides of every provider gap with owner anonymization’s existing Account lock. A shared channel remains available when another owner remains. Lost actor membership retains the caption 403 contract; independent owner-set drift returns a typed 409. There is no automatic write replay or generic transaction retry.

Validated route UUIDs are canonicalized to lowercase at the controller boundary. Actual upper/mixed-case video and track routes are tested through create, finalize, patch, replacement, list and removal, with one canonical R2 namespace.

Prerequisite source identities, unchanged by this caption slice:

- Shared owner fence SHA256: `4ff394b1523423b3607e10c6c76f8f24c4c792a0273abfeca05a8236a667060f`
- Ordered privacy lifecycle SHA256: `99f759c31687a9865b50472451f24e4c662ec601dad05c04dd5a71605a4a464d`
- Corrected source-upload service SHA256: `d8518bc04377c800dbbbb5663d9413a584fc2d4a82e0414ccddd170897219409`

## Implementation

Every caption route receives the authenticated account, auth version, and session identity. Short database transactions validate the current ACTIVE account/version, unrevoked session/version/expiry, OWNER/ADMIN/EDITOR membership, video channel identity, and video/channel removal state.

The lock order is:

1. Observe the video channel and current OWNER account IDs without holding row locks
2. Acting Account and all observed OWNER Accounts, together in canonical UUID order
3. AccountSession and current actor checks
4. Current OWNER memberships and acting ChannelMember
5. Existing per-video media-generation advisory lock
6. Referenced caption MediaAssets in stable ID order
7. Video, using `FOR NO KEY UPDATE`
8. Channel

The asset → video → channel sequence matches privacy anonymization even when the deleted owner and acting editor differ. Account/session/member share locks preserve authority until the transition commits. Owner Account locks additionally prevent insertion after a concurrent privacy cleanup snapshot. The video's channel is revalidated after waiting. Session expiry is checked again after every lock wait using PostgreSQL's wall clock explicitly converted to UTC, matching Prisma's UTC-naive timestamp storage.

No R2 authorization, HEAD, read, or delete is performed inside a database transaction. Create/replacement authorization is followed by a fresh authority/state transaction before the capability is returned or metadata is changed. Finalize checks current pending identity before HEAD, again before read, and at commit. It validates bytes against the current video duration. Concurrent replacements/finalizers return a domain conflict rather than modifying another operation's asset.

Only a current upload with confirmed invalid metadata or invalid WebVTT bytes is rejected. Transient/ambiguous provider failures, truncated reads, lost authority, stale lifecycle state, and database aborts preserve recoverable pending state. Object cleanup runs only after a committed retirement/rejection; a losing finalizer never deletes a successful winner's object. Current default/enabled choices are read inside the final transaction; a later explicit disable/default change also replaces pending default intent. An explicit PATCH default selection or a successful pending-default finalize clears both `isDefault` and `pendingMakeDefault` on competing ready and pending-only tracks. A label or enabled-only patch of the current default is not a new selection and does not cancel another track's pending intent. Per-video serialization preserves unique identity and single-default behavior.

Routes and successful response shapes remain unchanged. `CAPTION_UPLOAD_STATE_CHANGED` is a 409 conflict; provider retry failure uses `CAPTION_STORAGE_UNAVAILABLE` with 503. Removed channels return 409. Current invalid account/session authority uses existing 401 behavior; lost editor membership uses 403. Channel ADMIN and EDITOR remain ordinary creator roles and need no administrator MFA or step-up.

## Validation

Latest owner-account-fenced candidate:

- Full combined API gate: 1,114 cases across 179 files passed on clean PostgreSQL 17 with all 57 migrations. Build-output tests were explicitly excluded.
- The final focused caption set contains 118 cases, including 18 new owner-fence/UUID cases and all earlier lifecycle/default controls. All passed in the full UTC gate and in an independent clean-database Pacific/Honolulu replay.
- Actual post-snapshot CREATE/REPLACE denial, presign/HEAD/read privacy winners, exact asset-to-cleanup-job coverage, real cleanup processing, both actor/owner UUID orders, shared-owner continued creation, and ownership-drift rejection are covered.
- Registration fixtures use distinct reserved test-client IPs; the real per-IP rate limiter remains enabled.
- Final API typecheck, lint, production build, 421 source tests, repository-wide formatting, and diff checks passed. The 1,114-case combined gate includes the 421 source cases; these counts are not additive.

Earlier bounded checkpoints:

- Clean PostgreSQL 17 database, UTF-8/C.UTF-8 locale; all committed migrations applied.
- The initial caption candidate passed 90 new integration cases plus the three existing captions/chapters cases under both UTC and Pacific/Honolulu. After default-intent correction, all 99 cases (the original 93 plus four regression cases and two negative controls) passed on the unchanged base.
- The combined integration copy adds the retained real multi-asset privacy regression and the prerequisite privacy asset prelock. All 100 cases passed in independent clean-database UTC and Pacific/Honolulu runs with the final `FOR NO KEY UPDATE` prerequisite. The prerequisite file SHA256 is `99f759c31687a9865b50472451f24e4c662ec601dad05c04dd5a71605a4a464d`; the original caption worktree's privacy service remains unchanged.
- Real Fastify requests and Prisma transactions, with mocks only at the storage-provider boundary. Delays are explicitly released and competing SQL writes commit while provider operations are paused.
- All six caption routes have observed `pg_stat_activity` row-lock winner tests for account/version/session/member/channel/video authority and wall-clock expiry.
- Actual `PrivacyLifecycleService.advanceDue`/anonymization overlap with a different channel editor finishes without a deadlock; the stale edit returns 409 and removed assets remain removed.
- Actual PostgreSQL trigger-induced validation-commit abort preserves pending state and allows retry after the test trigger is removed.
- Additional cases cover delayed body-read authority loss, stale invalid finalizer, pending asset tombstones, current duration, concurrent duplicate preparation, concurrent default finalizations, explicit disable during validation, retryable truncated read, and positive OWNER/ADMIN/EDITOR workflows without MFA.
- API typecheck, lint, production build, and 421 API source tests passed.
- Focused formatting and diff checks passed.

The parent integration task owns union CI, source review, browser evidence, publication, and deployment. This evidence does not claim production R2 validation or completion of all master phases.

## Related prerequisites

The same actual privacy overlap also reproduced an existing admin upload-continuation deadlock in `MediaUploadService`: its Channel share lock precedes the source asset lock, while owner anonymization takes MediaAsset before Channel. A real OPERATIONS administrator resume request returned 500 and PostgreSQL reported that cycle. This caption patch does not alter shared media code; the separate reproducer and finding were handed to the parent for a focused follow-up. The combined base includes the separately reviewed upload/privacy and source-creation prerequisites, including the ordered privacy asset prelock and canonical owner-account helper. This caption slice does not modify their source files.

## Final recovery-UI union

The authority implementation was subsequently validated together with the accepted recovery UI on the corrected PR246 prerequisite. The actual union passed 1,267 source-only API cases across 183 files, four separate DB bootstrap cases, 498 API source units, 621 Web source units, the quality/build checks, 56 existing browser regressions and all 18 dedicated real-HTTP caption journeys. The API source-unit count is included in the 1,267-case gate. All nine caption originals were inspected. See the [combined-source record](AYIN_CAPTION_RECOVERY_EVIDENCE.md#exact-combined-source-validation-on-pr246) for exact base identities, runner corrections and remaining publication limits. This does not replace the separately recorded UTC/Honolulu owner-fence evidence or claim a production release.
