# Dormant creator upload recovery commands

This backend slice adds a separate creator protocol. Production issuance remains unavailable: `DURABLE_UPLOAD_SETTLEMENT` is registered to `UnsupportedDurableUploadSettlement` in every shipped configuration. The service rejects before draft/source/session creation, signing or provider allocation unless trusted provider code supplies reviewed browser-grant and server-write settlement evidence and a cleanup settlement verifier. There is no request field, environment switch or operator override. R2 currently supplies neither admission evidence nor cleanup settlement. Existing V1 upload routes and tokens retain their separate path.

Expiry, an output-address ledger, successful DELETE/HEAD absence and best-effort provider logs are not settlement proof. The new grantless reservation witness and zero count record only that no grant was reserved by this protocol. A null grant expiry remains unknown to the cleanup worker; its existing fail-closed rule is unchanged. Real provider support is an external gate, not an implementation checkbox.

## HTTP contract

Frozen application contracts are exported from `@ayin/types` in `upload-recovery.ts`. Every request object is strict; UUIDs are canonicalized and `requestId` must be a UUID. Never retry these fields against `/creator/videos/drafts`: that older endpoint strips unknown fields.

- `POST /creator/videos/recoverable-drafts`: `requestId`, `channelId`, `title`, `sizeBytes`, `mimeType`, full `fileIdentity`, optional `durationMs` and `videoForm`. Atomically creates draft, required-integrity source, PREPARING session and CREATE journal. Single mode opens without storage I/O. Multipart allocation is dispatched once outside the transaction before opening.
- `POST /media/uploads/sessions/:sessionId/resume`: `requestId`, `expectedRevision`, full `fileIdentity`. Requires the original complete-byte identity and an OPEN session. A SINGLE PREPARING reservation can also recover only when its server-issued grantless witness, zero grant count and original RESERVED/undispatched CREATE journal all agree; null expiry alone is insufficient. Returns the current bounded session; use existing read-only `/inspection` for provider observations. It does not sign or allocate.
- `POST /media/uploads/sessions/:sessionId/authorize`: `requestId`, `expectedRevision`, `partNumber` (1 for single mode). Reserves exact signing time and maximum expiry before invoking the signer. Returns a grant only on the first successful response.
- `POST /media/uploads/sessions/:sessionId/complete`: `requestId`, `expectedRevision`. The server obtains complete bounded provider part metadata; no client ETags or provider IDs are accepted. Completion and metadata reads run outside database transactions. Source UPLOADED, session COMPLETED and the existing INTEGRITY_QUEUED processing job commit atomically. HEAD metadata does not establish byte integrity; the existing worker verifies every source byte and canonical output.
- `POST /media/uploads/sessions/:sessionId/cancel`: `requestId`, `expectedRevision`. Stops future platform grants and atomically records existing cleanup obligations. The response reports authority revocation and pending settlement. It does not claim exposed provider URLs were revoked or bytes deleted. Accepted COMPLETED uploads use the video/privacy removal lifecycle.

Successful POST responses use HTTP 201 and `{ session, operation, grant?, cleanup? }`. All responses use private/no-store. Public DTOs omit object keys, multipart IDs and file digests. An exposed grant necessarily contains its signed provider address; it is never persisted in the operation journal.

## Read-only discovery and outcomes

- `GET /media/uploads/sessions/capability` is authenticated and returns only `{ protocolVersion: 1, supported, reason }`, where reason is null for supported or `UNSUPPORTED` otherwise. It reads the same trusted settlement gate without provider calls. It grants no authority: every subsequent write still checks current evidence and ownership.
- `GET /creator/videos/recoverable-drafts/:requestId` resolves a lost CREATE response by the current initiating account and creation request UUID. The browser does not need a session ID or to resend the file identity/body.
- `GET /media/uploads/sessions/:sessionId/operations/:requestId` observes one recorded command. Both outcome routes return the current safe session plus operation outcome with `replayed: true`; neither returns a grant, body fingerprint, digest, provider ID or object key. Current login, initiating account, ownership and privacy fences apply. Recorded outcomes remain readable after hard expiry and normal retirement of an accepted staging source.
- All these GET routes require an empty query and return private/no-store. Existing inspection adds only `protocolVersion: 1`; prior fields are preserved.

`RESERVED` is reported as PENDING, DISPATCHED/UNKNOWN as UNKNOWN, and a committed SUCCEEDED remains SUCCEEDED even if the current session later changes. Inspection alone does not prove a previous authorization outcome: OPEN can coexist with a dispatched authorization. A 404 means no current readable match, not proof an in-flight request cannot still commit, and never permits automatic replay or a second CREATE. Use these read-only outcome routes to reconcile lost responses; do not resend a mutation merely to poll it.

## Replay and uncertainty

Creation request IDs are unique per initiating account. Command request IDs are unique per session. Reusing an ID with changed parsed content returns `UPLOAD_REQUEST_CONFLICT`. A duplicate success reports `SUCCEEDED` and `replayed: true`; it never dispatches/signs again and never renews expiry. If an authorize response is lost, first recover the outcome through the read-only operation lookup, then explicitly request a new authorization with a fresh ID and current revision. Repeating the successful authorize ID returns no grant.

The journal distinguishes RESERVED, DISPATCHED, SUCCEEDED and UNKNOWN. A possible allocation/completion/signing dispatch is never blindly replayed. An uncertain dispatch reports UNKNOWN; its still-current session is quarantined as UNRESOLVED. An already cancelled/privacy-revoked state is preserved. Concurrent duplicates can report UNKNOWN while the original dispatched call is still running; the read-only request outcome later reveals its committed result. New completion/authorization commands cannot bypass an UNRESOLVED session. Cancel remains available to preserve cleanup debt.

OPEN completion advances to FINALIZING before I/O; only its exact revision can commit COMPLETED. Cancellation advances the revision and records ABORTED plus durable obligations. The 24-hour hard expiry is never extended by recovery. No V1 token enrolls into this protocol or operates a required-integrity asset.

## Locks and bounds

Admission uses current account/session/owner and privacy fences, a per-actor admission lock and shared per-channel byte-capacity lock, then lifecycle resources. Resource order is generation, source, video, channel, upload session, journal. The same channel capacity lock and transactional byte check protect legacy source reservation. Read/commit phases revalidate current authority and expiry after lock waits. Provider I/O and signing hold no database locks.

Live source bytes plus unresolved removed-source debt consume the existing administrator-configured byte quota. Safety admission ceilings additionally permit at most 10 outstanding sessions/debts per initiating account and 50 per channel. Each session allows 20,050 journal entries, enough for 10,000 parts, one replacement grant per part and recovery; the final slot is reserved for cancellation. These are protocol resource-safety limits, not new business settings.

The bounded journal remains attached while cleanup is pending. Only existing verified terminal cleanup retention deletes it, in the same transaction that minimizes the session after all obligations are DONE. Creation/command idempotency is guaranteed while that retained session exists; clients must never reuse request IDs for new uploads. There is no cascade that can erase live obligations.

## Rollout limits

This does not add a browser client, background upload, automatic file retention or a second media queue. Fake adapters used by synthetic/real-PostgreSQL tests exercise the supported contracts through DI. No shipped adapter enables the new protocol, and this slice performs no production credentials, provider configuration, real media, publication or activation work. The next browser slice must consume this contract and treat UNSUPPORTED, changed identity/authority, expiry, UNKNOWN and pending cleanup as explicit outcomes.
