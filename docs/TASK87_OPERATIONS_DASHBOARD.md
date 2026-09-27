# AYIN Task 87 — Operations Dashboard and Unit Economics

Task 87 is the final task in the current Production Evolution Roadmap. It gives authorized AYIN staff one evidence-based operating view at `GET /admin/operations/dashboard` and in Admin → Operations.

The dashboard does not turn missing data into zeros that look authoritative. A metric is either backed by an existing AYIN fact, explicitly configured by an operator, or marked unavailable.

## Metric sources

### Product

The complete 30-day UTC window uses Task 82 rollups.

- DAU approximation: unique analytics sessions on the last complete UTC day.
- MAU approximation: distinct Task 82 platform session hashes across the last 30 complete UTC days.
- Watch hours: summed `AnalyticsPlatformDailyRollup.watchTimeMs`.
- Uploads: summed platform rollup uploads.
- Active creators: distinct non-removed channels that created a non-removed video inside the complete 30-day window.
- Active videos: currently published, non-removed videos.

The dashboard labels DAU/MAU as approximations because the existing privacy model intentionally does not invent a persistent anonymous cross-context identity.

### Media

- Current queue depth and oldest queued age: Task 43 observability over the Task 85 PostgreSQL queue.
- Active jobs/global concurrency/workers: Task 85 queue and worker registry.
- Processing duration/failure rate: terminal `MediaProcessingJob` rows created in the complete 30-day window.
- HLS readiness: published playable videos that have a READY playback generation, READY fallback, READY HLS master and at least one READY HLS rendition.
- MP4 fallback rate: Task 82 channel rollup fallback events divided by video starts.
- Generated storage: READY canonical processing output bytes plus READY HLS output bytes.
- Uploaded content hours: duration of READY processing jobs in the 30-day window.

### Infrastructure

- API p50/p95/max and HTTP status classes: Task 43 in-process observability window.
- PostgreSQL health/connection pressure: Task 86 PostgreSQL snapshot and bounded pools.
- Worker capacity: Task 85 worker registry.
- Backup status: Task 44 verified local status file, default `/home/ayin/backup-status/latest.json`.
- Synthetic status: Task 45 external report only when a trusted process mirrors it to `AYIN_SYNTHETIC_STATUS_PATH`. Otherwise the dashboard says unavailable/external instead of green.

### Advertising

The 30-day advertising view reads authoritative `AdEvent` facts:

- REQUEST
- FILL
- IMPRESSION
- START
- ERROR

A qualified play for Task 87 RPM-style reporting is an `AdEvent.IMPRESSION`.

**No-fill is intentionally unavailable.** AYIN does not currently persist an authoritative `NO_FILL` fact. `REQUEST - FILL` is not presented as no-fill because retries/multiple event semantics could make that inference wrong.

### Revenue

The 30-day window reads `EarningsLedgerEntry` by currency:

- estimated gross revenue where `grossAmount` exists;
- finalized gross revenue where `grossAmount` exists;
- estimated creator share from immutable `amount`;
- finalized/adjustment creator share from immutable `amount`.

Each gross figure carries a completeness flag. Missing `grossAmount` facts are not silently replaced.

Payout liability is:

1. finalized/adjustment creator-share ledger amounts not assigned to a payout, plus
2. PENDING/PROCESSING payout amounts.

Paid, failed and cancelled payout records do not remain in current liability.

## Provider-neutral cost model

Task 87 introduces `OperationsCostAdapter`. The built-in adapter reads protected Platform Settings; a future real billing adapter can implement the same interface.

Cost categories:

- compute;
- database;
- object storage;
- billable media delivery/egress;
- live/FAST provider;
- external AI/search services;
- monitoring.

The model modes are:

- `UNCONFIGURED` — no cost/unit-cost claims;
- `MANUAL_ESTIMATE` — operator-entered planning assumptions;
- `MANUAL_ACTUAL` — operator-confirmed actual values.

Every monthly category, the mode and currency must be explicitly stored before the cost model is considered complete. Defaults do not make the model complete.

AYIN never performs implicit FX conversion.

The optional media-processing compute-hour rate is separate from monthly total cost. It is used only to estimate processing cost per uploaded hour and is not added again to total monthly cost.

## Unit metrics

When the underlying facts are valid:

- **cost per watch hour** = complete configured monthly costs / 30-day watch hours;
- **storage cost per active video** = configured monthly object-storage cost / active published videos;
- **processing cost estimate per uploaded hour** = measured processing wall-clock hours × configured processing compute-hour rate / uploaded content hours;
- **revenue per thousand qualified plays** = complete finalized gross revenue × 1000 / AdEvent impressions.

Gross margin is shown only when all of these are true:

1. cost mode is `MANUAL_ACTUAL`;
2. every cost category, mode and cost currency were explicitly stored;
3. revenue has exactly one currency matching the cost currency;
4. finalized gross-revenue coverage is complete.

Then:

`gross margin amount = finalized gross revenue - finalized creator share - actual configured operating cost`.

Without those conditions, gross margin is **Unavailable**.

## Alert thresholds

Protected Platform Settings control these initial danger thresholds:

- API p95 latency: default 1000 ms;
- API 5xx rate: default 200 bps (2%);
- PostgreSQL connection utilization: default 8000 bps (80%);
- oldest media queue age: default 600 seconds;
- verified backup age: default 36 hours.

Task 87 also raises critical evidence-based alerts when:

- media processing is enabled but no fresh Task 85 worker exists;
- latest backup status is failure;
- mirrored synthetic report reports confirmed failure.

Unavailable backup/synthetic evidence becomes a warning, not a fabricated healthy result.

## Access

`/admin/operations/dashboard` is protected by AuthGuard + AdminGuard and requires OPERATIONS or FINANCE_MANAGER scope; privileged ADMIN/SUPERADMIN behavior remains governed by the existing AdminGuard/MFA policy.

Cost inputs and alert thresholds are edited through the existing protected Admin Platform Settings path and retain its audit/validation controls.

## External evidence

Task 87 does not:

- fetch provider invoices;
- query a hidden billing account;
- infer Cloudflare/AWS/Mux/Google costs;
- infer no-fill;
- infer FX;
- invent capacity numbers;
- route reads to replicas.

Those require explicit future evidence or adapters.
