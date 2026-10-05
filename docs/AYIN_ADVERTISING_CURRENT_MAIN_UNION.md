# Advertising current-main union and long-content prerequisite

## Assembly and retained acceptance

This candidate combines main `8905a8244ce47bcac3d68ee41450dfdd0f7768c6` with accepted Advertising PR247 source `a2f74ff5f069a297fe06bff2805cd1a341de8281` / tree `b8401183f8613d6e86c7ea238e57770d216263ce`. The fetched PR head was checked against the original accepted staged tree. Advertising application code, tests and its original evidence document retain their accepted blobs. The previously added `advertising-navigation-visuals` workflow block is preserved.

The public/upload stack merged at 8905 has owning acceptance of 1,152 API cases, 266 ordinary browser cases plus five PWA cases, and 48 inspected CI originals. PR245 is included through PR246; the source-identical PR244 validation head was superseded after ancestry verification. Runtime and edge verification for 8905 were still pending at the coordination handoff; the last verified live release was 27708005 at 20:04 UTC. These prior source gates are not current-union or deployment acceptance.

PR247's earlier base was 27708005. Its accepted prior owning run contained 259 ordinary browser cases, five PWA cases and 18 final Advertising CI originals. The current union is tested independently below, rather than inferred from those earlier runs.

Current-main public/upload application source remains unchanged. The ViewerProductProvider retains SHA256 `598da909c4b9863fa64ee528b117dbcb2417f72fc436a5d7893cafd556b28d2d`. The finite remainder ledger retains SHA256 `18517d713c02fa38c3817502d5f178a959067a14027c257ca317304bef86ab97`; existing checkpoint history is preserved verbatim after the additive current-union section. Original Advertising evidence and bundles are not overwritten.

## Separately identified shared-card prerequisite

The first 45-case union run passed 44 cases, including all 18 Advertising and all Account/public lifecycle cases. Its unchanged shared spacing assertion correctly rejected EN390 `/creators` after accumulated real fixtures produced long auto-provisioned handles. It was not waived as fixture contamination.

Actual retained-data measurements on both the union and a freshly built, unmodified exact-8905 baseline showed:

- Document client width 390px and scroll width 445px.
- A 173px MediaCard copy box with a 242.4375px implicit grid track.
- Its title and handle extended to a right edge of 445.34375px.
- A local style probe bounding that track and wrapping metadata restored a 390px document in both EN and AR, without altering card/art/link structure.

The initial cold-baseline diagnostic sampled before streamed cards arrived; its empty-node measurements are rejected. The corrected diagnosis explicitly awaited real cards. Two new committed regressions then ran against the unmodified 8905 production build and both failed their actual containment assertions, after the real API returned the seeded long titles and handles.

The prerequisite changes only four declarations in `media-card.module.css`: a `minmax(0, 1fr)` copy track, zero minimum inline size for copy/metadata, and metadata/kicker wrapping. Existing title ellipsis, full accessible link names, canonical destinations, artwork aspect ratios, focus styles and card structure remain unchanged. No public API, inventory rule, provider, auth or advertising mutation contract changed.

The focused fixture creates three explicitly identified local-test channels and deletes only those three IDs. The two real API/browser journeys cover authored long English/Arabic titles, 71-character handles, EN/AR390/1440, document/card/text bounds, 16:9 artwork, full accessible labels, physical directional focus and actual native-link activation. No data, overflow or keyboard assertion was removed. A separate `media-card-long-content-visuals` always-upload artifact explicitly retains the four originals alongside the unchanged Advertising artifact.

## Final local union validation

- Node 24.19.0, pinned dependency graph, production API/Web builds and isolated PostgreSQL initialized with UTF8, C.UTF-8 and UTC.
- Shared package/Prisma generation, API build, Web build, Web TypeScript, complete Web lint and changed-file formatting passed.
- Complete Web suite: 607 tests in 102 files passed.
- Production browser union: 47/47 passed in 2.2 minutes. This is the original 45-case sequence plus the two focused card cases: 18 Advertising, 27 shared navigation/Account/public-lifecycle cases and two new long-content cases. The formerly failing accumulated-data spacing case passed with its original assertion.
- A separate subsequent production-browser run passed all five existing directory/artwork-foundation cases in 15.4 seconds. Its catalog-reset helpers ran only after the 47-case sequence, so they could not mask the original accumulated-data failure.
- All four new long-content originals were individually inspected by the producer and independently by the coordinator: contained cards/handles, visible unobscured focused cards, preserved title ellipsis/link semantics and intact artwork ratio. Sixteen of the 18 final Advertising captures byte-match already inspected originals; the two regenerated player captures were reopened and inspected.
- All temporary PostgreSQL/API/Next processes stopped after testing. No provider activation, live advertising mutation, credential change or external write was performed.

Full current-union API/PWA/ordinary-browser CI, final CI-original inspection, expected-tree merge and exact runtime/edge verification remain release gates. Earlier accepted API/PWA counts are not substituted for those gates. This does not complete a whole master phase or certify provider, consent, native-device or commercial delivery readiness.

Local union evidence bundle: `ayin-ad-controls-union-evidence.zip`, SHA256 `6b6d5c7d16a004f2d342d1051961729c27e6f22f4ab3587fcaa8e8823c1dc997`. It preserves the 22 final owning originals, source/visual manifests, final gate logs and the separately labeled initial failure/baseline diagnostic records.
