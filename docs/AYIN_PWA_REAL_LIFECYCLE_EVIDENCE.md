# AYIN real PWA lifecycle acceptance

## Concrete problem and behavior

The prior update controller reloaded only its accepting tab, but a dismissed native unsaved-work warning left no usable refresh action after activation; another open tab received no notice that its old document could now be refreshed. A late activation after the existing10-second deadline could likewise become invisible. The controller now distinguishes a waiting update from an activated update awaiting a deliberate document refresh. Only the currently accepting tab requests reload at activation. If the browser cancels that reload, the refresh action remains available. Other tabs and late activation expose that same explicit action without automatic navigation. A synchronous acceptance guard prevents duplicate skipWaiting messages, and thrown postMessage recovers the controls. Initial service-worker claim does not show a spurious update notice.

The production worker remains the existing static-only v3. No authenticated document/API caching, provider policy, permission, cookie, destination or production test endpoint is added.

## Actual software test design

A separate Playwright configuration starts the existing production Next bundle behind a test-only loopback proxy on3100, production Next on3102 and the real AppModule API on3001 with origin3100 and isolated local ayin_e2e PostgreSQL. The proxy refuses startup without explicit AYIN_E2E_PWA=1 and that isolated database. It serves the actual v3 worker source and controlled byte changes for v4-test and v5-late-test. Only the late fixture delays skipWaiting15seconds to exercise the unchanged10-second UI deadline. A deliberately minimal legacy-behavior worker creates the known v2 owned-cache namespace; it is not a claim to reproduce the exact historical worker. All app documents, bundles and authenticated API interactions remain real.

Five additional real Chromium journeys cover EN/AR two-tab channel editor drafts, actual waiting/activation, dismissed native beforeunload and subsequent explicit refresh; deadline recovery followed by late activation without navigation; migration into the actual v3 worker with owned unsafe-cache purge and preservation of a foreign cache; and acknowledged real logout plus reopened offline private-route navigation exposing only the neutral bilingual document. Existing two PWA acceptance cases remain unchanged. JSON proofs contain scope, cache paths/names and navigation counts, not cookie, authentication material, private draft text or account details. Actual new screenshots are preserved by the existing visual artifact workflow.

The original browser matrix and controlled performance host remain on3000. The additional lifecycle matrix runs sequentially after the existing gate, uses a separate output/report directory and is not a production performance comparison.

## Local and external evidence

Local strict browser/config TypeScript, canonical Web React lint/types, root fixture/config lint, proxy syntax and the19 existing worker safety units passed. Actual PostgreSQL/production-build/full browser lifecycle, final visual inspection and release proof are pending for this candidate. No pending journey is reported as passed.

## Limits and remaining master scope

This extends software acceptance. Real Android/iOS/Safari installed-app startup, OS installation prompts, device background/resume and store/provider certification remain open. The worker version fixture does not prove a deployed changed application asset release. Global multi-tab account-change/draft routing, field performance, full phase9/15 gates and the whole master consolidation remain open.
