# Revenue report reconciliation

AYIN Task 69 adds a provider-neutral reconciliation layer between external advertising revenue
reports and the existing immutable creator earnings ledger.

## Import boundary

The active adapter is `MANUAL_VALIDATED_IMPORT`. It accepts either validated structured rows or
CSV. It deliberately reports `automaticProviderSyncConfigured: false`; there is no simulated
Google or other provider reporting API. A future provider adapter can normalize a real authenticated
API response into the same report contract without changing ledger reconciliation rules.

Each report must provide:

- source and stable source report identity;
- reporting period;
- ISO-style three-letter currency;
- estimated or final state;
- stable external source row ID per row;
- gross amount with at most six decimals;
- AYIN channel/video attribution where available, plus an optional external content reference.

CSV requires `externalRowId` and `grossAmount`. Optional columns are `channelId`,
`channelHandle`, `videoId`, `videoSlug`, `contentId`, `adSource`, and `memo`.

## Idempotency and statuses

The database has a unique `(source, sourceReportId)` identity. Retrying the same report returns the
existing reconciliation result and opens no new ledger transaction. Stable external row IDs are
also compared with prior successful reports from the same source.

Rows are classified as:

- **MATCHED** — a new estimated row resolves to AYIN attribution;
- **UNMATCHED** — supplied attribution cannot be resolved safely;
- **DUPLICATE** — the row is repeated in the report or is identical to its prior source row;
- **CORRECTED** — the same external row changed amount without an invalid identity transition;
- **FINALIZED** — a final source row is accepted, including estimate-to-final transitions;
- **ANOMALOUS** — period/currency/attribution identity changes, final-to-estimated regression, or
  contradictory attribution requires review.

## Immutable ledger behavior

Reconciliation never updates historical ledger amounts.

- New estimates append `AD_REVENUE / ESTIMATED`.
- Estimate revisions append only the exact six-decimal estimated delta.
- Estimate-to-final transitions append a negative estimated retirement row and a new
  `AD_REVENUE / FINAL` row. This preserves history while removing the stale estimate from the
  current estimated total.
- Corrections to an already-final source row append `ADJUSTMENT / ADJUSTMENT` for the exact delta.
- Unmatched, duplicate, and anomalous source rows are retained in reconciliation history but do not
  write creator ledger value.

All monetary math uses AYIN's integer micro-unit helpers. No JavaScript floating-point arithmetic is
used for creator revenue or correction deltas.

## Admin operations

The Revenue admin area includes a reconciliation panel for CSV/structured import, adapter
capabilities, report-level status counts, and row-level reasons/attribution. Finance operators can
inspect unresolved or anomalous rows without changing historical ledger entries.
