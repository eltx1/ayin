# Durable upload worker integrity prerequisite

This bounded change extends the existing media queue/executor/lifecycles. Upload recovery issuance remains disabled. It requires the sibling upload-cleanup obligation migration/helper before deployment; it does not activate R2, create credentials, change playback selection, or certify browser/provider behavior.

## Contract

- Existing jobs stay `inputIntegrityVersion = 0`, with no manufactured identities.
- Required jobs snapshot version, originating upload session, exact input asset/account, input key/size, algorithm and full-byte root on the processing row. PostgreSQL rejects changes to that declaration. No sidecar read can downgrade it.
- `MediaAsset.uploadIntegrityRequired` is an irreversible protocol marker, automatically set when a session is attached. New session attachments to an existing processing input/canonical are rejected under a source-asset lock; legacy identities are never retrofitted. A missing/detached session before enqueue fails closed. Session detachment after enqueue leaves the immutable job declaration intact. Missing cleanup metadata prevents READY rather than deleting the retained source.
- Privacy may perform one-way digest/verification redaction only after the job is CANCELLED. `inputIntegrityRedactedAt` records this terminal exception; required version/address/lineage remain and PostgreSQL forbids restart, restoration or downgrade. Redaction never means the storage cleanup finished.
- Original inputs must match the COMPLETED session (set inside the same transfer-acceptance transaction before enqueue). Reprocess/backfill input requires the READY producer's independently verified canonical identity, exact asset and parent job. Original selected-file roots are never applied to transformed bytes.
- Input verification is bound to the claim token and attempt. Every claim clears earlier evidence. Lease, generation, current channel-owner Account and source/video/channel privacy checks protect verification and readiness mutations. The consistent lock order is sorted Accounts/memberships, generation, exact sorted assets, job, then video/channel. Byte/provider work occurs outside transactions.

After atomic COMPLETED transfer acceptance, channel custody governs processing. Initiating identity remains immutable provenance; closing/deleting a former administrator does not strand another active owner's accepted job. The original session may retain a null initiating-account FK without changing its accepted state. The complete sorted owner set remains locked, and a shared channel stays eligible while at least one owner remains active. Required jobs also carry immutable `inputIntegrityOwnerlessPlatform`, derived by PostgreSQL from both no OWNER membership and explicit `Channel.isPlatformOwned` at acceptance. Empty membership is eligible only with that accepted marker and the current platform flag; membership disappearance never promotes a member-owned job. A later explicit canonical reprocess captures current legitimate custody without changing its parent or byte lineage. Otherwise owner privacy fences every readiness path, including canonical-derived reprocessing. Pre-completion grant authority is unchanged.

## Actual worker behavior

For required source and canonical readback downloads, the existing storage path receives an exact byte limit from immutable input size or locally hashed canonical size. Mismatched Content-Length is rejected before opening scratch; a streamed-byte transform enforces the cap even if headers are missing or false, rejects short/truncated input, and removes only its exclusively opened partial file on abort/error. Overflow chunks are never forwarded to disk. Legacy downloads retain their existing default contract.

For a required job, the executor re-downloads retained input, hashes every byte with the shared `AYIN_SHA256_CHUNKS_V1` iterator, compares the root and records evidence under the current claim. It does this before probing/transcoding, any recovered canonical shortcut, adaptive fallback readiness, rendition/master readiness or adaptive READY. Missing/unsupported declarations, wrong/short/extra input, lease loss and privacy changes cannot produce READY.

Durable retries regenerate unproven canonical and adaptive outputs. Legacy canonical/rendition recovery stays unchanged. The newly produced canonical is hashed locally, downloaded from storage, and hashed again; the two byte identities and HEAD size must agree. This distinct canonical identity is persisted for later transformed-input lineage.

Durable staging is never deleted by the executor. The owned canonical READY transaction atomically persists a deterministic `PROCESSING_SOURCE` cleanup obligation via the existing cleanup mechanism. A pre-commit crash retains input; a post-commit crash retains the cleanup obligation. No new worker stack is introduced.

## Shared automatic thumbnail boundary

The executor is the only production caller of automatic thumbnail generation. It now passes the job ID and claim for legacy and required jobs through one shared path. Before extraction or provider upload, an owned transaction reserves the deterministic thumbnail asset as PENDING. Source/output/thumbnail assets are locked together in sorted order before job/video locks. Existing VALIDATED automatic or creator thumbnails remain untouched.

A fresh ownership check precedes upload; only a current claim/generation/privacy-safe transaction may commit VALIDATED afterward. The final asset UPDATE also checks the claim and unexpired lease against the PostgreSQL clock, including after session-lock waits. An interrupted upload retains its non-eligible tracked address for retry/privacy cleanup. A stale callback never deletes the shared key or resurrects a removed asset. A competing creator thumbnail wins without being replaced. Logical eligibility fencing and known cleanup addresses do not certify physical settlement of an in-flight provider write; required-job output settlement remains a separate fail-closed cleanup gate.

## Mixed-version waiting state and rollout

`INTEGRITY_QUEUED` is an explicit private queue lane, not active ingest. Compatible workers claim both legacy `QUEUED` and required `INTEGRITY_QUEUED`. Legacy workers select only `QUEUED`, so a required job cannot repeatedly block their next eligible legacy job. The database maps required `QUEUED` writes from old retry/recovery tools back to `INTEGRITY_QUEUED` and rejects incompatible active claims and READY writes through a transaction-local worker version fence.

Current creator history, upload confirmation/processing and admin response presenters expose the existing truthful `QUEUED` status. Queue and observability summaries combine both waiting lanes. Generation safety, adaptive backlog/in-flight counts and rollout SQL include the new lane. Processing concurrency counts continue to include only actual active statuses.

Deployment must be coordinated: apply both prerequisite migrations; deploy regenerated database clients and the compatible API/worker/cleanup code; drain or replace old API readers/operator binaries; only then consider later issuance work. Old readers are not a supported durable-session surface and must never be used to certify recovery. Rollback may disable issuance but must retain the integrity guards, compatible queue/cleanup processing and outstanding obligations. No downgrade migration removes required evidence.

## Verification record

These are separate checkpoints, not a claim that the latest combined source has passed every gate.

- The initial helper's test-first red run failed before implementation; source/remote byte corruption and claim/privacy regressions were then added.
- Initial combined integrity/cleanup checkpoint: clean migrations and populated legacy upgrade passed; 51 focused PostgreSQL cases passed; 612 API/DB/shared source tests passed; Prisma validation/generation and DB/types/API typecheck/build plus API lint passed.
- The first full API PostgreSQL sweep was **771 passed, 1 failed (772 total)**. The failure was an obsolete lock-observer fixture with a secondary timeout. The corrected entire authority file later passed **37/37**. This is explicitly not a full-sweep pass.
- The cleanup owner's later custody/retention freeze (`9bd4a103`) independently passed **193 clean + 193 populated PostgreSQL cases**, **531 API source cases**, typecheck/build/lint. It did not include the subsequent download-bound or output-attempt changes.
- Exact download bounds: test-first red recorded 6 failures/3 passes; the subsequent download/storage/executor unit group passed 34 tests, with affected lint. It exercises the actual storage download adapter against streamed fake HTTP responses and real scratch files, not live R2.
- Current output-attempt source slice: **46 focused unit/consumer cases pass** across six files; affected lint passes. The added PostgreSQL tests use the real queue/executor/lifecycles and controlled in-memory storage to hold already-issued PUTs. They are regression models, not live-provider settlement evidence. Migration, regenerated-client/type/build checks and PostgreSQL runs are pending the serialized runtime slot.
- The actual old generated Prisma client was probed at the earlier checkpoint: unknown `INTEGRITY_QUEUED` reads fail closed; its legacy `QUEUED` selector remains usable and does not select required jobs. Recheck at final combined acceptance.

A final green integrated full-source and PostgreSQL sweep remains required after all corrections and current-main integration. No earlier result substitutes for that gate.

## External gates still required

Real R2 signed grant expiry/replay, delayed writes, create/complete/abort settlement, bucket lifecycle and multipart reconciliation remain external gates. Regeneration and claim checks alone do not certify provider-level in-flight-write settlement. Large-file/device/browser interruption and reselection also require their later implementation/evidence. Production issuance remains off.

## Output-attempt follow-on (separate acceptance gate)

ADR-016 closes the cross-claim provider overwrite race that database lease checks alone cannot prevent. Required claims now persist a fresh, append-only attempt address ledger in the existing claim transaction, carry captured token/count/attempt through callbacks, and use distinct canonical/HLS/generated-thumbnail paths. Legacy paths are unchanged. The migration refuses unsupported existing required jobs rather than inventing prior write evidence, while preserving populated legacy rows.

The authored PostgreSQL regression really holds an already-issued canonical, thumbnail, segment or master PUT, lets a replacement using the same stable worker ID reach READY, then settles the original request. Winning bytes/digest/recorded links must remain unchanged; both attempts remain recorded. It also checks required canonical reprocess output cannot collide with its input. Additional probes reject ledger mutation/deletion, absent/mismatched captured identity and retain ledger snapshots after logical video/job removal.

Validation of this follow-on is pending the coordinated runtime slot. Earlier checkpoint evidence must not be treated as acceptance of this new schema/key contract.

### Claim/privacy ordering

Required claims use the same sorted owner/membership → generation → exact assets → job → video/channel/session locks as owned callbacks, with an explicit queued-eligibility mode and no fictitious lease/proof. Automatic stale recovery commits its job-row locks in a separate queue-serialized transaction before the claim transaction can wait for owners. The claim transaction re-reads settings, capacity and eligibility. Legacy conditional claiming stays unchanged. A read-only required eligibility prefilter skips closed/orphaned/detached/superseded candidates instead of starving other jobs.

If claim wins the owner lock, its append-only reservation commits before privacy can snapshot outputs. If privacy wins, claim cannot append or repoint before cancellation; it revalidates after the wait and loses eligibility. Authored real-PostgreSQL lock-observed tests cover both orders, all barrier reservations, closed-candidate progress and an expired completion waiting on the source session while stale recovery queues behind its job row. These new cases await the coordinated runtime gate.

### Indexed output-prefix provenance lookup

Legacy-input/session-attachment guards extract only the anchored canonical lower-case UUID namespace ending in a full attempt UUIDv4 plus `/`, then compare it with the unique indexed ledger prefix. They do not normalize/cast path segments or interpret suffixes. The authored PostgreSQL oracle compares this with the former `starts_with` behavior for canonical/HLS/thumbnail keys, reprocess suffixes, nulls, malformed paths, case changes and extra separators. The SQL-plan probe explicitly disables sequential scans only to prove index eligibility on the tiny fixture; it does not claim production latency. Runtime results remain pending.

Independent source review caught a terminal-cleanup conflict after the existing operator retry resets its numeric budget. The corrected guard requires count equality only for active/READY eligibility; queued/terminal rows may retain the original immutable attempt address/count snapshot. A real-PostgreSQL privacy lifecycle regression now covers reset → cancellation/redaction → preserved output barrier before another claim. Runtime execution remains pending.
