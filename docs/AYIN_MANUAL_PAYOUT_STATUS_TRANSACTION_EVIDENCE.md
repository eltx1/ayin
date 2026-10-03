# Manual payout status transaction evidence

## Actual gap and change

The live Admin Revenue controller calls `RevenueService.updatePayoutStatus`. Its existing transaction read the payout without a row lock, then checked the transition and wrote the payout, released ledger reservations for failed/cancelled outcomes, and wrote the audit. Two simultaneous paid/cancelled decisions could both validate the same PROCESSING snapshot. Atomic audit alone did not serialize these decisions.

The candidate validates the existing strict status schema and UUID before starting the transaction, locks the actual Payout row with a parameterized `FOR UPDATE`, and reads provider/status after obtaining that lock. Missing records return404; malformed requests400; provider-managed manual changes and incompatible transitions409. Existing valid transitions, same-state behavior, exact amounts, encrypted beneficiary snapshot, Finance/MFA/reauth/Origin guards, audit fields, and notifications after commit remain unchanged. The row lock persists through status, ledger-reservation release and audit commit. No external transfer is initiated or simulated.

## Actual PostgreSQL acceptance contract

Four AppModule cases retain all prior payout-safety coverage and add independent real transaction evidence:

- Hold the actual Payout row and observe two tagged waiters in `pg_stat_activity`; competing PAID/CANCELLED requests produce exactly one200 and one409, one correlated audit and one notification. Final reservation is retained for PAID or released for CANCELLED, matching the actual winning outcome and exact210.123456 amount.
- Change actual provider ownership while the manual request waits; after the lock it receives409 with no status/reservation/audit mutation.
- An isolated real audit trigger raises on PAYOUT_STATUS_UPDATED: the API500 leaves PROCESSING and the original ledger reservation, zero audit/notification. Removing the trigger permits the actual next cancellation to commit once.
- Actual unauthorized actor403, invalid UUID/status400, missing payout404 and terminal reversal409 leave no second audit or reservation release after PAID.

Waiter observation synchronizes actual requests; no fixed sleep substitutes for a race proof. Test-only rows and the narrow audit trigger are confined to the isolated test database. Local source type/lint/unit verification and final-head CI/PG/browser verification are reported separately; actual PG acceptance, review, deployment and exact release proof are pending until completed.

## Remaining limits

This protects manual payout transition serialization. Provider state machines, staff permission revocation inside long transactions, cross-provider workflow policy, compliance/settings races, full financial history, physical devices and the complete master plan remain separate open work. No provider payment, legal approval or universal finance certification is claimed.
