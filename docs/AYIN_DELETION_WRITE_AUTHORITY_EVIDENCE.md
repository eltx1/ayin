# Deletion request current authority and credential race

## Actual source finding

The privacy deletion handler authenticated a session, passed only account/session IDs, verified a password outside the transaction and created the request without rereading current account/session/password under locks. Account status/authVersion, session revocation/expiry or a newer password could win while the command was pending.

The controller now passes the complete captured authenticated context. The service checks its authVersion before initial password verification, then locks Account FOR UPDATE followed by the current AccountSession FOR SHARE. After any wait it rereads ACTIVE account status, matching captured account/session authVersion, actual session ownership, revocation and expiry against the actual current clock. A password hash different from the hash already verified rejects with 409 PASSWORD_CHANGED. The request and its audit remain in one transaction. Existing confirmation, response, active-request uniqueness, cancellation, worker/retention/media cleanup and financial preservation behavior remain unchanged.

## Authored proof and current limits

Ten real PostgreSQL cases are authored: observed account-row waits for account status/authVersion, session authVersion/revocation/expiry/deletion, actual clock expiry while blocked and a winning password; actual audit-trigger rollback followed by one explicit retry; and two actually observed concurrent verified requests yielding one request and one audit. Tests use real registered sessions/passwords and actual database changes, never an invented authenticated context. Execution and owning final quality/browser gates are still required; authored tests are not claimed as passed.

Production API declaration build, focused lint and formatting passed locally. The separate session scope/freeze client covers the security panel only. Privacy UI response validation, known-write versus failed-refresh recovery, sensitive export bounds and cross-panel account/lifecycle coordination remain open. Cancellation and other privacy/domain mutations need their own current-under-lock review. This change does not certify full deletion, legal retention compliance, physical devices or any complete master phase.
