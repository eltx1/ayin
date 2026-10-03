# Creator finance authority transaction evidence

## Actual gap

Creator beneficiary/profile and dispute writes selected an owned nonremoved channel before starting their transaction; payout creation similarly reused prior authority and a channel read without a shared row lock. A membership downgrade or channel removal while the request waited could therefore occur between the early check and the actual write. Existing atomic profile/dispute audit and exact payout ledger-reservation safeguards did not themselves close that authority interval.

## Focused change

A shared finance helper takes the actual Channel FOR UPDATE, checks nonremoved state for Creator mutations and takes the actual qualifying OWNER/ADMIN membership FOR SHARE through commit. Profile and dispute writes recheck this authority inside their existing atomic transactions. Optional disputed payout ownership is checked and held inside the same transaction. Creator payout creation repeats the authority check before beneficiary snapshot, active-payout check and ledger reservation; Finance-created payouts take the same Channel lock while preserving existing Finance settlement permissions. Actual revocation/removal returns403 before a financial write. Server roles, Origin/MFA/step-up, currency/provider/threshold/compliance policy, sensitive destination encryption, exact reserve-count checks and existing audits remain authoritative.

No provider operation runs inside this new lock. Compliance readiness/settings captured before the transaction, provider-side authority changes, privileged role revocation, mutable existing contract paths and global session/device flows remain separate open review items; this slice does not certify them.

## Verification

Local396API units, API types, canonical lint and formatting passed. Four additional real PostgreSQL/AppModule cases extend the existing payout-safety matrix without changing its eight earlier cases: actual membership downgrade and actual Channel removal each while profile/dispute requests are observed waiting on Channel locks; actual creator payout request waiting across membership downgrade, with zero payout/financial audit/ledger reservation; and two actual Finance payout requests blocked behind an independent Channel lock, with exactly one210.123456beneficiary snapshot, ledger reservation and correlated audit. Lock waiting is observed in pg_stat_activity, not inferred from a fixed sleep. Target-scoped counts avoid assumptions about globally persistent Channels.

Candidate PostgreSQL, production build, full browser and final release proof remain pending. No real provider transfer or full master certification is claimed.
