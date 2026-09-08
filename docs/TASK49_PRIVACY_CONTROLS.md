# Task 49 — User privacy controls

This document records the technical behavior implemented for AYIN Task 49. It is an engineering description, not a claim that AYIN satisfies every privacy, tax, accounting, moderation, security, or legal-retention requirement in every jurisdiction.

## Data map

The Task 49 review traced account-linked data through the Prisma schemas and media storage boundary.

| Area | AYIN records mapped | Task 49 treatment |
| --- | --- | --- |
| Account/auth | `Account`, `AccountSession`, `AccountMfaCredential`, `AdminRoleAssignment` | Export safe account identity only. Never export hashes, session tokens, MFA material, or internal security state. Deletion revokes access and eventually anonymizes the account while keeping the stable account ID required by retained records. |
| Profiles | `ViewerProfile` plus viewing/social relations | Export the authenticated account's profiles and user activity. On anonymization, profile identity is replaced with a neutral deleted identity so moderation/report references remain valid. |
| Channels | `ChannelMember`, `Channel`, settings, playlists, Creator TV | Export membership data and creator data only for channels the account owns. Owned creator surfaces are removed/anonymized after deletion; non-owned channel data is not treated as the user's exportable creator data. |
| Videos | `Video`, rights declarations, processing/playback metadata | Export owned-video metadata and user-declared rights records. After anonymization, videos remain as removed/private tombstones when finance/moderation references require stable IDs. |
| Comments | `Comment`, `CommunityPostComment`, `LiveChatMessage` | Export the user's authored content. At anonymization, text is replaced with `[deleted]` and status becomes removed where the record may still be needed as moderation evidence. |
| Subscriptions/lists | `Subscription`, `WatchLaterItem`, `MyListItem` | Export account-profile rows; delete at anonymization. |
| Watch history | `WatchProgress`, `WatchHistory` | Export account-profile rows; delete at anonymization. |
| Community | `CommunityPost`, reactions, poll votes, comments, reports | Export authored posts and the account profiles' activity. Posts are removed/redacted; disposable reactions/votes are deleted; reports are retained against anonymized profiles. |
| Notifications | `Notification` | Export account notifications; delete at anonymization. |
| Revenue | `CreatorContract`, `EarningsLedgerEntry`, `RevenueDispute` | Export safe creator-facing fields for owned channels. Preserve accounting rows at anonymization. |
| Payouts | `Payout`, `CreatorPayoutProfile` | Export amounts/statuses and masked destination information only. Never export encrypted destination blobs. Historic payout/accounting rows stay intact; active payout-profile identity/destination fields are cleared or anonymized. |
| Moderation | `Report`, `CommunityPostReport`, `ModerationCase`, live moderation actions | Export the user's own report submissions/status but not privileged moderation-case summaries, resolutions, staff identities, or internal case metadata. Evidence records may be retained against anonymized identities. |
| Audit | `AdminAuditLog` | User export exposes only privacy lifecycle event names/timestamps for that account. General admin audit metadata is not included. Audit rows are retained; account identity can be anonymized without removing the stable entity ID. |
| Media objects | `MediaAsset`, `MediaProcessingJob`, `MediaPlaybackGeneration`, renditions, R2 keys | User export exposes safe media metadata, never private object keys/checksums. At anonymization, database media state becomes removed/cancelled and storage objects/prefixes are queued for asynchronous deletion. |
| Live | `LiveStream`, `LiveChatMessage` | Export public creator/live metadata but never stream-key hashes, ingest endpoints, provider IDs, or internal playback URLs. Deletion clears live secrets and removes/cancels the creator surface. |

## Download my data

`GET /privacy/export` requires an authenticated AYIN account. Ownership is derived only from the authenticated account ID. The API returns a machine-readable JSON attachment with `Cache-Control: no-store`.

The export intentionally excludes password hashes, signed/raw session material, MFA secrets/recovery hashes, raw media object keys and checksums, encrypted payout destinations, live ingest/security secrets, data owned by unrelated accounts, privileged moderation case details, and general administrator audit metadata.

Creator-channel data is scoped to channels where the authenticated account is the `OWNER`; membership references to other channels include only the small public channel identity needed to explain the membership/subscription.

## Account deletion lifecycle

Task 49 implements an explicit lifecycle instead of cascading the account row:

1. `REQUESTED` — the signed-in user must provide the current password and type `DELETE MY AYIN ACCOUNT` exactly. The request is audited.
2. `GRACE_PERIOD` — the worker assigns a 14-day technical grace period. The user can cancel while the request is `REQUESTED` or `GRACE_PERIOD`.
3. `DEACTIVATED` — after grace expiry the account becomes `CLOSED`, all current sessions are revoked, and authentication stops. A 24-hour technical recovery window exists for a SUPERADMIN recovery action with recent step-up authentication and a written reason.
4. `ANONYMIZED` — after that recovery window, direct identity/authentication data is removed or replaced with deterministic neutral tombstones. This transition is intentionally irreversible through the Task 49 admin API.

A user cancellation and an administrator recovery are both audited. Admin recovery is permitted only before `ANONYMIZED` and the endpoint requires `SUPERADMIN`, MFA policy, and recent step-up via the existing admin security boundary.

## Retained and removed data

Task 49 does not pretend that every row should be physically deleted. Financial ledgers, payout history, rights/audit records, moderation/report evidence, and selected security records remain when removing them would break the associated historical record. Direct identity fields are anonymized or operational secrets are cleared where possible.

Behavioral/user-preference rows such as watch progress/history, lists, subscriptions, reactions, recommendation state, and notifications are deleted during anonymization. Creator surfaces are removed/anonymized, while stable video/channel/profile identifiers may remain as tombstones where finance/moderation references require them.

This is a technical retention model only. Production policy owners must still validate concrete retention periods and jurisdiction-specific requirements before launch.

## Asynchronous media deletion

Anonymization never blocks a database transaction on remote object deletion. Instead it creates idempotent `PrivacyMediaDeletionJob` records for exact objects and HLS segment prefixes. The media worker claims jobs, retries transient failures with bounded backoff, recovers stale claims, and marks the deletion request's media cleanup complete only when every job is done.

The queue covers database-known `MediaAsset` objects, processing staging/input/output objects, fallback MP4s, HLS master/rendition playlists, and HLS segment prefixes. R2 prefix deletion paginates ListObjectsV2 and deletes the returned objects. Failed jobs remain visible in durable state for operator retry/investigation rather than falsely claiming cleanup succeeded.

## Operational notes

Pre-existing financial/moderation/audit rows are not rewritten wholesale by this migration. Task 49 adds new lifecycle/job tables and an additive worker path. The media worker process runs both the existing processing worker and privacy lifecycle worker.

The application should be deployed with database migrations applied before the new API/worker version starts. Operators should monitor `AccountDeletionRequest.lastError` and failed `PrivacyMediaDeletionJob` rows. A successful database anonymization and a successful remote-media cleanup are recorded separately because they have different failure boundaries.
