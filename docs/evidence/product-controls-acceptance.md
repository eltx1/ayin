# Product Controls source and acceptance boundary

Status: source reviewed; the first owning remote quality run failed full typecheck and a narrow correction is prepared below. Full remote quality and browser gates, original screenshot retrieval, and visual inspection remain pending. This document does not claim runtime or release acceptance.

## Source provenance

- Reviewed source: `c56437aec840e5af9e473841c42249107256a365`, tree `b714380cc62833d3aaa82653b8d49dc6e59a395a`.
- Original source base: `43fa32a7847172d9aff4734fd72584f8d884bc72`.
- Release integration base: `0b6c3677b1387e255748d61fa036065fde8c8cb7`.
- Conflict-free source transfer: `19c681df`, with all twelve reviewed source/test files retained byte for byte.
- Product Controls preparation adds only this evidence note and a bounded upload step in the existing browser workflow. The source transfer does not provide new runtime evidence for the combined release tree.
- A separate inherited test-only correction aligns the consent lifecycle DAI fallback assertion with the fixture's current `/test.mp4` name. It changes no product behavior and is not additional local browser evidence.

The UI now has labeled English/Arabic announcement fields, individual taxonomy rows, translated device controls, and regional forms that submit with the keyboard and fit a narrow screen. Label editing retains exact taxonomy keys, disabled states, commas, Arabic text, and temporarily empty drafts. Only explicit Remove deletes a category. New categories receive noncolliding stable keys. Regional saves leave unrelated global drafts intact.

Existing Admin scope leases, private-surface concealment, and the verification coordinator remain authoritative. Global success requires the returned settings to match the submitted canonical values. A generic 400, malformed or different 2xx response, lost response, or timeout does not prove that no commit occurred. Those results retain drafts and report an unconfirmed change without replay. Explicit step-up requires verification followed by a fresh reviewed save.

No backend, role, Ads editor, credential, provider, native-platform, public-origin, or production-data changes are introduced by this slice. Native applications continue to use the Web/PWA source of truth.

## Verification already completed

On the original frozen source, the following focused Web command passed all 37 tests across five files:

```sh
unset NEXT_PUBLIC_API_BASE_URL
pnpm --filter @ayin/web exec vitest run \
  src/lib/admin-product.test.ts \
  src/lib/admin-product-drafts.test.ts \
  src/lib/admin-merchandising.test.ts \
  src/components/admin/admin-product-controls.test.tsx \
  src/components/admin/admin-product-fields.test.tsx \
  --maxWorkers=1
```

Changed-file formatting and `git diff --check` also passed. This was not the full Web or repository test suite. No local lint, typecheck, production build, PostgreSQL integration, or browser acceptance was run for this slice. Dependency preparation used the approved current dependency donor, immutable package hardlinks with private mutable metadata, and an offline frozen install with lifecycle scripts disabled. The unchanged UI package's existing output was used only for focused SSR tests; it is not evidence of a fresh release build.

## First owning remote failure and correction

PR #263's Task quality gates run `37447375697`, job `112215354016`, failed the full typecheck. In `admin-product-fields.tsx`, the announcement text and link call sites explicitly supplied `error: string | undefined` to the shared `FieldCopy` contract `error?: string`. With `exactOptionalPropertyTypes`, an absent optional property is distinct from a property whose value is `undefined`.

Only those two call sites now conditionally spread an `error` property when their matching issue exists; otherwise they omit it. The shared field contract and rendered behavior are unchanged. This is a correction after the byte-identical initial source transfer. No local full typecheck or runtime was run for the correction while the shared runtime was allocated elsewhere. The exact owning remote quality run must be repeated for the corrected candidate; the earlier focused 37-test result does not replace it.

## Exact remote gates still required

The owner must record run URLs and the exact tested source/merge commit before accepting the combined release candidate:

1. `.github/workflows/database.yml`, **Task quality gates / quality**: full formatting, lint, typecheck, units/schema tests, PostgreSQL integration, production build, and the workflow's existing checks.
2. `.github/workflows/e2e.yml`, **V1 browser acceptance / e2e**: the release build and ordinary browser shards, including all six Product Controls cases and the existing merchandising selection/workspace regressions. Existing PWA, recovery, caption, and other jobs remain unchanged.
3. The existing Security gates and other required checks for that exact owning candidate. No status is inherited merely because an earlier source or another stack passed.

The six new actual-API cases cover EN and AR at 390 × 844, lossless labels and flags, regional Enter submission, explicit removal and validation, MFA review-again retention, a generic 400 and malformed 2xx returned after a real test-database commit, and concealment after current authority is revoked. The existing regional browser selector changes only from `ancestor::tr` to `ancestor::form`; button and input labels are retained.

## Original visual evidence still required

The existing browser tests write these unmodified PNGs through `testInfo.outputPath`. The added `product-controls-mobile-visuals` artifact retains only these four names for seven days:

- `taxonomy-en-mobile.png`
- `taxonomy-ar-mobile.png`
- `regions-en-mobile.png`
- `regions-ar-mobile.png`

The artifact includes matching files under the ordinary shard result directories and errors if no files are available. A successful artifact upload alone does not establish that all four images exist or that browser tests passed. The owner must retrieve the artifact from the exact accepted run, confirm all four originals, record their hashes, inspect their actual pixels, and retain any defects or missing evidence in the final acceptance report. Screenshots alone do not replace the keyboard, persistence, scope, audit, and no-replay assertions.

At this preparation stage none of these original screenshots has been generated or inspected for this slice. Remote run identities, screenshot hashes, and final acceptance must be supplied after execution; they are intentionally not invented here.
