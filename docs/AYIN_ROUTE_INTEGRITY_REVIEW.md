# Route integration continuation review

The current accepted main is `912e64b3ef91644abe9b8c2475ea3faffb519597` (PR #139). The canonical master goal remains phases 0–16; historical phase numbers are not master completion.

A local Phase 2 candidate has been implemented against the exact source snapshot. It repairs Movies, Series, TV and Creators indexes, canonicalizes Shorts/Clips, repairs Upload shortcuts, removes the conflicting static manifest, shares the Viewer shell on catalog details and preserves rights-aware request isolation. New SQL applies publication/media/catalog/video policy before bounded keyset pagination. No schema migration or production mutation is part of the candidate.

Local evidence: packages/Prisma generation, API/Web types, formatting, repository lint, 367 API unit tests, 171 Web unit tests and production Web build passed. Seven new integration cases and three browser journeys are authored, but their real DB/browser acceptance must be observed in CI before merge. HTTP fixtures verified real SSR index routes, EN/AR, redirects and the served manifest; those fixtures are synthetic, not production catalog evidence. Local Chromium returned `ERR_BLOCKED_BY_ADMINISTRATOR`; no browser-policy bypass or local visual acceptance is claimed.

The candidate's local final tree is `4740a4c0c0f089bfdb9593d7bb2c57e0a6be1e15`. Its patch against the source snapshot has SHA-256 `cf5bca8e2470988a869c72f2e978278d013435683fc782aba75a7afcf51d7ec2`. Neither identifier is an accepted remote commit or deployment. The implementation must be published, validated on an exact final head, reviewed and merged before Phase 3.

Limited production-build HTML-declared gzip JavaScript sizes (not actual browser/CDN transfer or CWV):

| Surface | Before bytes | After bytes |
| --- | ---: | ---: |
| Movies directory | 204484 | 205163 |
| Movie detail | 198298 | 203964 |
| Home | 211629 | 212308 |

The detail increase reflects inclusion of the existing Viewer shell. This is not a claimed performance improvement. Full field/lab, DB, playback, upload and PWA measurements remain pending.

A 73-domain human feature matrix and the updated execution ledger are included in the local candidate; they preserve internal-only boundaries and do not claim every capability or phase complete. Temporary snapshot tooling must be removed before phase acceptance. Production deployed SHA and physical-device/provider/store certification are not established.
