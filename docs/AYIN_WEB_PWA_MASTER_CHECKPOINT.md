# AYIN Web/PWA master checkpoint

## Execution contract and current truth

The user's master phases **0–16** remain authoritative. `https://ayin.stream` is the canonical Web/PWA, sharing AYIN APIs and justified platform adapters. Preserve authorization, ownership, MFA/step-up, catalog rights, moderation, financial integrity and transactional audit. Read this checkpoint and verify actual main, open PRs, source, exact-head checks and deployment before every phase. Record engineering evidence, not private reasoning.

The complete ledger through the reviewed Phase 4C candidate is preserved byte-for-byte in [Phase 4C release history](AYIN_PHASE4C_RELEASE_HISTORY.md), including earlier predecessor/history links. Its pending statuses describe that historical moment, not current main. Feature authority: [AYIN_FEATURE_SURFACE_MATRIX.md](AYIN_FEATURE_SURFACE_MATRIX.md). Shared component authority: [AYIN_DESIGN_SYSTEM.md](AYIN_DESIGN_SYSTEM.md).

**Verified accepted main and deployed release:** `68563b8841642fa032682b1f401d98b1bf88473b`, following PR #146. **Current working branch:** `web-pwa-admin-json-action-recovery`, starting from that exact commit. The former #144/#145 reconciliation and fast-uri publication issue are resolved. No additional connector is required.

## Master acceptance boundaries

Baseline recovery, focused source inventory, route repair and hierarchical navigation are accepted with their recorded limits. Design foundations4A, Comments/Support/Playlists4B and focused creator editor4C are accepted. Full shared component/action coverage is not yet complete. Whole Viewer/Creator/Admin redesign and capability completion (5–8), installed PWA/performance/current-policy advertising/full visual/E2E/security (9–14), native readiness after Web/PWA gates (15) and final documentation consolidation (16) remain open. Historical phase numbers, source counts and green subphase tests never imply whole-master acceptance.

The current Admin action correction is a focused regression repair identified during4C, not a claim to finish Advertising, Admin redesign or the final security phase. Existing provider and native certification boundaries remain unchanged.

## Accepted predecessor index

Detailed tests, source/visual hashes, decisions, risks and rollback are in the preserved history.

- #139 scoped merchandising recovery: merge `912e64b3ef91644abe9b8c2475ea3faffb519597`.
- #140 real rights-aware public directories and aliases: merge `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`.
- #141 source/semantic inventory: merge `64df1952ba041b95c30e3139760bd9410059c5dc`; not blanket runtime certification.
- #142 grouped navigation and adopted same-major fast-uri remediation: merge `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`; keep that security fix when reverting presentation.
- #143 shared design foundations/artwork/locale-cookie fix: merge `2b7ea943f13fb9acfde542c820a5b93ce2e81ce6`.
- #144 Comments/Support with native shared data/forms: merge `5648df8800a801f716e75262dda9abfb784c3b14`.
- #145 reconciled playlist library using the same primitives: merge `02e37ce7186eb72f62c940847c630dbc5c8ef159`; validated release/proof `36591264789`/`11044590357` are superseded by #146 below.

## Accepted Phase 4C — PR #146

**Start:** `02e37ce7186eb72f62c940847c630dbc5c8ef159`. **Branch:** `web-pwa-phase-4c-content-editor`. **Reviewed implementation:** `2ebc0c119e68437452a4bee3306ce7be62c784d2`. **Closing head:** `9d2fed066d3d87fabd894de763f931c37e186060`. **Merged SHA:** `68563b8841642fa032682b1f401d98b1bf88473b`. **Exact tree:** `96af1e00f24ae4d69f00a3aabd381490ceef05eb`.

**Implementation:** bounded searchable creator content library and one selected editor; retained draft/tab state, manual keyboard/RTL tabs, complete wrapped Arabic mobile labels and one primary heading. Keep direct Quick Upload, removed records read-only and destructive confirmation. Distinguish acknowledged mutations from failed reloads and uncertain/possibly partial writes; existing two-stage metadata PATCH is not atomic. Add explicit JSON bodies to creator delete/unpublish/caption-delete requests without weakening the backend parser. Full inspected source and regressions are in [4C evidence](AYIN_PHASE4C_EVIDENCE.md).

**Final gates rechecked:** quality `36610186099`, browser `36610185981`, security `36610186059`, inventory `36610185991` all succeeded at9d2fed0. Prior author-side source/visual review `5356461735` and final closing review `5356654970` were read; no unresolved threads. The ready PR was merged with expected-head protection. Reviews are not independent approvals. Codex's automatic review quota message does not mean an independent review occurred.

**Observed release, 2026-09-29 UTC:** validated-main run `36634919756`; deployment `36635573371`, job `109635248998`, succeeded through exact-release/superseded-release/isolated-account/direct-origin health and immutable proof. Downloaded artifact `11064480608`, ZIP SHA-256 `82f232eb72c3400fb2405cd70ad1b7bd036a51aaac7bb770c0d92140dbbdd23b` verified. Its proof records release68563b8, validation36634919756, deploy36635573371, attempt1, accountayin. This establishes the release at deployment time, not every journey, current traffic or all public-edge behavior.

**Source restored:** artifact `11052732819` from inventory36610185991, ZIP SHA-256 `3b0b95bdd09db58e6e53a75b4527d8a2e7b501f0f9bc992e945db642c802ed47`. Its sourcef02678a is the PR test-merge snapshot, not main. All tracked hashes and the complete tree96af1e0 matched accepted main before local edits.

**Visual/performance boundaries:** the previous actual review of four content screenshots, final visual artifact11052800099 and its digest remain in the history; no new whole-route screenshot review is claimed here. Local250 Web tests/54files and limited selected entry-asset measurements are predecessor evidence. Full measured method is in [performance evidence](PERFORMANCE_BASELINE_AND_RESULTS.md); no field-CWV, DB/player/upload or complete-transfer speedup claim.

**Remaining:** same-document Back/Forward drafts, long-list scroll context, legacy advanced/caption inner localization, deeper caption uncertainty, global account-switch lifetime, actual backend pagination and broader component/visual/PWA/provider/native acceptance. No migrations, backend permission or financial/native/provider changes. Retain adopted request/security/locale fixes on presentation rollback.

## Current follow-on — Admin JSON action recovery

**Starting SHA:** `68563b8841642fa032682b1f401d98b1bf88473b`. **Branch:** `web-pwa-admin-json-action-recovery`. **Ending reviewed/merged/deployed SHA:** pending; no acceptance claimed yet.

**Inspected:** advertising client and controller/service delete contracts; video-ad scoped override client/controller/service; content-seeding client/controller/service; shared Admin error/verification dispatch; authentication tokens/sessions/Admin guards/cookie-origin controls; real MFA fixture helper; historical seeding integration tests; CI isolated database configuration. Existing Web helpers set JSON content-type even on payload-free actions.

**Reproduced problem and exact change:** three advertiser/campaign/creative deletes, one channel/video override-reset call site, and four content-seeding confirm/publish/rollback call sites announce JSON without sending any. The strict parser can reject these before the intended guarded action. Add explicit `JSON.stringify({})` only to these eight sites. Preserve JSON headers, credentials, no-store, URI encoding, error handling, confirmations, server role/step-up/ownership/audit and all existing business rules. Do not broadly auto-fill request bodies, relax the parser or automatically replay a write.

**New tests:** nine Web cases verify the three exported requests' exact transport, single verification dispatch/no automatic replay after step-up or response loss, body-free GET and actual inline action sites. Before the correction five failed/four passed; after it nine passed. Five new isolated PostgreSQL cases exercise the actual Fastify AppModule for advertiser/campaign/creative/channel-override/video-override deletion: old malformed400, no-cookie401, missing-MFA401, stale-step-up403, foreign-origin403, wrong-role403, data retained/no audit on rejection, then authorizedAD_MANAGER200 with real deletion and exactly one actor-attributed audit record. Those DB cases are authored, not locally executed. Existing content-seeding tests now send the exact real JSON transport for confirm/publish/rollback and assert one publish/rollback audit, retaining all rights/media/ownership state assertions.

**Local validation observed:** all259 Web tests in55files passed; relevant formatting/lint, generated Prisma client, package compilation and API TypeScript passed. Local Node22.16.0 and restored compatible dependencies are not the CI-pinned Node24.19.0 frozen dependency/security baseline. No local PostgreSQL or full backend/browser run is claimed. Full exact-head CI audit/format/lint/types/Prisma/unit/schema/clean integration/build/browser/security gates remain required before merge. No failed assertion is ignored.

**UI/performance/migrations:** no visual layout, translation, schema/index, dependency, workflow, API implementation, ad delivery/configuration, MFA, financial, provider/native or signing changes. No production fixture mutations. No performance gain is claimed; request bodies add two JSON payload bytes only at the corrected action sites. Existing full browser regression runs remain required, but no new screenshot delta is expected from a transport-only correction.

**Unresolved risks:** legacy Admin pending/draft/reload behavior and complete advertising/control-center redesign are separate work; this fix does not make those workflows fully simplified or atomically retry-safe. The existing moderate dependency advisory remains for explicit security-phase triage. Provider approvals, installed PWA, real devices and whole-master acceptance remain external or later-phase evidence, not implied by this PR.

**Next:** publish the exact locally inspected tree, run and review final-head CI including real database cases, fix deterministic findings, then expected-head merge and observed main/deployment proof. Continue shared confirmation/drawer/action components with actual consumers afterward; do not relabel this transport fix as completing all Phase4.

**Rollback:** revert the focused request change only through a validated release when necessary; no DB rollback. Preserve all adopted predecessor security, locale, shared components and creator action fixes. Do not reverse any real production records as part of a code rollback.
