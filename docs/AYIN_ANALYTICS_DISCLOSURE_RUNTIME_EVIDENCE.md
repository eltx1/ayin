# Analytics first-opening runtime evidence

## Previous gap

Accepted182 measured the lower closed-detail DOM/CPU footprint, explicitly leaving the first native detail opening cost unmeasured. The existing two-profile lab already performs real tab/paging interactions and records the closed-detail baseline. This extension keeps that baseline snapshot intact and then records separate first-open and reopen windows for the first real return-cohort row on page2.

## Measurement contract

For each of three fresh-context samples in each existing desktop-unthrottled and mobile-constrained profile, keyboard Enter opens the actual native details. The test verifies the actual three milestone headings and available fact list, records CDP Script/Task/Layout deltas and heap observations, actual DOM before/after, browser-clock duration through two animation-frame callbacks, and separately named automation duration. A250ms observer-delivery window is excluded from those durations. Buffered long-task/Event Timing entries are recorded without claiming a field percentile or INP. Closing retains mounted read-only facts; reopening is measured independently. Actual API request count must stay unchanged through both toggles.

Baseline route metrics, profile/network compatibility command/calibration, exact source commit/tree, fixture, observer support, raw sample values and query plans remain preserved. No application/runtime code is changed, no fixed performance score is enforced, and no speedup versus another head is inferred. New measurements are lab observations on the CI host, not physical-device or production-user latency promises.

## Verification and acceptance

Local strict browser TypeScript, root test lint and formatting passed. Actual candidate build/browser, raw artifact transfer and independent sample review remain pending. Complete reports will be retained with their actual measured checkout rather than relabelled as a source head. First-opening measurements extend phase10 evidence; other routes, field performance, large-query/pool/provider/player/upload/native/PWA measurements remain open.

## First actual run and observer correction

Candidate `5fed1688` passed quality `37113141326`, security `37113141407`, inventory `37113141315` and browser `37113141284` (job `111174774138`: 141 passed). Actual raw artifact `11271017007` was downloaded and independently parsed; ZIP SHA256 is `71467fb83419e6fcde1e0e5fed19055fa4a72be3192a05a53cd62e3f1e9a0c3f`. Both complete reports are retained verbatim in `docs/performance/2026-10-03-analytics-details-first-open-5fed-desktop.json` and `docs/performance/2026-10-03-analytics-details-first-open-5fed-mobile.json`, with their actual synthetic checkout `20019ca42bdb00ddf897fab6ecff185d4d78f251` and tree `11c4e04899a008de42e88d08cdc5ad7ed75e84cf`. All six Analytics samples add exactly 30 DOM elements on first opening (853 to 883); all six reopenings add zero, and actual API request count remains unchanged by assertion.

Independent raw inspection also found that buffered Event Timing delivered the prior close interaction after the next window started. Therefore the first-run reopen event arrays are historical diagnostic observations, not isolated reopen event measurements. The next candidate records event start times and filters them by the actual browser-clock window rather than observer-delivery index. Long tasks crossing the window boundary are retained by interval overlap. First-run duration/CPU/DOM fields are preserved unchanged, but no first-run reopen Event Timing latency or speedup is claimed. The corrected candidate requires its own actual gates and raw review before acceptance.
