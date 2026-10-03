# Admin overview source review and acceptance evidence

This focused Phase7 candidate replaces the English all-or-nothing Admin dashboard. It does not complete the entire master or all Admin/financial controls.

## Source findings and corrections

The previous dashboard duplicated the shared session read/navigation definitions, cast unchecked dashboard data, hid the whole page when any summary failed, exposed raw failures without retry and showed English/unlocalized links. Search combined initial/empty/error states and could retain results for an edited query. Finance copy always claimed manual-only mode even though the API supports a truthful provider/manual mode.

The candidate reuses the verified shared access provider and canonical role-filtered navigation. It validates known role/session identity and bounded presentation contracts, uses independent cancellable counter/analytics/health/finance reads with bounded15s recovery, and keeps failed summaries distinct from actual zero. Scoped nonfinance roles do not request finance summaries. Real server authorization, MFA, ownership and audit are unchanged.

Shared EN/AR headers/actions/notices/metrics/tables and locale-safe links provide one overview. Primary workspaces are upfront; secondary controls and cohort/queue detail use native disclosures. Cohorts retain the server privacy threshold and scheduled UTC reporting range. Finance uses exact decimal strings and actual mode/connection/production flags; configuration is not payment completion or provider certification.

Search has explicit idle/loading/error/real-empty states, aborts old requests on input/account changes and synchronously blocks duplicate submits. Only matching-query bounded results with known-kind internal destinations render. Validated access identity keys the dashboard, preventing late prior-account summaries from crossing access changes.

## Validation scope

Local pinned-command Web301 unit tests, Web lint/types and production build passed before the final new browser tests; existing instrumentation Edge warnings remain. Full frozen exact-head quality/security/browser/inventory and screenshot review are pending. New browser acceptance uses real scoped staff, backend finance denial/no-request behavior, real search records and real administrator MFA. Failure injection is explicit; unknown-role payloads fail closed. No production performance, external payout, physical-device or whole-phase7 acceptance is claimed.
