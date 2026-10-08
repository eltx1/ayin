# Finite media cleanup V2 (implementation checkpoint)

Status: in implementation and review. Production durable upload rollout remains disabled. This document replaces neither historical V1 evidence nor outstanding V1 debt.

## Contract

V2 DONE means the application's object-creating write set was frozen, every dispatched object-creating operation was acknowledged terminal, and every exact retired address was observed absent after cleanup. It is a finite application/observation contract, never a provider guarantee of eternal absence. UNKNOWN writes, a missing acknowledgement and lost allocations cannot be relabeled settled by a timeout or successful HEAD/DELETE.

New source reservations are multipart-only. The CREATE response and exact provider upload ID must be durable before granting parts. Exactly one server COMPLETE dispatch is permitted. Read-only metadata reconciliation can accept a matching source for processing without manufacturing a lost provider acknowledgement. V1 browser UploadPart URLs do not bind the declared size. New V2 URLs include the exact expected Content-Length in their SigV4 signature, including the shorter final part. Browser JavaScript cannot set this header: the browser supplies it from the File/Blob body, and grant.headers never includes it. Local signature verification proves the length is authenticated by this implementation; actual R2 enforcement and real-browser compatibility remain separate activation gates. Conservative observable-part reservations remain accounting policy, not a claim of a hard provider physical-byte bound.

Required workers journal each immutable canonical, HLS segment/playlist/master and thumbnail PUT before network I/O. Dispatch is fenced by current owner, lease, generation and privacy state. Terminal provider responses append acknowledgement; timeout/crash retains UNKNOWN or unacknowledged DISPATCHED. Fresh attempts use fresh namespaces. Publication still uses the existing winning-attempt fence. Retired losing attempts enter the existing cleanup worker without touching live winning outputs.

Privacy freezes output attempts and cancels their jobs under the existing account-first order. Provider calls remain outside transactions. New V2 evidence is lease/operation/write-set bound; the forward migration preserves V1 constraints and rejects DELETE-only completion by older workers.

## Capacity and exceptional debt

Active source slots, accepted source processing, observed cleanup and unresolved physical work are separate. Accepted processing and retained audit tombstones do not consume the ten/account or fifty/channel active-upload cap. Distinct finite backlog limits and conservative storage reservations bound outstanding cleanup work. A lost CREATE with no stored ID and no granted parts is allocation-resource debt, not uploaded whole-file bytes. UNKNOWN object-creating writes retain their reservations and exact addresses until acknowledged/reviewed; elapsed retention never releases them.

Normal cancellations can use acknowledged abort and post-grant-cutoff exact multipart/allocation/object absence once all server object-creating dispatches are accounted for. The evidence explicitly describes residual-part observation rather than promising no future bytes. Address tombstones are retained and re-observed through the configured cleanup retention interval; a late object/allocation reopens work, capacity reservation and any privacy completion. Failed attempts use bounded work per pass and slower reconciliation after fast retries, without an automatic uncertainty waiver.

The existing 30-day default retention (configurable 1–365 days) is an audit/recheck window, not settlement proof. A final successful re-observation is required before minimizing resolved addresses. Unresolved debt never expires solely by age.

## Compatibility and rollout

Existing sessions, attempts and cleanup records default to V1. No existing proof or provider outcome is synthesized. Deploy the forward schema and compatible workers before any controlled V2 issuance; rollback must retain an obligation-aware worker. A separate explicit rollout/kill switch remains false by default. Real isolated R2 and real-browser acceptance, including oversized parts, remains required before activation. No live bucket changes or deletion are part of offline verification.

## Required verification

- One dispatch per source CREATE/COMPLETE and per immutable worker address
- Crashes before/after provider acknowledgement and privacy races
- More than fifty successful accepted uploads without active-slot lockout
- Exact owned cleanup, losing attempts and preservation of winning playback
- Unknown-write retention, late residual reopening and final retention recheck
- Forward migration with populated V1 evidence and old-worker rejection
- Isolated PostgreSQL, full unit/integration checks and real-browser offline recovery tests
- Separately authorized isolated live R2/browser acceptance before rollout

## Source admission accounting

`AYIN_UPLOAD_RECOVERY_V2_ENABLED=0` is the default. `AYIN_UPLOAD_RECOVERY_DEBT_ACCOUNT_BYTES` and `AYIN_UPLOAD_RECOVERY_DEBT_CHANNEL_BYTES` (both default 0) separately bound the conservative outstanding-work accounting budget. Zero keeps issuance unavailable even when the switch is enabled: both budgets must be explicitly reviewed and configured as positive safe integers after acceptance. Keep the configured budgets when disabling new issuance so already accepted V2 processing can drain. Historical V1 jobs must keep their original protocol lane and are not subject to the V2 default-zero gate. These are not billing or provider-enforced byte guarantees. New source allocation has zero physical-byte reservation until a browser grant is reserved; unknown grantless CREATE still consumes allocation/uncertainty count capacity. Its pending asset does not consume whole-file bytes even if a crash leaves the state PREPARING. CREATE preflights the ordinary quota; the first grant atomically reserves/rechecks the declaration. Granted declarations and live accepted media remain subject to the ordinary administrator-configured channel allowance.

Before the first V2 part URL can be signed, the transaction reserves 5 GiB for every permitted part number in the declared source. This deliberately covers oversized observed parts rather than trusting browser declarations. It does not bound reusable in-flight requests, bandwidth, or provider charges. Every replacement grant keeps the reservation; acceptance through read-only reconciliation never reduces missing-ACK debt. Retired or uncertain output writes use their immutable server-measured sizes, counted once per address. Source and worker dispatch admission share account-then-channel capacity locks. Completed source cleanup releases this separate accounting reservation; retained DONE tombstones alone do not consume active-source slots.

Exact signed length does not make a URL single-use or cap request volume, transfer bandwidth, account creation, or provider charges. No local verifier or test adapter result can substitute for separately authorized isolated R2/browser acceptance. The browser's automatic body-length behavior is specified in [WHATWG Fetch HTTP-network-or-cache fetch](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch); [Cloudflare's presigned URL guide](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) documents signed-header matching but does not itself certify this application's exact Content-Length/browser combination.

## Bounded canary and reserved processing capacity

Issuance is limited to one explicitly configured account/channel tuple, not all creators. Both UUIDs, the source ceiling (at most 16 MiB), the lifetime processing-output envelope (at most 512 MiB), positive reviewed debt budgets and the disabled-by-default rollout switch are required. The budgets must cover the conservative exposure of the configured maximum source plus the complete output envelope before capability can report support. Capability is authenticated and channel-scoped; the browser supplies its current channel. No actual account/channel IDs or activation settings are included in source.

A global admission lock and outstanding-work check permit only one unretired V2 source. Changing the configured tuple does not bypass existing source uncertainty, queued/failed finite processing, or unresolved output cleanup. Retained resolved tombstones and live acknowledged winning media are distinct from outstanding work. Existing inspection, cancellation, already-transferred completion/reconciliation, and previously reserved processing drain remain available with new issuance disabled; no new browser grant is authorized by that drain path. The UI keeps original-file verification and completion controls available separately from part upload.

The first part grant atomically reserves source exposure and a durable fixed output envelope. The original processing job binds that reservation on acceptance. Every canonical, HLS and thumbnail PUT, including every retry namespace, consumes its measured byte count inside the same database transaction that inserts its dispatch journal. Source admission cannot spend this reserved headroom; an already admitted job does not recheck current issuance limits to consume its allowance. A measured overrun is rejected before provider I/O with an explicit processing-limit failure. Source byte count or duration does not promise that arbitrary transcoded output will fit.

The active envelope is charged once rather than once plus its covered writes. ACK, cleanup and numeric retry resets never refill the lifetime allowance. READY, cancellation and loss of the owning job release only unused future-write headroom; unresolved or retired measured writes remain charged independently. FAILED retryable jobs retain their reserved capacity. Reservation identities and spend cannot be casually rewritten or dropped to reset a budget.

## Completion preflight

V2 COMPLETE first reads and validates the exact multipart inventory without changing the session or creating a dispatch record. A timeout, incomplete inventory or wrong part length leaves the OPEN session retryable and creates no fictional UNKNOWN write. Only after valid inventory does one short transaction recheck ownership, identity, revision, expiry and cancellation, reserve the one COMPLETE dispatch and move to FINALIZING. Provider completion runs after commit. Concurrent requests replay the existing operation or lose the fence; they cannot issue a second COMPLETE. From that real dispatch boundary, missing acknowledgements remain conservative debt. This does not change historical V1 command semantics.

Derived V2 reprocessing/backfill reserves a separate envelope in the job-acceptance transaction. Existing callers may already hold generation locks, so this path tries global/account/channel admission mutexes without waiting; contention rolls back acceptance for an explicit retry. Dispatch never invents a missing reservation. Once admitted, derived jobs also drain from their stored allowance with new issuance disabled.

Reservation snapshots are minimized only after source/job/attempt/write references are gone and any applicable source/output cleanup has passed its final retention observation. A zero-output derived job with no remaining references has no provider address to retain. The database guards this deletion; live or retryable jobs and UNKNOWN writes always preserve their immutable counters. No retained counter is reset to replenish an old job's allowance.
