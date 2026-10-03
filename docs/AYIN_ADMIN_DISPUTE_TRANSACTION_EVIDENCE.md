# Admin revenue dispute transaction evidence

## Actual gap and focused correction

Accepted187 made Creator dispute creation/audit atomic. The separate live Admin Revenue decision path still called the repository UPDATE outside a transaction and inserted `revenue.dispute_updated` afterward. An actual audit failure could leave a resolved/rejected dispute despite an API500 and no correlated audit.

The repository update accepts an optional transaction client, preserving its existing default for compatibility. `CreatorFinanceService.updateAdminDispute` now uses one actual database transaction for the existing parameterized UPDATE and correlated audit. Existing status/resolution/resolver/date/reopening semantics, role/MFA/Origin checks and reason metadata remain intact. Existing controller notification delivery occurs only after that transaction returns. No financial ledger/provider action is added.

## Verification contract

Three actual AppModule/PostgreSQL cases exercise a narrow audit trigger failure and recovery, valid resolved→reviewing semantics with two correctly correlated audits, and Creator/Operations403 without dispute/audit mutation. The failure case checks the entire original stored record, including timestamps/resolution/resolver, zero audit and zero resolved notification; after dropping the isolated trigger, one real decision/audit/notification succeeds. Existing Creator atomicity and financial-authority cases remain unchanged.

Local API source types, lint and units are checked separately from actual final-head CI/PostgreSQL/browser evidence. Acceptance/review/deployment proof is pending until those complete. This closes the Admin decision/audit commit boundary; stale-review version handling, staff revocation during a transaction, protected native Admin finance UI, provider/compliance/global identity/device and complete master gates remain open.
