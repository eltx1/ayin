# Clips audience recovery, 2026-10-07

The prior local AYIN checkout was unavailable after the October 6 pause. This
change restores Clips source from retained full file reads, original edit commands
and patch payloads. It does not claim to recreate the original Git commit objects.

## Source lineage

- Restored local baseline: `1a0d39a36c2e6cacc7b1da90cbe21a2287fba37e`, materialized by
  the parent recovery task from published `3e328415`.
- Shared viewer policy/context, audience invalidation and progress-position getter:
  donor `e1f48afeedf172f03dd638e2a7a02a39bf80a41e`, local prerequisite
  `a6fcabce132483f76dc249604455e9034c9ac851`. These are separate from the Clips patch.
- Replayed Clips loading fix: original `0ec2b456c9d4cbd96e69eddbd714394a7635f5fd`.
- Replayed audience boundary: original `7b3f9dc2e40d1faa2c2c83b2aff88fb55eb34b61`.
- Replayed autoplay fix: original `4cdfd598a59f4d93399c46ed75abaeb3a1759a0b`.
- The final Clips position-authority adaptation was uncommitted before the pause.
  Its exact original edit commands were retained. The shared getter originated in
  `5ac62ec6e78aea5b86193a1ae567db91ffadbab4` and is included in the shared prerequisite.

Production code was replayed without replacement auth/policy architecture. The
controller uses the shared live viewer fence; the feed applies Kids policy before
pagination and rechecks exact selected assets plus current policy before disclosure.
The web page is a neutral shell until a credentialed, scoped feed succeeds.
Suspension immediately releases sources; restoration revalidates loaded pages and
retains only position whose provenance is established by the shared progress hook.

## Byte checks

The complete recovered prerequisite ClipVideo matched the restored baseline.
All four original API source/test inputs matched before the saved patches applied.
After formatting with pinned Prettier 3.9.6, the final API service matched its full
historical printed snapshot byte-for-byte.

The following computed blobs match every retained original prefix checked at the
corresponding stage. Full SHAs below were computed from the recovered bytes; only
the listed prefixes were retained historically.

| Stage/file                        | Historical prefix | Computed blob                              |
| --------------------------------- | ----------------- | ------------------------------------------ |
| Loading social tests              | `80eac6e3`        | `80eac6e3b8583d5cd90f7cc553c80c46b74a8af9` |
| Audience ClipsFeed                | `32500276`        | `325002760f4e294248da3086c702e1a8680a554c` |
| Audience clips contract           | `3563d55d`        | `3563d55d7f2c16351d5ff8e7a8e6fa1fdd8aaf1b` |
| Audience ClipVideo                | `e9926def`        | `e9926def1d43b321d540b801886b56ba4f3ae0fe` |
| Audience ClipsClient              | `0bc4a198`        | `0bc4a198f1c153f5c67114391b8268d5d8848ea0` |
| Audience social tests             | `61a04e30`        | `61a04e30f985db7a7c0c375891ee3c28a36a3a11` |
| Position-authority ClipVideo      | `f448e588`        | `f448e58800bec5c3c1a9d01c83c66098094d41b4` |
| Position-authority ClipsClient    | `2115560a`        | `2115560ac664e0c476f071f3bae4fd54053ec7ff` |
| Position-authority clips contract | `36263599`        | `36263599227582bec8166d819083486f9f78824b` |

Final formatted test files without a retained blob hash were produced from the
original exact edits/new-file text using the pinned formatter. They are replayed
source, not independently proven original Git blobs.

## Explicit test-only reconstruction

The parent requested the behavior of its prior test-only `9f521518` change. Its
full original bytes were unavailable, so the following are new, disclosed test
reconstructions rather than claimed byte-identical recovery:

- `contextOptions.reducedMotion = "reduce"` and a real `matchMedia` assertion;
- four Kids cases for EN/AR at 1440 and 390 pixels, plus neutral and error EN
  screenshots: six expected PNGs and six bounded JSON state snapshots;
- snapshots limited to 24 clip records and six short headings, a 2.5-second
  snapshot deadline, five-second screenshot deadline, and failure collection that
  preserves the original test failure;
- a Clips-specific CI evidence upload step;
- existing pagehide/hidden stale-event tests retain the retiring element handle
  before suspension, because the neutral shell removes the old Locator target.

Original post-verification social uncertainty, single-write and navigation
assertions remain intact. The six original render cases are preserved.

## Local validation

- Frozen dependency install: pnpm 11.24.0, 608 packages reused, zero downloads,
  all 717 lockfile entries passed supply-chain policies. An initial offline attempt
  lacked package metadata; the normal frozen install passed without policy changes.
- Generated shared package outputs were copied into this isolated worktree from
  the separately validated Ads replay. No shared baseline source was modified.
- Focused API source tests: 28 passed.
- Focused web source/render tests: 37 passed.
- API and web TypeScript checks: passed.
- Touched API/web/E2E ESLint and formatting/diff checks: passed.
- New browser suites: 11 cases collected across three files; runtime not executed.
- PostgreSQL suite: 22 cases collected and skipped with TEST_DATABASE_URL unset;
  no PostgreSQL execution is claimed.

No API/web servers, production builds, browser execution, remote writes or archives
were started in this worktree. Exact-union runtime acceptance remains a separate
coordinated gate, including existing Clips layout/social/progress suites.
