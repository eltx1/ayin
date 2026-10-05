# AYIN public discovery and detail checkpoint

Date: 2026-10-05. Baseline: `bd8f2f637d5020b2d567743503bc192a5fa47189`.

This is a bounded public Home merchandising, Search presentation and Movie/Series detail slice. It does not certify the entire Viewer redesign, production provider connectivity, native devices or deployment.

## Public hero contract

- VIDEO resolution uses the existing `publicVideoEligibility` SQL boundary: public publication, nonremoved video and active/nonremoved channel, validated nonremoved canonical MP4 media, and the authoritative territory/rights/override/Kids policy. Unlisted videos are never public merchandising.
- CHANNEL requires active/nonremoved state. PLAYLIST requires public visibility, nondeleted state and an active/nonremoved channel. CREATOR_TV requires active/non-disabled state and its channel's current primary TV identity. Container destinations retain their existing policy-filtered content/empty-state contracts; this does not assert that every public container has playable items.
- Canonical paths are `/watch/{slug}`, `/c/{handle}`, `/c/{handle}/tv`, and `/c/{handle}/playlists/{slug}`. Route segments are encoded, and current handles are read rather than stored in the promotion.
- Only trusted edge-derived territory influences availability. Regional-personalization permission is not a rights bypass. The public response and errors are `private, no-store` with `Pragma: no-cache`.
- The optional-auth guard delegates every supplied session to the existing `AuthGuard`, including current session authority, explicit bearer-versus-cookie precedence and expected-account narrowing. It uses the existing cookie-transport predicate. A malformed/blank/stale explicit credential cannot become an anonymous unrestricted read.
- The shared Web Home controls read includes credentials. Its server-owned default profile lookup matches the existing Web Home request, which sends no selected `profileId`. Kids classification is current, fail-closed and cannot be relaxed by a query or `FORCE_ALLOW`. Only eligible individual videos are promoted in Kids context, retaining `?kids=1`. Missing/deleted default profiles suppress promotion.
- Unavailable entity selectors are removed from the public snapshot, including their IDs. Authorized Admin snapshots retain the editable selection. The read does not change the stored configuration or add admin audit actions.

## Viewer presentation

- ManagedHero consumes ViewerProductProvider instead of issuing a duplicate product-controls fetch. Loading, failure, retry and null-content states are explicit. Retrying clears stale configuration immediately; invalid hero presentation contracts cannot become actionable links.
- Home defaults, entity labels and actions use route-scoped EN/AR dictionaries and locale-aware links. Authored titles/descriptions are preserved. Missing descriptions use localized presentation copy. Long titles wrap without truncation and RTL text uses automatic direction.
- Search supplies existing media-object URLs to MediaCard, preserving its failed-image fallback. Result type labels are localized; authored titles/metadata are not translated. Network failure uses the localized unavailable state.
- Movie and Series detail controls, minutes, episode/season defaults, accessibility labels and absent-content metadata are localized. Authored season titles, synopses, genres, ratings and artwork alt text are preserved. Actions join the existing TV focus semantics.
- The mobile long-title keyboard path includes an unobscured-target assertion against the actual fixed navigation, in addition to document overflow checks. A measured native-focus defect placed a 53px action at y778–831 in an 844px viewport under the fixed tabs. CSS margins and nearest scrolling left it covered. A Home-scoped next-frame painted-target check now centers only a covered, connected, still-focused action. Fully visible targets and newer/unmounted focus are not moved; four unit cases and the default-motion browser path cover these boundaries.

## Regression evidence

The first nine API tests were executed against an isolated pristine baseline source tree and all nine failed actual assertions. This reproduced unlisted and policy-ineligible disclosure, removed-channel promotion, retained unavailable selectors, incorrect canonical TV paths, absent Kids context and malformed-session anonymous fallback. Fixture schema errors encountered during initial test authoring were corrected before this recorded baseline.

The final focused API suite has ten real PostgreSQL/Nest tests, including an additional actual bearer audience versus conflicting Kids cookie case. It exercises all four canonical detail APIs; mutable rights, channel, profile, handle and TV state are re-read on subsequent requests.

The original four ManagedHero presentation tests failed before the UI fix and passed afterward. Additional presentation/contract tests cover nullable and invalid heroes, Kids links, authored content, Search artwork and EN/AR detail rendering.

## Prepublication lifecycle correction

Independent review of candidate `cd89d45307cd8197027f50b813ef2f555dccfe23` caught a persistent-layout regression: Home → Search → Home reused a previously eligible hero after the real video became private. The production-build baseline test retained the original title/action for its entire ten-second assertion window. The candidate was held rather than published.

The provider now owns a revisioned snapshot per pathname activation. A route change clears policy-sensitive state during the provider render before cached children can receive it. Response application requires both the current pathname and revision, so an older Home read cannot become current after Home → Search → Home. Each activation has one provider-owned product-controls/navigation pair; ManagedHero still performs no fetch. Existing independent identity consumers are not represented as deduplicated.

Hidden/blur/pagehide events synchronously clear and suspend the snapshot. Visible/focus restoration resumes a fresh read. Persisted pageshow explicitly revalidates and never resumes a hidden document. Initial hidden documents also wait for visibility. Same-Home sign-out revalidates server truth after its request settles, including an uncertain response. These are read-only lifecycle changes, not automatic retries of mutations.

The first seven lifecycle browser journeys pass:

- Soft Home → Search → Home after a PRIVATE change, with the new response held while every painted Home frame is checked for stale title/action
- Actual Back/Forward with administrative revocation and rights expiry
- An actual login cookie and a changed, owned default Kids profile, including return to adult mode
- Overlapping soft returns, releasing the newer eligible hero before an older response
- Persisted-pageshow and hidden-to-visible handlers against current API policy; these lifecycle events are explicitly simulated, not genuine BFCache/device certification
- Current owned session revocation, returning 401 without reviving the old hero
- Same-Home sign-out and current private-policy refresh without navigation

Document-lifetime markers and navigation request baselines reject full-reload shortcuts. Real product-controls responses are only delayed, never fabricated. The original three EN/AR/keyboard/detail journeys also pass unchanged, with all 36 original images recaptured on the corrected build.

A second independent prepublication review found a late-callback hole in candidate `0ab2a5d97cde13f62095afe008b0ec7d80f55230`: a logout response settling while hidden called ordinary retry, which incorrectly resumed the provider. The reviewer reproduced a second hidden read and the old hero surviving a later private-policy change and foreground restoration. That candidate was also held.

Ordinary invalidation now preserves suspension, and the reset helper requires an explicit suspension argument. Only a visible, focused restoration can resume reads; a persisted pageshow has its own explicit resume path. Three additional browser cases cover successful and uncertain delayed logout completion while hidden, plus visible persisted-pageshow resume and ordinary visible retry. These use actual logout/policy APIs, with explicitly simulated document lifecycle signals. The reviewer replayed the unchanged intended-contract regression from red to green and independently passed all 13 committed browser journeys together on source `a8b97478ab17c3113a9a307cdd5a1abdf344e8e2`.

## Local validation

- PostgreSQL 17, freshly migrated isolated test databases, UTC database timezone.
- API unit suite: 426 passed across 100 files.
- Web unit suite: 579 tests across 98 files, including four focus lifecycle cases; final aggregate verification is recorded in the release handoff.
- Related real API integration: 38 passed across hero, discovery, public-policy-cache and public-channel-playlist suites.
- API TypeScript, lint and production build passed. Web TypeScript, lint and production build passed. Root unit and lint commands passed.
- Current browser aggregate: **13 passed: 10 lifecycle journeys plus the original 3 presentation/detail journeys**. The independent full replay completed in 58.3 seconds; its 29 focused unit tests also passed. One earlier local catalog attempt ended in a Chromium target crash, and the unchanged-source independent replay passed that case and the full suite.
- Browser acceptance uses the real API/database and production Web build at EN/AR, 390px and 1440px. Image transport alone uses an explicit deterministic test cover; no R2 delivery or real catalog artwork is claimed. A separately labelled fault-injection test covers controls loading/error/retry/null recovery. The original three browser journeys passed. The 36 original captures include focused viewport images separately from full-page/region captures. Review confirmed unobscured focused Home actions/retry, unchanged AYIN branding, readable EN/AR labels, authored mixed-direction text, responsive detail layout and real Search artwork-key presentation.

The harness fixes retain meaningful assertions: cleanup follows actual FK restrictions and only deletes its own fixture identities; Search results are distinguished from autocomplete suggestions; known hidden Next activity trees are excluded; production CSP's HTTP-to-HTTPS image upgrade is represented by the test artwork transport. None replaces policy API responses in the real-path tests.

## Remaining release gates

Remote CI, source review, merge and deployment verification are separate. No provider activation, credential/access change, live-data correction, schema migration or financial behavior is included in this slice. Admin-authored discovery row titles remain their configured content rather than being silently translated.

## Current-source Account ownership integration

The original public candidate was prepared before accepted whole-account recovery. Its provider could not simply replace the current coordinator. The integrated implementation preserves `identityRevision`, owner symbols and route ownership, epoch/abort guards, native conceal-before-clear and the Account publication contract. Public navigation/hero snapshots have their own pathname/revision/suspension lifecycle; generic identity reads cannot publish while Account owns identity. Owner release and route changes clear old shell facts and reverify the current session.

Two additional real-API soft-navigation cases hold earlier generic identity responses while changing A to B, and hold current Home identity/hero after Account release. They verify the same document, no stale private shell identity and current policy. The full current-source browser selection passed 46 cases: the earlier 13 public cases, these two boundaries and 31 existing Account/session/privacy/MFA/finance regressions. All 36 public originals were recaptured, alongside the related account captures.

The clean source-only API suite passed 180 files / 1,099 cases, plus four database integration cases. Web 598 cases, types, lint, formatting and production build passed. An earlier 281-file/1,597-case run included compiled `dist` source tests; it is explicitly rejected as acceptance. The corrected run moved only ignored build output outside the checkout, verified zero `dist` discovery paths and reran without weakening source assertions.

Independent review of staged preparation tree `e1e867195e908bde70cc0e6fe4c3a6c3e5dd1f18` accepted the integrated provider after 20 production-browser cases plus one additional held-response A-to-B/soft-Back regression. No old Account workspace rendered while identity remained unverified. The provider hash was `598da909c4b9863fa64ee528b117dbcb2417f72fc436a5d7893cafd556b28d2d` throughout review.

Publication additionally inherits the separately reviewed existing-asset lock correction PR244. That exact final union requires its own owning CI and original-image acceptance. Prior source results are not relabeled as final CI or deployed acceptance. Simulated lifecycle signals remain distinct from physical-device/BFCache certification.
