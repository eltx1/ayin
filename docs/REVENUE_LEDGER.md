# AYIN Creator Revenue Ledger

Task 23 implements the repository-side revenue attribution, contract, ledger and payout-readiness foundation. It does **not** execute bank, wallet, card, ACH, wire, crypto or other external payments.

## Money model

Money is stored as PostgreSQL `DECIMAL(20,6)`. Revenue-share calculation uses integer six-decimal micros in application code; JavaScript floating-point arithmetic is never used for ledger money. Creator share is expressed in integer basis points (`10,000 = 100%`).

## Contracts

The global creator split is the `MONETIZATION/defaultCreatorRevenueShareBps` platform setting. A channel may have dated `CreatorContract` overrides. Revenue calculation selects the latest active contract effective for the revenue period end; if none applies, the global Admin default is used. Each revenue ledger entry snapshots the selected revenue-share basis points so later contract changes do not rewrite history.

## Revenue imports and attribution

`POST /admin/revenue/imports` accepts bounded batches with a source name and a per-source idempotency key. The persisted key is unique, so a retry does not create duplicate earnings. Revenue rows can carry channel, video, campaign, ad source and period attribution where the source provides those facts. Video attribution is verified against the channel rather than trusted from the caller.

Imported rows distinguish `ESTIMATED` and `FINAL`. Estimated and final source rows remain separate immutable financial facts. Finalization does not overwrite an old estimate. Manual corrections are new `ADJUSTMENT` ledger rows with a mandatory reason and Admin audit entry.

## Creator reporting

Creator Studio monetization reads directly from the ledger and shows:

- estimated revenue;
- finalized revenue;
- finalized balance not yet assigned to a payout;
- current effective revenue share;
- revenue by video and month;
- payout history/status.

These values are ledger-backed, not fabricated projections.

## Payout readiness

Admin can configure a payout threshold in six-decimal currency micros. Creating a payout record assigns currently unassigned `FINAL` and `ADJUSTMENT` rows for one channel/currency to that payout. The record starts `PENDING`; Admin may move it to `PROCESSING` and then `PAID`, or mark processing as `FAILED`/`CANCELLED`. Failed/cancelled records release their ledger rows for a future payout attempt.

No payment provider is invoked. A `PAID` status is therefore an explicit Admin record of an externally completed payment, not a claim that AYIN transferred funds itself.

## Audit and history safety

Revenue settings, channel contract creation, imports, manual adjustments, payout creation and payout status changes are audited. Historical amounts are never edited to represent corrections; adjustments are additive ledger entries. Payout linkage may change when a pending attempt fails/cancels, but the earnings amount and attribution remain unchanged.
