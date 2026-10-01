# AYIN feature surface matrix

## Authority and complete inventory

AYIN at `https://ayin.stream` is one canonical Web/PWA with shared APIs. This file is the current backend-to-product acceptance index for master phases 0–16. Read [the checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md) for exact tested/merged/deployed commits and remaining risks.

The full 73-domain inventory, API/controller/model references, authorization, audience, Web/PWA/mobile surfaces, gaps and test requirements is retained byte-for-byte in [the detailed baseline through #144](AYIN_FEATURE_SURFACE_BASELINE_144.md), which includes the earlier detailed baseline links. It is historical evidence, not a competing authority: the dated entries below supersede its pending statuses. No domain or safety requirement is dropped by this consolidation. `scripts/audit-product-integration.mjs --stdout` supplies exact tracked-source metadata; static filename matches are not runtime/security proof.

**Current accepted main:** `d3484c6ec4d256effb9f440b882428a42ce0aea7`, after accepted/deployed #146 content editing and #147 Admin request repair. Comments/Support and playlist consumers share the same primitives and both translation/test sets. All other audience/permission/internal-only classifications remain as detailed in the baseline. Native clients reuse these Web/PWA/API surfaces where appropriate; physical-device/store acceptance is separate.

## Current adopted surface changes

**Viewer discovery/catalog/TV/Clips:** #140 repaired `/movies`, `/series`, `/tv`, `/creators`, primary-TV identity, rights-aware bounded continuation and detail shells. `/shorts` and `/uploads` deliberately redirect to `/clips` and `/upload`; one manifest owns live shortcuts. #142 added the real `/browse` hub, at most five primary choices and safe mobile/remote navigation. #143 adopted shared headers/states/cards and stable failed-artwork fallback. Server territory/maturity/publication/media eligibility remains unchanged. Full detail redesign, all notification/sitemap links, per-series hydration and device/visual/performance gates are still open. Sources/tests remain the catalog/VideoPolicy/discovery and route/browser suites in the baseline.

**Creator/Admin hierarchy and design:** #142 retains twelve Studio and nineteen role-aware Admin destinations in grouped navigation with breadcrumbs and one existing access/MFA system. #143 uses real shared controls, fields, notices and actual-data metrics on existing Viewer/Studio/Admin pages. No UI-only permission gate, fake metrics, provider activation or whole-route design certification. Full account/creator simplification, coherent domain control centers and remaining advanced editor interactions are not complete.

## Comments and Support — accepted #144

**Domain / capability:** creator Comments review and owned Support tickets. **Backend/API:** unchanged Studio controller/service channel membership for comments and governance controller/service AuthGuard/account ownership for tickets. Existing latest-100 bounds remain. **Audience:** Creator; not new Viewer/Admin/internal controls. **Web/PWA/mobile:** existing `/studio/comments` and `/studio/support`, one Studio main landmark, typed EN/AR.

**Adopted UX:** native captioned scoped-header DataTable, local search/visibility filters explicitly within the recent snapshot, available long-text disclosure. Support has a short grouped form, optional priority, focused ticket disclosure, native input bounds, a synchronous write guard, pending-disabled fields, retained drafts and distinct acknowledged-write/failed-read/uncertain-write states. GET recovery never automatically replays POST. Loading, actual-empty and failed/malformed reads are distinct.

**Acceptance:** head `cd3e8d5ced9997f91517658e32fe7560f8d48563`, merge `5648df8800a801f716e75262dda9abfb784c3b14`; quality `36581604980`, browser `36581605108`, security `36581605127`, inventory `36581604877`; author-side review `5354266635`. Four new screenshots were inspected. Deployment `36586003863` and proof `11041522411` actually verified, including exact release and direct-origin health; see checkpoint for hashes/limits.

**Remaining:** global account-switch consistency, large payload/whole-product performance, full accessibility/route/device acceptance. No new backend capability or security exemption is inferred from native form/table presentation.

## Creator playlist library — accepted reconciled #145

**Domain / capability:** owned playlist collection, create and named edit/preview access. **Backend/API:** existing creator playlist controllers/service, AuthGuard/channel membership, protected Uploads rules and public playlist visibility shaping. Client create type now reflects the actual server selection rather than fabricated summary/count/capability fields. **Audience:** Creator collection management with existing public eligible previews. **Web/PWA/mobile:** `/studio/playlists` and standalone `/channel/playlists`; original item editor `/channel/playlists/[playlistId]` and public channel playlist URLs stay intact.

**Adopted UX:** combines local name/description/visibility search, truthful totals and 12-row presentation pages without extra filter/page requests. Private lists never display a public Preview link. Uncertain POST results are never replayed; failed refresh after acknowledged creation is explicitly different from failed creation; drafts and synchronous pending/disabled behavior are retained. Read recovery is uncached, cancellable and must succeed before another creation.

**Shared component decision:** reuse #144's DataTable and FormSection, add optional scroll label/inline layout and PageControls, and remove the unaccepted duplicate data-workspace implementation. Both domains' consumers, tests and noncolliding EN/AR resources remain. This is one design system, not two parallel table/form APIs.

**Acceptance:** final integrated head `a103dd84885f1abc0fe3aaef18910b8decef3f36`, merge `02e37ce7186eb72f62c940847c630dbc5c8ef159`; quality `36589152705`, browser `36589153132`, security `36589153183`, inventory `36589152929`, recorded author-side review `5354786177`. Prior local combined tests 237/51 files remain scoped evidence. Observed deployment `36591264789`/job `109484655788`, direct-origin health and verified proof `11044590357`; Cloudflare `36591496138` succeeded. Full evidence and hashes are in the checkpoint.

**Limits/action:** collection API is unchanged; presentation paging is not DB pagination. Full creator editor/bulk workflows, backend query/payload measurement and global identity switching are later phases. No raw UUID copy/paste, no new permissions, no financial/provider/native behavior.

## Content, Metadata, Chapters and Captions — Phase 4C reviewed implementation

**Backend/API and authorization:** unchanged `/creator/studio/content` and video PATCH/unpublish/DELETE/caption contracts; AuthGuard and creator channel membership/ownership remain server-enforced. The existing collection defaults to 50 matching latest-updated records, not a global inventory. Basic and advanced metadata remain two backend stages; atomicity is not falsely claimed.

**Audience/surface/mobile:** creator `/studio/content`, same responsive Web/PWA product and direct `/upload` link. The reviewed implementation replaces all-row expanded forms with one library and a focused one-video editor. Shared manual-activation tabs retain mounted Details/Advanced/Captions state, with EN/AR/RTL navigation. Advanced/caption legacy inner copy and browser Back/Forward draft retention remain documented follow-ups.

**Behavior/action:** filter changes no longer recreate an open draft. Native labelled fields/pending state, synchronous mutation guards, confirmation for clean destructive actions, caption-busy coordination and warnings for explicit close/document unload/ordinary links. An acknowledged mutation followed by failed GET is not called a failed write. An unconfirmed/possibly partial mutation keeps the draft and never replays automatically; read-only reload is required before editing again. Removed records are read-only, and no public Watch URL is guessed from an internal ID.

**Evidence/status:** implementation `2ebc0c119e68437452a4bee3306ce7be62c784d2` passed quality36607573341, browser36607573376, security36607573335 and inventory36607573349; author-side review5356461735. Local250 Web tests/54files, lint/format/type/build passed. Four actual isolated browser journeys preserve ownership and foreign-origin rejection, real publication/unpublish/caption deletion, pending/retry/uncertain-state boundaries and historical tests. Four new final screenshots inspected, verified visual artifact11052800099/hash recorded in checkpoint. Actual visual inspection corrected clipped Arabic tabs and redundant headings/breadcrumbs; tab-local bounds/44px targets and one h1 are now tested. Three previously malformed empty-JSON mutation callers send valid `{}` without weakened headers/security. Closing head9d2fed0 passed all final gates and merged as68563b8; deployment36635573371 and proof11064480608 were verified. These release records remain separate from implementation evidence in the checkpoint. Method/limits in [Phase4C evidence](AYIN_PHASE4C_EVIDENCE.md). Not complete Phase4, full creator redesign, native/device or whole-security acceptance.

## All unchanged capability decisions remain in scope

The baseline's detailed entries still govern Authentication/Sessions/Accounts/MFA/Profiles; Watch progress/History/My AYIN; Channels/Uploads; Movies/Series/Episodes/Creator TV/FAST/Clips; Captions/Chapters/Metadata; Community/Comments/Social actions/Notifications/Live; Rights/Maturity/Geographic policy/Kids; Search/Language-aware search/Lens/Recommendations; Recommendation evaluation/Trending/Regional discovery; Localization/Arabic/RTL; Analytics/Cohorts; Revenue/Reconciliation/Payouts/Compliance; Page ads/Video ads/Direct advertising/GAM/SSAI/DAI; Support/Moderation/Trust & Safety; Media processing/Media workers/R2/FFmpeg/HLS/Adaptive playback/Playback fallback/Player; SEO/Sitemaps; Admin/Observability/Database scaling/Operations dashboard; Warehouse export/Backups/Synthetic monitoring; PWA/Android/iOS/TV platforms.

Internal storage/transcoder/queue/warehouse/backup/synthetic execution stays internal; only sanitized role-appropriate summaries are surfaced. Detailed database/observability keeps its existing privileged boundary. Finance, moderation, support and provider writes retain server ownership/roles/current MFA/audit. No ad/provider/backup/store readiness is fabricated. Kids monetization and native advertising require later explicit current-policy acceptance, not extrapolation from a shared Web screen.

## Social actions — accepted Phase 4G delta

**Backend/API and authorization:** unchanged social subscription/reaction/saved-list endpoints and existing AuthGuard/profile isolation remain authoritative. #151 changes client response validation/recovery only; no schema or permission change.

**Viewer surfaces:** channel Subscribe plus Watch Like/Not-for-me/Watch Later/My List now expose failed-read and uncertain-write recovery instead of silent ambiguity. Lost responses are never replayed automatically; Refresh re-reads server truth first. Share cancellation remains local and independent. Controls retain TV focus and EN/AR presentation.

**Evidence/status:** final #151 implementation was accepted and is deployed through the #152 release closure recorded in the checkpoint. Its browser/DB coverage proves one subscription and one reaction after response-loss reconciliation plus saved-list state, Arabic mobile and no overflow. Visual artifact `11137431965` was inspected.

**Remaining:** whole Viewer redesign, installed PWA, current-policy advertising and native/device acceptance remain later phases. Community Viewer recovery is tracked separately below.

## Community Viewer — Phase5B reviewed candidate

**Backend/API and authorization:** unchanged Community AuthGuard, default-profile isolation, public-channel read, feature flag and moderation boundaries remain authoritative. Subscriber feed defaults to 50 items, public channel feed to 30 and the existing service clamps Viewer reads to 100. No schema or production API change.

**Viewer/Web/PWA:** `/community` now reads the authenticated following feed in the browser session instead of relying on a Server Component request that cannot forward the viewer cookie. Public `/c/[handle]/community` stays server-rendered. Both surfaces use shared AYIN primitives, route-scoped EN/AR, RTL-safe layout, TV-focusable actions and truthful loading/error/empty states.

**Mutation recovery:** Like/Poll/Report failures are visible. Lost responses do not trigger automatic replay. Like/Vote can reconcile through an explicit feed refresh; Report requires confirmation and remains disabled after an uncertain write because no viewer report-state read exists. Comment count is metadata only until a bounded public comment-list API exists; no dead or fake comments destination remains.

**Evidence/status:** implementation head `3d4e7999570ed0f25cf04a00832779ed4ba84b05` passed quality `36894020342`, browser `36894020379`, security `36894020643` and inventory `36894020294`. Browser acceptance uses real posts/subscription and committed lost-response mutations, anonymous login gating, public channel rendering and Arabic mobile no-overflow. Final visual artifact `11179062350` was inspected in EN desktop and AR mobile. Merge/deployment are pending final documentation-head checks.

**Remaining:** bounded Viewer comment reading is not fabricated; Studio Community remains Phase6. My AYIN/Lens and other Viewer slices remain Phase5 work; installed PWA/current-policy ads/native/device acceptance remain later phases.

## Acceptance rule

Implemented is not globally accepted. Each intended Viewer/Creator/Admin capability needs a discoverable appropriate surface and its relevant behavioral/security/visual/performance evidence, or an explicit internal-only reason. The current source counts and historical completed tasks do not imply all master phases are complete. Reconcile real code, preserve working backends and URLs, and update this index after each accepted phase.

## Phase4D current candidate delta

Shared confirmation adoption in Studio Content adds explicit named decisions for discard/close, same-tab departure, removal and unpublish; native navigation dialogs share focus-boundary behavior. Audience remains the owning creator, with existing server ownership/Origin and all request guards unchanged. A modal does not grant an API permission or make two-stage metadata writes atomic. The accepted PR147 JSON transport fix is merged/deployed atd3484c6; current confirmation branch is not yet accepted. Existing content browser/API journeys are retained and extended; source/unit/bundle evidence is not actual device or full visual acceptance. History Back/Forward draft recovery, deeper caption uncertainty and broad Admin action adoption remain open. See current checkpoint and Phase4D evidence for exact scope.

## Kids Viewer — Phase5A reviewed candidate

**Backend/API and policy:** existing Kids policy remains authoritative: explicit Kids classification is required, Community stays disabled, and Kids links carry `kids=1`. Existing `/public/discovery/kids` and `/public/discovery/kids/rows/:key` endpoints are reused; no new permission or policy endpoint is added. Kids home now preserves its safe continuation cursor instead of discarding it, and the client uses only the Kids-specific row endpoint for continuation.

**Viewer/Web/PWA:** `/kids` now uses shared PageHeader/StatusNotice and AYIN design tokens with route-scoped EN/AR consumer copy. Internal legal/compliance implementation statements are not shown to viewers. The three policy-allowed discovery sources receive localized row/kicker labels in Kids mode; normal Home/API source titles remain unchanged.

**Evidence/status:** implementation head `3accee5de15a6c34d8f91fc73376425961df0c14` passed quality `36875582398`, browser `36875582595`, security `36875582558` and inventory `36875582373`. Browser/API regression uses ten Kids-classified videos plus a newer ordinary video, exercises first and second pages, requires `kids=1`, confirms the continuation request uses the Kids endpoint and preserves Community-disabled policy. Visual artifact `11168594768` was inspected in EN desktop and AR mobile.

**Remaining:** no Kids ad/legal certification is inferred. Current-policy Kids advertising, profile-transition UX, installed PWA/device validation and whole Viewer redesign remain later master work.
