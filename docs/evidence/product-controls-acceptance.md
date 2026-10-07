# Product Controls source and acceptance boundary

Status: the scoped local Product Controls acceptance now passes on `c452b3cc5a4991583bf6a8419b83b99081be7f26`, including all six actual-API browser cases and original EN/AR screenshot inspection. Full remote quality/browser gates for the owning combined release candidate remain required. This document does not claim release acceptance.

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

The original preparation stage had no generated or inspected screenshots. The local execution below supplies scoped runtime evidence and all four originals; remote run identities and combined-release acceptance remain outstanding.

## Local keyboard regression correction and acceptance — 2026-10-07

Source commit: `c452b3cc5a4991583bf6a8419b83b99081be7f26`, based on `bc45fd63d3e479d87e3fb5367d981d37e88dd8bc`.

The first real browser run demonstrated that Add category created Category 3 but focused Category 1. The selector `fieldset:last-child input`, evaluated inside the taxonomy root, also matched the enclosing product settings fieldset outside that root. The correction restricts matching to `:scope > fieldset:last-child input` and focuses in a React layout effect after the appended row commits. There is no delayed animation-frame callback left for this action. Identity, lease invalidation, MFA review, mutation and unknown-outcome handling are unchanged.

The EN/AR mobile cases retain the original new-field focus assertion and now additionally use native Tab order through the category checkbox, Remove and Add controls. Enter adds a fourth category, focus moves into its textbox, and keyboard removal returns focus to Add while preserving the third draft. Both cases still assert exact saved taxonomy, disabled state, announcement, device flags, regional normalization, one global audit and absence of horizontal overflow at 390 × 844.

Verification on that source:

- The five focused Product Controls/merchandising unit files above: **37 passed**.
- Changed-source lint, changed-file formatting and `git diff --check`: passed.
- Web typecheck: passed.
- Fresh full `pnpm build` (shared packages, API and Web): passed with the local test API/media origins.
- Fresh isolated PostgreSQL 17 migration/seed and `product-controls.acceptance.spec.ts`: **6 passed in 40.4 seconds** using Chromium, the real local API and one worker. No retry or focus assertion was removed. The other four cases confirm MFA draft retention with a fresh reviewed save; generic 400 and malformed 2xx after real commits without replay; revoked-scope concealment; and invalid-field blocking with explicit taxonomy removal.

The execution used a task-local Playwright overlay to select the isolated worktree and bind Next to `0.0.0.0`; production source and committed browser configuration were not changed for that runtime setting. This scoped execution is not a full repository test run or remote CI result.

All four original `testInfo.outputPath` PNGs were generated and their actual pixels inspected. English and Arabic taxonomy labels, stable keys, category states and Add/Remove controls are readable without clipping. Regional labels wrap within the narrow form, the saved `DE, JP` value remains left-to-right, and the Arabic form and action align correctly. These are element captures from a 390 × 844 viewport, so a taxonomy image can be taller than the viewport.

| Original image           | Dimensions | SHA-256                                                            |
| ------------------------ | ---------- | ------------------------------------------------------------------ |
| `taxonomy-en-mobile.png` | 362 × 993  | `24ff655a51b21c17cea3ad3a73e39e707e75dd6608e206110d7e7e98e21c3e85` |
| `taxonomy-ar-mobile.png` | 362 × 943  | `356a9988bda1179954fa77abe18bf00fcc8d72bd1d6411cd50d0a7213f69de68` |
| `regions-en-mobile.png`  | 326 × 268  | `270acae2c77a0427be4f0232220acb3b563f334097d4b2a2e743638be8a61379` |
| `regions-ar-mobile.png`  | 326 × 268  | `87cb64c40791b0abd8d46a869c17a9fbb10e21e53864b039f6870ee42f892cd5` |

Local handoff artifacts are retained under `ayin-runtime/product-controls-focus/results/`, with source and image metadata in `ayin-runtime/product-controls-focus/evidence.json`. Execution logs are `ayin-recovery-state/product-controls-focus-{tests,typecheck,build,browser}.log` in the task workspace. The images were not resized, retouched or substituted with mockups.
