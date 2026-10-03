# Analytics first-opening runtime evidence

## Previous gap

Accepted182 measured the lower closed-detail DOM/CPU footprint, explicitly leaving the first native detail opening cost unmeasured. The existing two-profile lab already performs real tab/paging interactions and records the closed-detail baseline. This extension keeps that baseline snapshot intact and then records separate first-open and reopen windows for the first real return-cohort row on page2.

## Measurement contract

For each of three fresh-context samples in each existing desktop-unthrottled and mobile-constrained profile, keyboard Enter opens the actual native details. The test verifies the actual three milestone headings and available fact list, records CDP Script/Task/Layout deltas and heap observations, actual DOM before/after, browser-clock duration through two animation-frame callbacks, and separately named automation duration. A250ms observer-delivery window is excluded from those durations. Buffered long-task/Event Timing entries are recorded without claiming a field percentile or INP. Closing retains mounted read-only facts; reopening is measured independently. Actual API request count must stay unchanged through both toggles.

Baseline route metrics, profile/network compatibility command/calibration, exact source commit/tree, fixture, observer support, raw sample values and query plans remain preserved. No application/runtime code is changed, no fixed performance score is enforced, and no speedup versus another head is inferred. New measurements are lab observations on the CI host, not physical-device or production-user latency promises.

## Verification and acceptance

Local strict browser TypeScript, root test lint and formatting passed. Actual candidate build/browser, raw artifact transfer and independent sample review remain pending. Complete reports will be retained with their actual measured checkout rather than relabelled as a source head. First-opening measurements extend phase10 evidence; other routes, field performance, large-query/pool/provider/player/upload/native/PWA measurements remain open.
