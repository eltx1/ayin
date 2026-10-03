# Creator upload transaction review

Focused Phase6/8/14 candidate. The full master remains unfinished.

## Actual source defects

PATCH creator/videos/:id previously committed basic details before duration-aware advanced metadata validation/write. Publish separately committed advanced policy/metadata, publication/rights declaration/playlist/TV association and then rights basis/note. A later error could leave a partial successful state behind a failed response. An explicit null schedule fell back to the saved schedule, preventing immediate publication after clearing a date. The core publication transaction did not reject REMOVED status after its own read; the earlier controller check alone could race a concurrent removal.

## Correction

The existing owner-only details and publish endpoints coordinate their domain services in one PostgreSQL transaction, using an existing Video row lock before reading/mutating. Metadata helpers accept an optional existing transaction and preserve their previous standalone behavior. Basic details, advanced policy/metadata, publication/rights/playlist/Creator TV changes, rights basis/note and response reads use the same transaction, so late failure rolls them back together. Publication independently checks removed status inside its row-locked transaction after ownership verification. Explicit null schedule clears the previous date; omitted schedule still retains it.

AuthGuard, Origin, ownership/Studio roles, rights confirmation, canonical processing, defaults/settings and existing publication contracts remain authoritative. No schema migration, provider call, credential or finance change is introduced. Optional transaction plumbing does not certify other Studio/moderation/metadata routes as atomically coordinated. Upload root/storage authorization/byte transfer and provider failures remain separate workflows; arbitrary network response loss still requires a read/review and is not automatically replayed.

## Validation and limits

Local378 API units across92 files, lint and typecheck passed. Five actual AppModule/PostgreSQL regression cases are authored: rejected duration metadata rolls back basic edits; unconfirmed rights rolls back advanced policy; injected late rights-write failure rolls back publication/rights/playlist; explicit null clears an existing future schedule; concurrent removal holds a real row lock, the publish request is observed waiting in pg_stat_activity, then publication rejects REMOVED without metadata/rights writes. Exact-head PostgreSQL/full CI and browser gates remain pending. No local database execution, large-data contention/performance, provider/device or whole Phase6/8/14 completion is claimed.
