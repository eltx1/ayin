# Playback authority recovery and validation

Date: 2026-10-07. Published baseline: `3e328415`, restored as local synthetic
`1a0d39a36c2e6cacc7b1da90cbe21a2287fba37e` (tree prefix `db0b573d`).

The old workspace was unavailable. Production source was recovered from retained
exact file reads, Git diffs, successful edit commands and native test templates.
It was replayed in an isolated worktree. This is a new local commit sequence;
the original full Git objects and proof artifacts were not recreated.

## Replayed implementation

- Shared prerequisites: `e1f48afeedf172f03dd638e2a7a02a39bf80a41e`.
- Watch API/Web/native source and available units:
  `632eb9dcb6127054c506aee889cf259ee0e20371`, tree
  `ba359aad38b85c472c33231b5d38f81665589b30`.
- Recovered and reauthored regression checkpoint:
  `8676fe73e216420f801f006c730a83777e6e56f0`.
- Remaining exact IMA/HLS browser recovery:
  `0ffd487ea2ef4b01c3e3bae4863378306352d16b` (test-only).

The API resolves the live server-owned default profile through the same shared
authority as Search. Explicit Kids requests only narrow access. Existing optional
authentication, expected-account/profile fences, trusted-edge territory and video
policy remain authoritative. The final disclosure check binds the selected
progressive asset or adaptive generation to its exact identity, keys, current
readiness and publication/eligibility. It holds no database lock over media I/O.
These are point-in-time checks; they do not revoke URLs already disclosed.

Native iOS/tvOS playback now forwards the current bearer/profile scope and applies
Kids behavior to ordinary deep links. Web Watch starts behind a neutral audience
boundary, requests scoped playback with credentials and synchronously conceals
and releases media when scope is invalidated. Same-viewer remounts retain only
ephemeral timeline/presentation/accounting, validated against the newly authorized
video and tracks. Pending saved-progress reads do not make initial zero
authoritative; explicit zero remains intentional.

## Recovery fidelity

All fourteen changed native files were recovered. Seven independently retained
old/new blob-prefix pairs match, and all original per-file change counts match.
The shared progress hook base matches independent original blob `3db7f764`.
Eight initial complete-file materializations match their original blob prefixes.
The final HTTP-boundary test independently matches original blob `916ae768`.
Other recovered files have exact-command provenance and fresh hashes, but no
independently retained original final blob hash; they are not represented as an
exact reconstruction of the entire original commit/tree.

The complete original PostgreSQL suite was unavailable. Its preserved helpers,
ordinary Kids/anonymous/profile cases, exact asset replacement and HLS generation
test were reused. Setup and additional revocation cases are explicitly marked as
reauthored. The Watch browser suite and held-progress cases were recovered;
presentation-reset assertions and EN/AR active-caption restoration proof were
reauthored against current source. No old screenshots or runtime results are
presented as current evidence.

## Fresh checks

- Frozen pnpm 11.24.0 installation passed all 717 supply-chain policy entries;
  608 packages reused. The earlier offline attempt lacked registry metadata;
  the normal frozen retry passed without changing policies or the lockfile.
- Shared packages built; Prisma 7.10.0 generated successfully.
- Full API and Web typechecks passed.
- Focused Web units: 58 passed across Watch SEO, scoped playback, adaptive
  release, player preferences and accounting.
- Focused Search/Watch API units: 75 passed.
- Changed TypeScript/JavaScript lint passed with zero warnings.
- Standalone strict types passed for the recovered Watch browser suite and
  decoded player localization suite.
- The remaining eight IMA/HLS browser cases and their harness edits were recovered
  from exact original edit bodies. Formatting, zero-warning lint and strict types
  with the existing Web aliases passed. Four unavailable historical media-element
  annotations were reauthored from the compiler diagnostics; no application
  behavior changed.
- PostgreSQL 17.10: all 63 migrations applied to a disposable database; 43 tests
  passed across playback viewer policy, Search viewer policy and watch progress.
  The playback suite contains 18 cases, including real cookie/bearer transport,
  held profile/policy/source changes and exact selected-media replacement.

The PostgreSQL run used the coordinated `run-with-postgres.py` wrapper, which
stopped its owned database process when the test command exited successfully.

## Remaining acceptance

The combined application build and browser/decoded-caption proof belong to the
final union gate, including the recovered active/pending IMA and
completed/interrupted-break cases. Native simulator/platform CI has not run in
this Linux replay. No production data, provider activation, signing, credentials
or external publication was changed during this recovery.
