# Dormant durable upload persistence and inspection

## Scope

This additive prerequisite was first implemented and independently reviewed on R2 observation head `9d21e6659b8fbf44e1c802fc6d9358a149d5fd95`. Its current-union validation uses PR 246 head `d28642288bf141274cd6e363dddd7e7e12cdb37a`, base tree `4f5cf655df02eb2d09e1a3ab1df2af6ed6126b08`, including the accepted source-creation/privacy fences and navigation fixture correction. The dormant source implementation is unchanged from the accepted lock-timeout correction; only this evidence record changes during union verification. It provides durable metadata contracts, current-authority read-only inspection, and an exact full-byte identity algorithm. **It does not enable resumable uploads.** There is no production writer for the new table, creation opt-in, renewal endpoint, new signed token, UI recovery action, completion replay or cleanup activation.

Legacy upload creation and V1 token behavior remain unchanged. Existing uploads are not enrolled or reconstructed into recovery records. The new records exercised by tests are explicit new-protocol synthetic fixtures, not inferred legacy sessions.

## Additive persistence

`MediaUploadSession` retains the initiating account, source association and immutable channel/video/storage/size/MIME/segmentation/identity snapshot. It has an explicit OWNER or ADMIN provenance, state, revision and fixed expiry. Database checks enforce positive bounded bytes and part count, single/multipart ID shape, exact identity algorithm and digest format, and a positive lifetime of at most 24 hours. The source association is unique.

The new `createdAt` database default explicitly uses `clock_timestamp() AT TIME ZONE 'UTC'`. Actual raw-insert regressions showed that an ordinary timestamp default wrongly rejected the Cairo fixture and shifted Los Angeles creation time by seven hours. The change is confined to this new table; no existing timestamp, row or database setting is corrected.

The table uses nullable `SET NULL` source/account references with retained operational storage addressing. An absent source/account, changed source kind/key/bytes/MIME, changed asset-to-video-to-channel relationship or removed resource prevents provider reads. Reference detachment is never evidence that storage cleanup or privacy deletion succeeded.

Read-time expiry is a projection. Inspection does not mutate an OPEN record to EXPIRED, refresh its expiry, or manufacture a cleanup success. Only OPEN, unexpired, currently authorized and internally consistent records reach provider observation.

The migration contains no backfill. A local populated-upgrade proof applied the prior baseline to an isolated PostgreSQL database, created Account/Channel/Video/MediaAsset fixtures, saved all four complete row snapshots, applied the new migration, and verified those rows were exactly unchanged and the new table had zero rows.

## Read-only API

`GET /media/uploads/sessions/:id/inspection` uses the existing AuthGuard and expected-account header contract, validates the UUID, rejects unknown query keys, rate-limits inspection and returns `Cache-Control: private, no-store`.

Its projection contains only actor/channel/session/source/video IDs, lifecycle/revision, mode, expected size/MIME/part shape, dates and a sanitized observation. It exposes no object key, multipart upload ID, content digest, ETag, bearer token or signed URL.

Observation variants are explicit:

- `NOT_INSPECTED`: expired or not OPEN; no provider calls.
- `PARTS_OBSERVED`: a complete bounded provider listing whose part numbers and exact expected sizes have been checked. Real zero progress remains zero.
- `STORED_UNVERIFIED`: final-object size and available MIME metadata were observed, but file content and playback readiness remain unverified.
- `UNAVAILABLE`: the provider observation failed, exceeded a bound, timed out or contradicted the stored contract. It is never substituted with an empty successful list.

A verified ListParts `NoSuchUpload` may lead to a read-only HEAD, since completed objects can outlive multipart state. The `multipartMissing` flag preserves that known fact even if the HEAD is unavailable. Neither HEAD 404 nor an unavailable HEAD is presented as proof that no final bytes exist. Only the accepted all-or-error ListParts error provenance establishes missing multipart state.

ListParts uses the existing bounded R2 adapter. HEAD reuses `MediaProcessingStorageService.headObject`, including strict content-length handling and its existing metadata timeout (60 seconds by default, bounded by the existing 10–600-second configuration). No source bytes are read by this endpoint. No new provider configuration is introduced.

## Authority and transaction boundaries

Each provider observation is surrounded by two short database transactions. Both validate current account status, authVersion, live AccountSession and either current OWNER membership or the existing administrator authority/MFA/five-minute step-up helper. Owner session expiry uses the same UTC wall-clock comparison as the accepted authority fix.

Lock order follows the separately reviewed upload/privacy prerequisite: authority, generation advisory lock, source, video, channel, then the new session sidecar. Source/video/channel relationships and tombstones are checked after acquiring locks. The complete session snapshot and revision are compared after provider work. Session and step-up expiry are rechecked after row-lock waits. No database locks remain held across R2 I/O, including provider-error paths.

The inspection service has no source/upload-session/job mutation methods. Reading provider metadata cannot enqueue processing, mark UPLOADED/READY, publish content, authorize bytes or invoke cleanup. Normal pre-existing authentication activity tracking is unchanged. The existing `MediaUploadService` and `PrivacyLifecycleService` are not edited by this slice.

## Exact full-byte identity protocol

`AYIN_SHA256_CHUNKS_V1` is a versioned chunk-root, **not SHA256(file)** and not an ETag or sampled fingerprint.

1. Hash every fixed 4,194,304-byte leaf with SHA-256; hash only the actual bytes of the final shorter leaf.
2. Construct the root input in this exact order:
   - UTF-8 `AYIN:source-file:sha256-chunks:v1` followed by one NUL byte
   - big-endian unsigned 64-bit exact total file size
   - big-endian unsigned 32-bit fixed leaf size
   - big-endian unsigned 32-bit leaf count
   - all ordered raw 32-byte leaf digests
3. SHA-256 that input and encode the 32-byte root as 64 lowercase hexadecimal characters.

The shared WebCrypto implementation accepts an asynchronous byte source, verifies its actual length, normalizes arbitrary stream fragmentation into the fixed leaf boundaries, and supports cancellation during reads/hashing. It owns one 4 MiB buffer and a manifest smaller than 401 KiB at the 50 GiB maximum. Input producers remain responsible for their own buffering and cancellation. No filename, timestamp, file handle or bytes are persisted by the helper.

Independent Node crypto vectors include one zero byte, UTF-8 `abc`, both sides of the 4 MiB boundary, an exact two-leaf input, and a shorter final leaf. The deterministic larger-vector bytes are `b[i] = ((i * 31) + (i >>> 8) + 17) & 255`. Tests hard-code seven oracle roots, compare the WebCrypto implementation and Node oracle, and distinguish same-size changed middle/last-byte content. Cancellation, exact-length mismatch, invalid bytes, bounded crypto buffers and stalled read/digest paths are exercised.

The new table stores an **unverified source identity declaration**. No browser capture or worker pipeline is connected to it yet. Before live issuance, the browser must hash the original selected file before first authorization, rehash every byte on reselection, and the existing worker must compare downloaded source bytes to this identity before any READY transition, including recovered-output paths. Metadata matching alone cannot satisfy that gate.

## Privacy minimization and enablement gates

The existing privacy lifecycle retains account/video/media tombstones and asynchronously deletes known objects/prefixes. Its current deletion-job type does not represent multipart abort obligations. Adding a persisted multipart ID without extending that lifecycle could lose an obligation or falsely label media cleanup complete.

Therefore live issuance stays disabled until all of the following are reviewed together:

- Atomic revocation and registration of multipart/object cleanup obligations during privacy anonymization, with current exact-set asset lock ordering.
- Completion remains blocked while any such obligation is unresolved; `SET NULL`, expiry or row removal is never treated as successful remote cleanup.
- A finite cleanup/retention policy: fixed recovery expiry, bounded retry/backoff, visible unresolved cleanup, minimal key/upload-ID retention only while necessary, and content-digest redaction when integrity/recovery no longer requires it. Terminal digest nullability supports that later minimization; this slice does not perform the redaction or invent an operational retention schedule.
- Safe export projection for any live upload-session metadata, excluding operational keys, upload IDs and content digests. Current export remains explicitly allow-listed and exposes none of those new fields in the regression fixtures.
- Worker integrity verification, exact-file reselection, atomic quota/session-count reservation and reconciliation of irreversible provider operations.

This is a technical prerequisite, not privacy/legal compliance certification. The dormant table is not a substitute for the missing finite cleanup lifecycle.

## Rollout and rollback

Apply the additive migration before running the new API. Older application code can coexist with the added table because no existing column or legacy contract is removed. There are no historical upload or financial corrections.

Rollback the new inspection route/application code without dropping the table or discarding retained operational addresses. Once future live issuance is introduced, rollback must preserve its integrity checks, provider reconciliation and privacy cleanup support. Do not turn an unknown durable record into a legacy upload or reconstruct it from an expired token.

## Original observation-base verification and limits

The initial schema contract failed because the migration did not exist. After the populated migration proof, the initial actual HTTP regression failed with 404 before inspection was implemented. An earlier cross-execution-cell PostgreSQL attempt failed to connect; that environment failure is not behavioral regression evidence. Subsequent runs start the isolated TCP-only PostgreSQL instance and tests inside the same execution cell.

Intermediate inspection runs passed 33, 55 and 60 actual PostgreSQL/API cases. On the original observation base, the final focused run passed **134 actual PostgreSQL cases across six suites**, including **63 new inspection cases** and the existing upload, authority/timezone, quick-upload and privacy suites. The final populated-upgrade proof also passed. Coverage includes application-instance restart, legacy non-enrollment, safe projection, complete snapshot binding, foreign/expected-account denial, current owner/admin/MFA authority, provider-gap changes, exact segmentation, database constraints, detached-reference retention, and observed row-lock waits crossing source/revision/session/step-up/expiry boundaries.

Shared-contract tests passed **23 cases**, including 22 new full-byte identity cases. DB package tests/schema validation passed **58 cases**; API source tests passed **493 cases**. The test-only Node types dependency reuses the existing pinned 26.4.0 package and changes no resolution or production dependency.

On the original observation base before the lock-timeout correction, the normal API integration-suite command passed **178 files / 1,081 cases** with no failures or skips. Its selection includes source tests; it is not described as 1,081 distinct PostgreSQL cases. All affected shared-types/DB/API type and lint checks, shared-types/DB/API production builds, focused formatting and diff checks passed. The integration suite ran before the API declaration build emitted compiled test copies. No Web/PWA or physical-provider acceptance is inferred from these backend gates.

No production migration, data, provider resources, permissions, cleanup schedule or external repository state was changed. Synthetic bytes/XML and real isolated PostgreSQL are not physical R2, playable-media, browser/device, worker-integrity or live resumability certification. Owning CI, independent review, integration and deployment remain separate gates.

## Original-base independent correction: bounded database lock waits

Independent review found that Prisma's nominal five-second transaction timeout did not interrupt a PostgreSQL query already waiting on a source-row lock. At six seconds the inspection was still waiting while retaining its earlier authority locks; it failed only after the blocker released. The earlier candidate is therefore not accepted as bounded-lock evidence.

Every inspection snapshot now executes `SET LOCAL lock_timeout = '3000ms'` before any authority/resource lock, beneath an explicit five-second Prisma transaction budget and two-second transaction acquisition budget. PostgreSQL bounds each individual lock wait; this is not a claim of a three-second end-to-end request deadline. The setting is confined to the current transaction and is restored after rollback or commit. No database-wide, pool, network or provider configuration changes are made. These semantics follow the PostgreSQL 17 [lock timeout](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-LOCK-TIMEOUT) and [SET LOCAL](https://www.postgresql.org/docs/17/sql-set.html) contracts.

Only known Prisma transaction-expiry and PostgreSQL lock/statement-timeout errors become a sanitized HTTP 503 `UPLOAD_RECOVERY_BUSY`, inviting a later explicit read. The pinned Prisma 7 adapter retains SQLSTATE under `driverAdapterError.cause.originalCode`; the handler supports that shape and the direct SQLSTATE form. SQL text, storage addresses and provider identifiers are not disclosed. No failed read is replayed automatically, and all original authority/lifecycle fences and source/video/channel/session lock ordering remain intact.

Four new actual PostgreSQL regressions failed against the old candidate because the request remained pending while the blocker was held. They cover OWNER and ADMIN provenance both before and after the provider read. An intermediate implementation bounded the wait but still returned 500 because the adapter's nested SQLSTATE shape was not yet recognized; that run is retained and not accepted. After the correction, **all 67 inspection cases passed**, including the original 63. The contention cases verify that the HTTP request terminates before releasing the source blocker, earlier account/session/membership or staff-advisory locks can be acquired using NOWAIT/try-lock, upload/source/video/job and authentication-session records are unchanged, the connection setting is restored, no provider writes occur, and a later explicit read succeeds.

After this lock-wait correction, the unchanged-contract gates passed again: **23 shared-contract cases, 58 DB/schema cases, 85 focused R2/metadata cases (72 + 13), and all 493 API source cases**, plus API typecheck, lint and production build. The original independent contention probe also settled before its six-second observation while the blocker remained held: sanitized `UPLOAD_RECOVERY_BUSY` at 3,022 ms, zero provider calls, no remaining observed wait. Its 14 additional offset-buffer/variable-fragmentation identity oracle cases passed. The earlier 1,081-case normal integration run is pre-correction evidence; it is not represented as a post-correction full-suite rerun.

## Current-union verification on PR 246

The final local validation used the exact source-equivalent PR 246 base tree `4f5cf655df02eb2d09e1a3ab1df2af6ed6126b08` (`d28642288bf141274cd6e363dddd7e7e12cdb37a`). The checkout began at `f1ea72a08fec4fc8e724579dad6a0966e95647f1`; applying the supplied navigation-fixture-only correction reproduced that exact base tree through a separate Git index. The migration baseline was archived from its unchanged database schema/migration source. The accepted source-creation account/owner helper, existing upload service and privacy lifecycle lock implementation have no changes relative to this base.

Frozen pnpm 11.24.0 installation passed all 717 lockfile supply-chain policy entries without changing dependency pins. An initial offline install could not find a policy metadata cache entry; the normal frozen install resolved that cache limitation and passed. This was an installation prerequisite, not a behavioral test failure.

The populated current-union upgrade passed: before migration the recovery table was absent; after migration all four full Account/Channel/Video/MediaAsset row snapshots were exactly unchanged and `MediaUploadSession` contained zero rows. The DB integration command then passed **all four cases**, including repeated migration/seed deployment and relational constraints.

Current-union backend results:

- **183 API files / 1,219 cases passed** with no failures or skips using `vitest run --testTimeout=30000 --fileParallelism=false --exclude '**/dist/**' test`. The API had no emitted `dist` directory during this run. The selection includes source unit tests and integration tests; 1,219 is not a count of distinct PostgreSQL cases. It includes all 67 durable inspection cases, the timeout correction, and the current creation/privacy tests.
- The normal API unit command independently passed **101 files / 498 cases**. These overlap the combined API selection and must not be added to it as distinct cases.
- Shared identity/contracts passed **23 cases**; DB source/schema checks passed **58 cases**, and Prisma schema validation passed.
- Shared package production builds, affected shared-types/DB/API typechecks and lints, and the final API production build passed. Focused formatting and Git diff checks passed.

Only this evidence document changed from the independently accepted dormant implementation during current-union verification. Source/test content for the inspected timeout correction is unchanged. There are still no production session writers, issuance/renewal commands, worker integrity integration or activated cleanup. This verifies the additive backend prerequisite on the stated union; working browser-close recovery requires the worker, privacy, command and UI milestones described above. No production migration, live R2 resources, external repository state or deployment was changed by this verification.
