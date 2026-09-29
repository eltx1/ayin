# Admin JSON action recovery — evidence and boundaries

## Scope

Base product: `68563b8841642fa032682b1f401d98b1bf88473b` (accepted/deployed #146). PR #147 changes eight payload-free action call sites across three Web files to send explicit empty JSON objects. JSON headers, session credentials, no-store, URI encoding, confirmations, Admin verification dispatch, server role/MFA/Origin checks and transactional audits remain unchanged. No ad placement, delivery, provider or production record is changed by this code publication.

This does not make the legacy panels' complete pending/draft/refresh workflows atomic or retry-safe. A rejected or lost mutation is not automatically replayed. AdminSeries and StudioLive were also inspected: their clients attach JSON content type only when a body exists, so their payload-free calls are not the same defect and were deliberately left alone.

## Reproduction and fixture correction

The nine new Web cases initially had five failures, then all passed with the request correction. They assert actual exported DELETE calls, exact headers/body/session behavior, body-free reads, one verification notification and no automatic replay after step-up or response loss; source-AST coverage protects inline seed/override action sites.

First full quality run `36637216454` at `c748436bc36d2f5ce6376c4b282eabe12651d899` passed audit, formatting, lint, types, unit/schema and clean migrations. Its API integration gate had 606 passing and five failing cases. All five new cases failed the foreign-Origin assertion. Inspection established that `main.ts` installs the Fastify onRequest Origin policy, while the new AppModule test harness did not execute bootstrap. This was a fixture omission, not evidence of a production bypass.

Correction `6514c2b68f20615d599e288b9a4efc03787fc848` installs the same imported production `isAllowedCookieMutationOrigin` predicate in the test app, supplies an explicit Origin to MFA setup, and additionally verifies missing-Origin403. Assertions remain strict: malformed JSON400, missing authentication/MFA401, stale step-up403, foreign/missing Origin403, wrong role403, unchanged target/no audit on rejection, then AD_MANAGER200 with real deletion and one actor-attributed audit. Existing seeding integration assertions remain and now verify real JSON requests and exactly one publish/rollback audit.

A local minimal Fastify injection check independently verified foreign403, missing-Origin403 and old bodyless-JSON400 with zero handler invocations, then valid same-Origin JSON200 with one invocation. It uses the real shared production predicate and no database; it is not full production/bootstrap or PostgreSQL acceptance.

Local Web259/55files, scoped lint/format/types/Prisma and both production Web builds passed. Local Node22.16.0/restored compatible tools are not the CI Node24.19.0 frozen dependency baseline. Implementation6514c2b passed full quality36638391223, security36638391339, browser36638391248 and inventory36638391279. The final documentation head still needs applicable checks/review; merge and release proof must be observed separately. Initial c748 browser36637216380, security36637216379 and inventory36637216421 passed; those are not automatic acceptance of a later head.

## Limited before/after build measurements

Both local Web builds use the same restored dependencies/toolchain. Count unique route-manifest entry JavaScript files and gzip each at level9. This excludes later dynamic imports and is not observed browser/CDN transfer, CWV, database latency, playback startup or upload reliability. The after product source is c748; the subsequent fixture-only repair does not alter these assets.

Advertising entry gzip: **48,319 → 48,322 bytes**. Video Ads: **43,681 → 43,683**. Content Library: **44,860 → 44,863**. Admin overview remains45,820; Browse43,763; Home50,194. All six measured CSS unions are unchanged. These tiny deltas reflect the explicit payload expressions, not a claimed speed improvement or complete performance-program acceptance.

## Release and rollback

Keep the PR unmerged until actual final-head quality, security, browser and inventory gates succeed and review is recorded. Observe validated-main deployment and exact immutable proof separately. Roll back only the focused request change through a reviewed release when necessary; no schema or production-data rollback. Retain predecessor fast-uri, locale, MFA, ownership, rights and financial protections. Full master design, advertising, security, PWA and native acceptance remains separate.
