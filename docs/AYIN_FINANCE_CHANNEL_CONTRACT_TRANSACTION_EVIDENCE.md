# Finance contract/channel transaction evidence

## Concrete problem

Finance contract creation previously checked channel existence outside its transaction, then inserted a contract and audit without locking or advancing the channel aggregate version. A channel-management draft could therefore remain apparently current after an independent Finance contract changed the visible contract. This also used a different serialization boundary from creator/channel-management mutations.

## Change

The existing Finance-only contract endpoint validates its existing contract schema and channel UUID before any write. Inside one real database transaction it takes the same Channel row FOR UPDATE, rechecks existence, inserts the contract, records the existing CREATOR_CONTRACT_CREATED audit and advances Channel.updatedAt monotonically, using the larger of the transaction timestamp and the observed timestamp plus one millisecond. Channel fields, contract terms, zero basis points, actor scope and response shape are preserved. Missing channels return404 and invalid input400 without exposing database errors. Failed audit insertion rolls back the contract and version change together.

The observed channel version can now detect Finance contract creation in addition to channel-editor writes. No provider, payout, imported financial record or legal term is reinterpreted. Independent edits of existing contracts or other aggregate mutation paths are not certified by this change.

## Verification

Local396API units, API types, canonical lint and formatting passed. Three additional PostgreSQL/AppModule tests cover two real Finance requests observed waiting in pg_stat_activity behind an independently held Channel lock, exact zero/nonzero contract values and two correlated audits, monotonic observed version changes; injected audit-trigger failure with rollback and subsequent actual success; and creator denial plus Finance invalid-ID/missing-channel/invalid-share failures without writes. The controlled holder advances its observed timestamp to exercise millisecond monotonicity without relying on fixed sleeps.

Actual candidate clean PostgreSQL, production build, browser regression and release proof remain pending. These tests are not a provider transfer or whole-master certification.

## First real gate correction

Actual da09 quality37111251361 reached665passed/3failed PostgreSQL cases. All three newly added tests incorrectly assumed registration starts with zero CreatorContract rows; actual registration intentionally creates an initial contract, and persistent Channels/contracts survive Account truncation. Requests correctly blocked on real Channel locks, and audited failure/permission/invalid/missing statuses matched. The revised tests capture actual pre-operation contract counts and assert exact deltas/unchanged state scoped to the real target, preserving all lock, version, audit and rollback assertions. No product default or registration behavior changes. Revised gate acceptance remains pending.
