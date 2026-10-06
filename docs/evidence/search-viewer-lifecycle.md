# Search autocomplete and authenticated viewer policy

Final source/test commit: `ffe3ae9ee754bf459c6fc2849e61c3e70771a77b`
Base: `da65339a4efa088866c17f9309e00495bcae7423`
Evidence packet: `ayin-search-suggestions-evidence` (manifest, aggregate patch, logs and screenshots).
Branch: `fix/search-suggestion-lifecycle`

The initial screenshot defect is fixed. EN/AR initial results and dismissed results show the first card/row unobscured. Suggestions open only through interaction. Native Tab, Arrow Up/Down, Enter, Escape, outside pointer/focus, clear, submission and selection are covered. Debounced/in-flight responses cannot reopen a dismissed or superseded popup. The popup uses the existing native input and linked list, with bounded content/height; no new UI system or ranking changes.

## Confirmed policy contract and correction

Before this change, ordinary Search/suggestions ignored authentication in the API as well as omitting cross-origin credentials in the browser. Only explicit `/kids` routes supplied Kids context. The public Search page also fetched anonymous results in SSR. API session cookies are host scoped, so forwarding web-origin cookies alone would not establish the production viewer profile.

All five Search endpoints now use the existing OptionalAuthGuard pattern and the server-owned, current, nondeleted default-profile semantics used by public Product Controls. The new Search-specific context service checks the default profile before and after the asynchronous search. Explicit Kids routes only add restrictions. `expectedProfileId` is a UUID equality fence against the authenticated current default; it cannot select a foreign/nondefault profile. Missing, deleted, stale or mid-read changed profiles fail closed with 409. Lens continues through its existing policy-filtered lexical/semantic paths.

Search SSR now contains only query/cursor and neutral presentation. Browser results and suggestions wait for the existing shared viewer coordinator to verify an authenticated or anonymous audience. The coordinator's existing private `isIdentityCurrent` semantics are unchanged; its same epoch now also exposes a verified public audience lease. Reads include credentials, the existing expected-account header and the profile equality fence, prohibit redirects, bound response bytes and validate the renderer's DTO/link contract. Malformed 200 responses show unavailable or no suggestions rather than crashing. Existing synchronous concealment covers both result and suggestion wrappers before identity suspension.

TrustedRegionService and trusted edge headers remain authoritative. Browser code makes no country/Kids claims; unknown region remains conservative. Core navigation still maps Search to `/search`, so ordinary Search must apply the authenticated Kids default. CSP, origins, permissions, production data and provider activation are unchanged.

Independent review also found that Escape bubbled to the existing TV Back handler. Active autocomplete now consumes Escape; a second Escape outside the interaction retains the TV Back behavior.

## Verification

- Own frozen/offline dependency install, local hardlinked immutable package graph with independent mutable pnpm metadata.
- Own Prisma generation and package/API production builds passed. Those source trees are byte-equivalent between c301a65b and final ffe3ae9e, recorded in `api-package-source-equivalence.log`.
- Exact final Web production build and its TypeScript stage passed.
- Full Web unit suite: 839/839 across 124 files.
- Focused API units: 67/67; focused API type/lint checks passed.
- Real isolated PostgreSQL/API suite: 35/35 across 4 files, including 17 new authenticated default-profile, Kids, foreign/stale/deleted profile, invalid/revoked session, trusted-region and mid-read policy cases.
- Real Chromium browser suite: 47/47, 0 skipped, 0 flaky, 0 unexpected.
  - Catalog Search EN/AR at 1440 and 390 px: 1 test traversing all four layouts, separately verifying suggestions, complete ordered result cards, exact pagination and Back/Forward URLs.
  - New Search viewer/lifecycle tests: 8, including held query/locale/account/profile responses, synchronous concealment, neutral authenticated Kids SSR, native keyboard/dismissal, malformed 200s and controlled webOS Escape routing.
  - Existing shared Home hero lifecycle: 10.
  - Existing player identity/progress lifecycle: 27.
  - Existing localized CORS contract: 1.
- Final scoped Next/Web lint, API/E2E lint, formatting, strict focused E2E typecheck and diff check passed. Git tree is clean.

The first full unit attempt exposed obsolete Search SSR test expectations and an unrelated upload test's localhost-only fixture expectation under the browser API environment. The old result artwork/Arabic/canonical-link assertions were retained against the same extracted presentation component, with new neutral SSR/audience-error assertions. The unit stage uses its normal API default; browser remains on the verified 127.0.0.1 configuration. Original attempt logs are preserved. No product origin/security setting was changed.

## Actual screenshots and keyboard evidence

`browser-results/catalog-search.acceptance--42242-s-its-stable-bounded-window-chromium/` contains initial, intentionally focused suggestions and post-Escape results for all four layouts:

- `global-search-initial-390-en.png`: complete first card visible on initial mobile load.
- `global-search-initial-390-ar.png`: same initial Arabic mobile proof.
- `global-search-1440-ar.png`: full first Arabic row visible after Escape; input retains focus.
- `global-search-suggestions-1440-ar.png`: intentionally opened native suggestion link with visible keyboard focus ring.

Additional actual screenshots capture EN/AR Tab traversal, authenticated Kids ordinary search and profile-switch late-response rejection. All 16 screenshots are hashed in `manifest.json`. The native keyboard assertions are in the passing browser report, not inferred solely from images.

## Runtime and limits

All tests use synthetic accounts/content and an isolated loopback PostgreSQL database. Response-delay tests retain actual API payloads; only explicitly malformed-response tests fabricate payloads. The TV case exercises the production webOS handler with a controlled platform marker, not physical TV hardware. Existing player tests control media readiness/time events and do not establish decoded-media performance. Native/performance/device evidence remains separate.

The final production build reports two pre-existing instrumentation Edge Runtime warnings. It succeeds. No new warnings from the Search change were observed.

After completion, own API/Web processes were stopped, ports 3000/3001/55673 verified closed, PostgreSQL pid gone and own cluster directory removed. `runtime-status.json` records the cleanup. Heavy runtime slot was handed back to Admin Ads. The minimum free-space floor was maintained; final free overlay was approximately 2.56 GiB.

Publication and downstream release integration remain with the parent task.
