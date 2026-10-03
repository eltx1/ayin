# Payout compliance after transaction lock waits

## Actual gap and correction

The live beneficiary-snapshot payout service checked compliance before its Channel transaction lock. A request waiting behind another writer could therefore reserve earnings after the stored required identity/tax/destination state changed. The separate Admin compliance override also read its audit `from` state before the transaction, so consecutive overrides could audit the same stale predecessor.

The candidate prepares the existing asynchronous compliance requirement/provider boundary before holding transaction locks. It then holds the actual Channel and profile rows, reads the actual beneficiary profile, verifies that channel/country/payout-provider context still matches the prepared requirement context, and evaluates current stored compliance states before creating any payout or ledger reservation. Changed context or newly blocked compliance returns409 before financial/audit/notification mutation; an explicit new request must obtain fresh requirements. No additional provider requirement call or external transfer runs while those locks are held. The existing provider-specific readiness, snapshot encryption, exact-money/threshold rules, ledger reservation and permissions remain intact.

Admin compliance override now takes the same Channel lock and actual profile row FOR UPDATE, and reads its previous field inside that transaction before the existing update/audit. All prior valid compliance statuses and reason/safe metadata remain unchanged. Its separate post-commit status reread and external workflow semantics are not falsely declared atomic with the write.

## Actual acceptance contract

Three new AppModule/PostgreSQL cases retain all twelve preceding payout-safety cases:

- Actual Creator and Finance payout requests wait on an independently held Channel; the holder changes required identity from the controlled VERIFIED fixture to REJECTED. Both must return409, with no payout, released/reserved entitlement, correlated payout audit or notification. The controlled requirements adapter is called exactly once per request before the observed lock wait.
- Change the actual payout requirement context country while a request waits:409 reports context changed, no payout/reservation, and no second requirement call inside the locked transaction.
- Two real Finance compliance overrides wait behind the same held Channel, then both commit. Exactly two correlated audits form a chain from the actual VERIFIED fixture through the first outcome to the actual final stored outcome. No raw identity/tax/bank data is accessed or logged.

The controlled identity requirement and initial VERIFIED state are isolated test fixtures, not provider or legal approval. Waiter observation uses actual pg_stat_activity rather than fixed sleeps. Local396 API source units/type/lint/format are checked separately from final-head PostgreSQL/browser/review/deployment proof, which remains pending.

## Remaining limits

Prepared requirements are a bounded external snapshot, not an atomic guarantee of future provider/legal configuration. Platform threshold/settings changes, full staff/session/MFA revocation, provider submission/status workflows, post-commit reread failures, global identity/history/physical devices and complete financial/master certification remain separate open work.
