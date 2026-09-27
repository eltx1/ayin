# AYIN product integration master plan

## Authority and architecture

This program evolves the existing AYIN repository. The responsive Web/PWA is the primary product and source of truth for ordinary UI and business behavior. Preserve current data, APIs, authorization, rights, financial truth and advertising contracts. Platform-specific code needs an evidenced capability requirement; existing native code is not automatically justified by its existence.

Read `AYIN_PRODUCT_INTEGRATION_CHECKPOINTS.md` before every phase. Update it after each phase, including failures. A source file or historical completion claim is not acceptance evidence. Do not begin a later phase while a required earlier gate is failing.

## Sequential delivery

| Phase                        | Deliverables                                                                                                                                   | Exit criteria                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0: Task 87                   | Diagnose discovery pagination; correct root cause; complete existing PR #108                                                                   | Format, lint, typecheck, unit/schema, PostgreSQL integration/migrations, production build, browser acceptance and security all pass on the same head; merge with expected SHA; record baseline |
| 1: Master audit              | Reproducible route/API/schema/worker/platform/deployment inventory; human and machine feature matrix; severity-ranked gaps; workflow baselines | Every requested domain classified with source evidence, runtime verification separately identified, ownership and next-phase remediation; no unexamined feature deletion                       |
| 2: Backend to product        | Role-scoped integration of ready APIs into Viewer, Studio and Admin; internal-only decisions documented                                        | Authorization, data minimization, loading/empty/error/retry/success states, validation, mobile/keyboard/RTL and mutation audits verified; no raw JSON console masquerading as product UI       |
| 3: Routes and hierarchy      | Canonical registry, aliases, real browse destinations, aligned navigation/manifest/SEO/deep links, grouped Admin and Studio navigation         | Route reachability and alias tests; no placeholder destination for an implemented product; measure common-action navigation depth                                                              |
| 4: Workflow simplification   | Watch, upload, creator management, contextual Admin actions, searchable entity selection, progressive disclosure                               | Before/after interaction counts and browser journeys; no weakened rights, MFA, finance or destructive-action protections                                                                       |
| 5: Design-system and UI pass | Reusable brand tokens and primitives; systematic public/Studio/Admin implementation; PWA and platform consistency                              | Responsive screenshots and accessibility checks per route family; AR/RTL, touch, keyboard, reduced motion, TV focus and safe-area checks; full gates and performance comparison                |

Each phase should be a reviewable PR. Split large phases into explicitly tracked subphases; do not treat a subphase as the whole phase. Preserve a single product UI across Web/PWA and mobile shells wherever technically appropriate. TV platforms may require native focus/player UI, but keep APIs and domain rules shared.

## Evidence contract

- Machine inventory: `AYIN_PRODUCT_INTEGRATION_MATRIX.json` plus source-linked human matrix in `AYIN_PRODUCT_INTEGRATION_AUDIT.md`.
- Distinguish source coverage, tested behavior, measured runtime, physical-device verification and store approval.
- Gate new code with targeted regression tests, then the repository's full CI gates. Inspect actual failed steps/logs; never edit expectations solely to make a test pass.
- Capture commit SHA, CI run URLs, test counts and durations. Runtime performance claims require measured data; file counts are inventory, not latency or throughput.
- For UI: small mobile, desktop, Arabic RTL, keyboard and TV-focus checks; signed-out and least-privileged roles; loading, empty and error cases.
- For PWA: install path, canonical manifest, offline navigation, update lifecycle, account switching/logout, authenticated cache isolation, bounded caches and media exclusions.
- For monetization: retain IMA/GPT/DAI boundaries, consent, test/production activation and emergency switches. Missing credentials/fill evidence stay explicitly unavailable.
- Schema changes need forward migration, rollback/recovery implications and clean PostgreSQL integration evidence. Do not route consistency-sensitive reads or auth/financial writes to replicas.

## Rollback and external verification

Prefer small additive commits and reversible navigation/UI changes. Never delete legacy routes without compatible aliases and usage review. Preserve data when reversing code; migrations require separate rollback analysis. No production deployment is implied by a passing build. Credentials, actual GAM fill, signed packages, store approvals, native SDK hardware tests and production load measurements remain external until performed.

## Verified delivery position

Phase 0 and the Phase 1 audit are merged. Phase 2A.1 re-authentication, 2A.2 read-only media/database workspaces and 2A.3a/b atomic retry and generation safety are verified and merged through PR #115 (`554eac65`). Exact acceptance SHAs and CI evidence are in the checkpoint. Phase 2A.3c.1 contextual retry/reprocess controls are verified and merged as PR #117 (`43d5e81b`). Phase 2A.3c.2 bounded queue recovery and durable pause ordering are verified in PR #119 (`d1c722fc`). Storage reconciliation and advanced controls are now accepted through PR #123; see the subsequent evidence records. Phase 2 as a whole and Phases 3–5 remain incomplete.

Phase 2A.3c.3 merged as PR #121 (`03077fd1`) after full quality/security and all 34 browser tests passed on `80a0175a`. Storage recovery now distinguishes uncertainty from unusable objects, fences changed manifest observations, bounds candidate reads and preserves continuation under capacity pressure. Nine new PostgreSQL regressions passed within the 531-test API gate. Next: integrate verified advanced controls; review fair selection for `INCOMPLETE_HLS` before exposing that mode. The checkpoint defines the orphan `hasMore` contract. Phase 2 remains incomplete.

Phase 2A.3c.4 merged as PR #123 (`0475932d`) after quality/security and all 36 browser tests passed on `12a7b847`. Bounded backfill, pause/resume and four reviewed recovery modes reuse the existing media workspace with explicit result/continuation semantics. `INCOMPLETE_HLS` remains unexposed pending fair selection review. Other Phase 2 domains and Phases 3–5 remain open.

Phase 2B merged as PR #124 (`f4763ab8`) after quality/security and all 37 browser tests passed on `e18dfd18`: recommendation fixture/observed evidence and reviewed trending settings at `/admin/operations/discovery`, linked from Operations. No raw JSON console or native product fork. The 531-test API integration gate and 138 Web units passed. Phase 2C.1 now implements bounded, sanitized warehouse checkpoint visibility; validation is pending. Then review Studio Live reliability and remaining domain gaps.
