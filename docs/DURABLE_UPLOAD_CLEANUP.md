# Durable upload cleanup prerequisite

Status: additive prerequisite; durable upload issuance remains disabled. This change extends `PrivacyMediaDeletionJob` and the existing privacy worker. It does not create a second queue, enable recovery commands, change production configuration or certify real R2 behavior.

## Obligations and ownership

- `OBJECT`: exact source object cleanup.
- `MULTIPART`: exact key plus exact remote upload ID cleanup.
- `OUTPUT_SETTLEMENT`: request-owned aggregate barrier per required processing job, retaining its known canonical/adaptive/thumbnail addresses and deterministic output namespaces. Its database constraint forbids DONE until a reviewed output-writer settlement protocol is implemented; original source-key proof never satisfies it.
- `ALLOCATION`: exact server-generated key inventory reconciliation for a create whose provider result may have been lost, including `PREPARING` without an upload ID.
- `PROCESSING_SOURCE` scope uses an OBJECT obligation plus any multipart/allocation obligations registered in the owned READY transaction. All are channel-owned, with processing-job linkage and no initiating-account ownership. The processing worker retains staging until that commit and the existing cleanup worker owns subsequent provider work.

Standalone expiry/cancellation work has a non-null deterministic operation key and session/channel snapshots plus an account snapshot when known. Orphaned sessions still own cleanup even after account/source references disappear; no owner identity is invented. Privacy later adopts all applicable existing obligations, including previously failed work and snapshots whose source/session references were detached. It may adopt an initiating account’s pre-completion grant cleanup; accepted PROCESSING_SOURCE media is adopted only through exclusive channel ownership. Deleting a foreign initiating administrator does not adopt accepted channel media or cancel its owner-governed processing. The default operation key preserves legacy-client inserts, and a database evidence constraint rejects their DELETE-only DONE updates on new durable scopes. The old `(requestId, kind, target)` uniqueness is retained only as a SQL partial index for legacy PRIVACY jobs: multiple remote upload IDs at one target are valid separate obligations. Nullable request IDs never define upload deduplication.

Standalone upload cancellation stops at transfer acceptance: a COMPLETED session requires the processing/privacy lifecycle, including output cleanup. The source-cleanup helper cannot silently become a cancel-processing or delete-video command. Expiry/cancellation tombstones PENDING and UPLOADED sources; enqueue requires COMPLETED in the same future completion transaction.

Provider create/signing calls remain absent. Future issuance must reserve a unique object key before allocation, persist the maximum issued grant expiry, increment the session revision for authority/grant changes, and never reuse a retired key. `lastGrantExpiresAt = null` means unknown, not no grants; it cannot satisfy settlement verification.

## Privacy and concurrency

Privacy retains Account-first ordering and locks the exact selected MediaAsset union in UUID order. It revokes the session and increments its revision, snapshots addresses and creates/adopts obligations in the same transaction before content is removed or its digest minimized. Foreign/detached references are never evidence of provider deletion. The legacy raw cleanup-account FK remains ON DELETE RESTRICT, so registered grant obligations block hard owner removal. Accepted channel-owned obligations have no initiating-account dependency. The request FK changes from CASCADE to RESTRICT: neither unfinished nor retained completed cleanup records disappear with a request deletion; a future request-purge policy must explicitly handle completed audit/deduplication rows. Any unresolved or FAILED obligation prevents `mediaCleanupCompletedAt`; the authenticated privacy status exposes safe pending/processing/requires-review/completed counts without private addresses.

The worker claims with PostgreSQL `FOR UPDATE SKIP LOCKED` and a fresh UUID lease token. Attempt, token, unexpired lease and the observed session revision are checked under locks before committing an outcome. Privacy adoption invalidates an older claim. Provider work runs outside transactions. Request completion uses a separate request-locked transaction after releasing source/session/job locks; a bounded reconciliation pass repairs a crash between DONE and request completion without introducing the inverse lock order.

A lost allocation observation persists every matching remote upload ID. It ignores merely prefix-matching neighbors and never arbitrarily adopts one allocation or starts a replacement. Truncated/limited/invalid/timed-out observations remain unresolved, with no partial adoption.

## Physical settlement remains unproven on R2

Logical revocation prevents new application grants and content eligibility. It does not invalidate an already-issued presigned URL or cancel a remote request already in flight. Successful DELETE, abort, elapsed expiry, `NoSuchUpload`, and current object absence are separate observations. None alone is final cleanup.

Cloudflare documents that presigned URLs can be reused until expiry: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). Its consistency guarantee covers completed operations and orders competing writes by completion: [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/). The S3 abort contract warns that in-flight parts may still finish and require repeated abort/verification: [AbortMultipartUpload](https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html). The S3 statement is a caution, not a certification of R2 settlement behavior.

The adapter's optional settlement verifier must produce trusted provider evidence bound to the exact object/allocation operation, session ID and revision, grant-expiry cutoff, revocation time, claim token and attempt. It must establish that no future allocation or write can complete at that address. The worker verifies the binding and provenance and reobserves after the settlement fence. There is deliberately no R2 implementation, duration-based substitute, environment boolean or operator "mark DONE" bypass. Synthetic evidence in tests proves only our state machine.

Privacy registers output barriers before cancelling/redacting required processing jobs, including deterministic canonical/adaptive/auto-thumbnail namespaces even when their rows are not yet present. A later source-key adapter cannot bypass this gate: the worker does not ask it to settle an output barrier, and a database constraint rejects DONE for that kind. The missing output-writer protocol is a deliberate activation blocker, not an operator override.

Live issuance therefore still requires externally reviewed provider evidence for delayed create responses, single PUT replay/in-flight completion, part replay/in-flight completion, multipart complete versus abort, and the final observation bounds. This implementation cannot claim those provider guarantees.

## Retries, minimization and compatibility

Automatic claims are capped at five with bounded exponential backoff. Every claim gets a fresh lease clock, and privacy adoption of an exhausted claim becomes visibly FAILED. Legacy prefix cleanup now has a whole-operation 30-second deadline plus strict bounded inventory parsing, below the five-minute claim lease. Exhausted/crashed final claims become FAILED, retaining exact unresolved addresses and a redacted reason code for operator review. Future authorized operator retry tooling must requeue reviewed obligations; this prerequisite adds no new unaudited admin mutation route.

`MEDIA_UPLOAD_CLEANUP_RETENTION_DAYS` controls the finite retention deadline from cleanup registration (default 30; valid integer range 1–365). Invalid values fall back to 30. Revoked, cancelled and expired session digests are cleared when obligations are registered. Completed-session digests are cleared only when immutable input identity has moved into the processing-job contract and owned READY registers source cleanup. Multipart source READY also registers exact allocation/multipart obligations. Privacy clears copied job fingerprints only through the terminal CANCELLED-job redaction guard, which prohibits restoration or restart. Incomplete processing identity remains governed by that worker contract.

After every obligation is verified DONE and retention has elapsed, the worker removes the terminal session and minimizes exact target/upload/source addresses in its cleanup records. Until physical cleanup is verified, minimal recovery addresses remain and the retention deadline does not erase them or falsely complete the privacy request. Audit/deduplication identities remain. Existing legacy PRIVACY object/prefix cleanup behavior remains distinct.

Privacy export continues to allow-list safe fields and excludes object keys, upload IDs, digests, provider proof references and lease tokens. Rollout requires compatible privacy workers: an old binary cannot interpret the new MULTIPART/ALLOCATION kinds. Deploy the schema and compatible workers before any future durable issuance; rollback must keep this obligation-aware worker active.

## Validation

The PostgreSQL suite uses an isolated disposable database and synthetic storage only. It covers lost allocations and multiple exact IDs, late writes, missing multipart versus present object, transient/invalid/limit/timeout observations, concurrent/duplicate/stale claims, privacy during provider work, detached source/session references, expiry and source eligibility, bounded exhaustion, proof binding, finite verified-completion retention, transactional processing-source registration, database ownership constraints, and export minimization. No production deletion or real provider request is part of this suite.
