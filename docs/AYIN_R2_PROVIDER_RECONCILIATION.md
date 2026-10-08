# Provider-bound R2 completion reconciliation

Baseline: `c05eedbfb7477836699654475160a71d2446bc58`. Draft PR273. Implementation and verification in progress on 2026-10-08.

## Implemented boundary

New durable source allocations and SINGLE authorizations bind the exact server-generated session ID, source asset ID and AYIN full-file identity root to R2 object metadata. Initiation headers are signed by the server; SINGLE metadata headers are part of the presigned signature and returned only with that grant. Multipart part URLs cannot change initiation metadata. Legacy sources and worker output PUTs keep their existing contract.

The direct authenticated R2 completion observer consumes bounded ListParts pages for an exact upload ID. Only a structurally verified 404 `NoSuchUpload` permits multipart HEAD reconciliation. An active multipart upload stays unresolved. HEAD then requires the exact session/source/identity metadata, byte count, normalized content type and nonempty valid ETag. Missing/foreign metadata, wrong size/type, incomplete metadata, malformed headers, provider errors and timeouts fail closed. Its single 30-second deadline spans every page and HEAD. It does not read a cached public media URL.

These facts establish a currently stored, identity-bound source suitable for the existing integrity worker. They do not establish full-byte integrity or that no future write can arrive. ETags are opaque provider metadata; multipart ETags are not full-file SHA-256 values. The full source-byte and canonical-output checks remain mandatory before publishing.

The shared signer now sorts percent-encoded query names/values in bytewise order, replacing locale-dependent sorting. Independent signature reconstruction covers both legacy multipart-part URLs and metadata-bound operations.

## Explicit completion recovery

`POST /media/uploads/sessions/:sessionId/operations/:requestId/reconcile` accepts only `{ expectedRevision }`. The request ID identifies the existing COMPLETE journal. It does not create a replacement upload, reserve a new operation, resend parts, mint a grant, replay CompleteMultipartUpload, abort or delete anything.

Only the initiating current owner can reconcile the matching DISPATCHED/UNKNOWN COMPLETE in FINALIZING/UNRESOLVED at its exact expected revision. Authenticated login, ownership, source/video/channel identity, expiry and the trusted admission gate are rechecked after provider I/O. No database locks are held during storage calls. Cancellation, removal, privacy revocation, stale revision or expired authority prevents acceptance. Concurrent reconciliations commit at most one source acceptance and integrity job; accepted duplicates return the original success.

A matching provider observation lets the existing transaction atomically mark the source UPLOADED, session COMPLETED and original journal SUCCEEDED, and enqueue INTEGRITY_QUEUED. Failure rolls the entire acceptance back. An absent/mismatched/unknown observation preserves the journal, session, byte quota and cleanup obligations. Logical source acceptance never marks physical cleanup DONE or bypasses output barriers.

The creator UI offers an explicit English/Arabic “Verify upload completion” action for the original pending COMPLETE. Check, inspection and outcome GETs remain strictly read-only. A lost verification response remains pending and can be recovered from the GET outcome; no mutation is automatically retried. Account switches, backgrounding, repeated clicks and expiry preserve the existing controls.

## Cleanup reality and activation blocker

The existing obligation-aware worker already performs exact-key allocation inventory, persists exact discovered upload IDs, aborts owned abandoned multipart IDs and reobserves parts/object state. This change does not widen its authority, run production cleanup or treat its observations as final settlement. Unknown obligations remain quota/accounting debt and block privacy completion; after bounded retries they require review.

`UnsupportedDurableUploadSettlement` remains the production admission provider. Source/OBJECT, ALLOCATION and multipart cleanup proofs are still required, and the separate output barrier is still enforced by code and database constraints. There is no configuration flag, timeout grace period or test result that can mark these proofs satisfied.

Current official documentation guarantees strong consistency for completed operations, reusable presigned URLs until expiry, and multipart operations. It does not establish a per-session revoke-and-drain primitive for unknown in-flight PUT, CREATE or COMPLETE requests. A late write can appear after an earlier DELETE/HEAD404. AWS additionally warns that parts in flight can survive abort; that warning is not claimed as a certification of R2 behavior. Test observations can detect races but cannot prove an arbitrary future write impossible.

Immutable output attempts already prevent losing workers from overwriting the winning playback address. They do not prove physical deletion of losing output addresses. Existing worker canonical/HLS/thumbnail writes still use presigned single PUTs, and the output-attempt ledger tracks addresses rather than every provider dispatch/outcome. Source metadata cannot settle these output obligations.

## Bounded route to production issuance

1. Reserve an append-only record before every required source/output CREATE, PUT/part grant and COMPLETE, including all canonical/HLS/thumbnail and losing-attempt writes. Record exact owner/address, generation, dispatch identity and authoritative outcome. A timeout remains UNKNOWN.
2. Consider multipart-only new durable browser grants and required output writes to remove unrestricted whole-object PUT replay. Preserve the direct client-to-R2 body path and existing legacy behavior. This reduces risk but is not itself a fence.
3. Freeze new dispatch under current authority/privacy locks. Reconcile the complete frozen operation set without dropping unknown allocations or writes. A fully undispatched, explicitly grantless reservation is a separate narrow case; null expiry alone is insufficient.
4. Obtain/review a provider primitive or authoritative R2 contract for terminal multipart state, residual in-flight parts, delayed CREATE/COMPLETE outcomes and final observation bounds. Do not equate an application lease, worker shutdown, elapsed TTL, immutable key or successful abort with that contract.
5. Implement distinct source and output evidence bound to the frozen dispatch revision and cleanup lease. Only verified settlement plus final bounded absence may release physical cleanup debt. Any proposed eventual-cleanup product contract would require separate explicit review; this PR does not silently weaken the current one.
6. Run isolated real R2 provider acceptance, real browser CORS/transfer acceptance, delayed/lost-response races, PostgreSQL/privacy integration and worker output lifecycle checks. Deploy compatible API/worker/cleanup readers first. Enable only after both proof families and rollout evidence exist.

No production credentials, bucket access, CORS or lifecycle policy are changed here. No existing user object is deleted. [The isolated acceptance runner](AYIN_R2_RECOVERY_ACCEPTANCE.md) is separately opt-in and distinguishes simulated tests, provider observations and unproven settlement.

## Primary sources reviewed 2026-10-08

- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 consistency and concurrent writes](https://developers.cloudflare.com/r2/reference/consistency/)
- [R2 presigned URLs and browser CORS](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 Workers multipart API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 multipart lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [S3 CompleteMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html)
- [S3 AbortMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html)
- [S3 multipart overview and in-progress parts](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [SigV4 canonical request construction](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html)
