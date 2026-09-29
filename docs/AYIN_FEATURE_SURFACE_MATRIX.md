# AYIN feature surface matrix

## Current authority and evidence

This is the backend-to-product inventory for the current Web/PWA master phases 0–16. AYIN at `https://ayin.stream` remains one canonical Web/PWA product with platform capability adapters. Read [the master checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md) for accepted heads, tests, deployment, unresolved risks and the next phase.

The complete detailed capability entries, API/controller paths, authorization boundaries, intended audiences, Web/PWA/mobile routes, missing UX and test requirements are preserved in [the detailed baseline matrix](AYIN_FEATURE_SURFACE_DETAIL_BASELINE_140.md). **That document is a historical snapshot, not a second current authority.** Its pending-PR and obsolete-placeholder statements are superseded by the dated reconciliation below. All 73 authored domain labels remain in scope; no capability or security requirement is deleted by consolidating this index.

Source inventory schema v2 is generated with `node scripts/audit-product-integration.mjs --stdout`. It includes every tracked-file hash, route/import/layout candidate, controller/endpoint path, backend file, model, migration, worker, platform, workflow, feature and authored semantic classification. Filename matches and historical semantic review are not runtime or authorization proof. The historical committed JSON remains history, not a current generated report.

## Fresh source evidence — 2026-09-28

Accepted product baseline: main `39731c6a8a069e92732f95c4b7db7afa30cbb5c2`, including PR #140. Deployment `36379170040` and its verified immutable artifact `10952038374` establish this release at deployment time; the checkpoint records the exact proof and health boundary.

Inspected source artifact: run `36379315415`, artifact `10952330981`, ZIP SHA-256 `bd3453054040c2654edee2dae5cb59af154b14c9d68ca5318c8f0ffae4a6adab`. Checked-out source `dcfd1351e22a8cffff0309e06b90a76b8bc3af25` is the clean PR #141 test-merge snapshot for head `81dbdaa7847e972913e44c8c4656896aed945657`, not a main commit. It contains 1220 tracked files, 78 Web routes (70 pages and 8 handlers), 54 controllers, 364 endpoint paths, 73 authored feature labels, 119 models, 57 migrations, 285 backend source files, 8 worker-named source files, 113 platform files and 50 deployment/workflow files. These are snapshot counts; later edits change them. Static workers are not running worker instances.

## Accepted deltas that supersede the detailed baseline

### Public catalog and canonical routes

**Capabilities:** Channels, Movies, Series, Episodes, Creator TV, FAST, Clips, Uploads, PWA, Localization, Arabic/RTL, SEO and Sitemaps where affected by the route change.

**Backend/API:** existing `discovery/discovery.controller.ts`, Movie/Series catalog controllers/services, trusted-region context and VideoPolicy; source paths are relative to `apps/api/src/`. **Authorization:** eligible public catalog/channel/TV reads; creator/Admin mutations keep existing server guards. **Audience/surfaces:** Viewer `/movies`, `/series`, `/tv`, `/creators` are real localized server-rendered directories, not placeholders. Details preserve the Viewer shell. `/shorts` redirects to `/clips`; `/uploads` redirects to `/upload`, preserving locale/query. One generated manifest owns correct Upload/TV shortcuts. Web/PWA/mobile share these routes.

**Status:** accepted PR #140, not pending. Directory reads are bounded and rights-aware, with keyset continuation, primary-TV ownership, no-store trusted context, genuine-404 discrimination and Movie batch hydration. Configuration ACTIVE is not proof of FAST/provider delivery. **Missing UX/action:** complete design/accessibility, failed-artwork fallback, full detail translation, all notification/SEO/deep links and large-catalog acceptance remain open. Per-series hydration remains a measured performance follow-up. Manifest repair is not complete PWA acceptance. **Tests:** directory unit/query contracts; PostgreSQL policy/territory/date/parity/traversal/owner fixtures; browser EN/AR/RTL, continuation, links, aliases, manifest and overflow; existing catalog tests retained. Exact successful runs and reviewed screenshots are in the checkpoint.

### Shared Admin access and earlier integrated workspaces

**Capabilities:** Admin, MFA, Regional discovery, Recommendation evaluation, Trending, Media processing, Media workers, HLS, Observability, Database scaling, Warehouse export and Operations dashboard.

**Status:** do not infer missing implementation from old generator gap strings. Current `AdminSidebar` already consumes `useAdminAccess`; shared session and reauthentication work is not an open reimplementation task. Earlier reviewed media-generation/recovery, application/database/warehouse status, discovery evaluation/trending and scoped merchandising improvements remain implemented. PR #139 accepted scoped draft/request recovery. **Audience/authorization:** role-scoped Admin/Operations; detailed observability retains its SUPERADMIN boundary; privileged mutations retain current MFA, confirmation and transactional audit. **Missing UX/action:** 19-link flat Admin navigation, coherent control centers, contextual entity selection, localization and complete workflow regression remain current master work. Internal command execution does not become Viewer/Creator UI. **Tests:** retain earlier Admin/MFA/ownership/media/concurrency/operator/browser suites and revalidate changed journeys. Production/provider success cannot be inferred from fixtures.

## Complete domain coverage and next acceptance

Every group below inherits the exact controller/model/surface/test detail in its named section of the preserved detailed matrix. The explicit current statuses and actions here take precedence. Ordinary responsive routes are available through the shared Web/PWA; actual device and standalone-mode acceptance is separate. Link visibility never replaces server authorization.

### Authentication, Sessions, Accounts, MFA, Profiles

**Audience:** Viewer/account owner; separately guarded Admin user/security operations. **Surfaces:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/account`, `/my-ayin`, `/kids`, `/admin/users`. **Authorization:** session/profile ownership, CSRF, revocation, export/deletion safeguards and scoped Admin roles/step-up. **Status/action:** account and MFA surfaces exist; general profile management is not established by inventory. Simplify the Account hub, sign-in return context and error recovery without exposing one-time secrets or private state. **Tests:** auth/session/privacy/MFA/profile isolation plus account-switch and cache-boundary acceptance after consolidation. Not internal-only.

### Watch progress, History, My AYIN

**Audience:** authenticated Viewer/profile owner. **Backend:** Watch/discovery controllers. **Surfaces:** `/my-ayin`, `/watch/[slug]`. **Status/action:** existing personal library; make Continue Watching, Watch Later, Likes, History and subscriptions discoverable. Verify current post-policy empty/cursor behavior instead of assuming historical findings remain open. **Tests:** watch/discovery/profile isolation and continuation; no cross-account caching. Not internal-only.

### Channels, Uploads, Playlists

**Audience:** eligible public Viewer reads; creator channel membership for editing. **Backend:** channel, quick-upload, media-upload and playlist controllers. **Surfaces:** `/creators`, `/c/[handle]`, `/upload`, `/studio/channel`, `/studio/content`, `/studio/playlists`, existing `/channel/*` aliases/editors and public playlist details. **Status/action:** preserve real directories and direct R2/multipart retry/presign/stall/progress. Keep ordinary upload minimal and advanced metadata optional; simplify publish persistence atomically. Shared legacy editor wrappers are deliberate reuse, not duplicate products. **Tests:** upload/metadata/playlist/channel, large-upload/cancel/retry and save/publish/ownership journeys. Not internal-only.

### Movies, Series, Episodes, Creator TV, FAST, Clips

**Audience:** policy-eligible public Viewer; creator-owned TV/Clips management; separately guarded catalog/provider Admin. **Surfaces:** real directories/details, Watch episode context, `/clips`, public channel TV, `/studio/tv`, `/admin/movies`, `/admin/series`, `/admin/tv`. **Status/action:** route repair accepted as above; preserve release/territory/maturity/ownership rules. Complete detail/episode/short-form UX and provider command audit/concurrency review. Actual FAST output and hardware require independent evidence. **Tests:** catalog/TV/Clips and rights-aware traversal, plus future consolidated journeys. No public provider credentials or commands.

### Captions, Chapters, Metadata

**Audience:** eligible Viewer playback and creator-owned editing; separate Admin metadata writes. **Surfaces:** Watch, `/upload`, `/studio/content`, `/admin/videos`. **Status/action:** existing capability; use contextual editors and optional advanced settings. The remaining `Series / episode placeholder` label in `video-metadata-fields.tsx:298` needs real creator-permission/metadata review before replacement. SEO/tags/captions/manual thumbnails must not become ordinary upload requirements. **Tests:** metadata/upload/caption/watch contracts and language/keyboard/RTL rendering. Not internal-only.

### Community, Comments, Social actions, Notifications, Live

**Audience:** eligible public feeds/playback; authenticated Viewer actions; creator-owned management and scoped moderation. **Surfaces:** `/community`, channel Community, Watch, `/notifications`, `/live/[slug]`, `/studio/community`, `/studio/comments`, `/studio/live`. **Status/action:** existing surfaces need coherent design, pending/error/empty handling and correctly localized links. Preserve live secret cleanup, key rotation, draft recovery, ownership and audit; listing bounds and terminal provider-command concurrency remain review items. **Tests:** community/comments/social/notification/live, account-switch cleanup, moderation and reconnect. Real provider delivery is external evidence.

### Rights, Maturity, Geographic policy, Kids

**Audience:** server-enforced Viewer eligibility; creator-owned declarations; scoped Admin policy decisions. **Backend:** VideoPolicy, catalog rights and trusted-region boundaries. **Surfaces:** Kids, Watch, content editors, `/admin/kids`, `/admin/trust`. **Status/action:** preserve conservative unknown-region behavior, date/territory parity and hard playable/public requirements. Remove developer/legal caveats from consumer copy without claiming legal certification. Kids monetization requires a separate strict current-policy decision. **Tests:** policy/Kids/profile/territorial SQL parity plus advertising and transition acceptance. Low-level enforcement remains internal.

### Search, Language-aware search, Lens, Recommendations

**Audience:** public/profile-safe Viewer discovery and existing authenticated Lens context. **Backend:** search/recommendation controllers and optional semantic-provider boundary. **Surfaces:** `/search`, `/my-ayin/lens`, Home, Watch, Clips. **Status/action:** retain bounded language-aware queries, rights/maturity, lexical fallback and exposure attribution; no invented provider availability or production lift. Improve hierarchy and state handling while preserving public server rendering. **Tests:** search/Lens/recommendation/privacy/exposure and locale journeys; production latency requires measurement.

### Recommendation evaluation, Trending, Regional discovery

**Audience:** scoped Admin/Operations control, not Viewer diagnostics; Viewer consumes safe resulting content. **Backend:** Admin evaluation/trending/product controls and discovery. **Surfaces:** existing discovery Operations workspace, `/admin/product-controls`, Home. **Status/action:** earlier integration and PR #139 draft recovery are accepted; group navigation, preserve fixture/version/exposure/export distinctions, unrelated drafts, validation, step-up and audit. **Tests:** operator/merchandising/API/browser; ranking improvement is not claimed from fixed fixtures.

### Localization, Arabic/RTL

**Audience:** Viewer locale choice; permission-scoped creator/Admin editing. **Backend:** catalog-localization controllers/models and Web i18n/routing. **Surfaces:** shared shells/catalog/search and `/admin/catalog-localizations`. **Status/action:** directory EN/AR/RTL acceptance is real but not universal. Review English-only Admin/Studio copy, physical-direction CSS, long mixed-script text, focus and complete details. **Tests:** i18n/catalog/localization and route-by-route responsive/keyboard/RTL acceptance.

### Analytics, Cohorts

**Audience:** creator-owned aggregates and scoped Admin. **Backend:** analytics controllers and rollups. **Surfaces:** `/studio/analytics`, `/admin`. **Status/action:** dashboards exist; consolidate filters and lazy loading while retaining cohort suppression, dates and metric definitions. **Tests:** analytics/rollup/privacy; measured latency and production data remain separate. Never fabricate counts/revenue.

### Revenue, Reconciliation, Payouts, Compliance

**Audience:** creator-owned earnings/submissions and separate finance Admin roles; reconciliation mutations are Admin-only. **Backend:** revenue, reconciliation, payout-provider and creator-compliance controllers. **Surfaces:** current Account earnings, `/studio/monetization`, `/admin/revenue`, payout details. **Status/action:** build coherent Finance navigation and named selectors; preserve immutable ledger, sensitive identity scope, current step-up, transactional audit and high-risk confirmation. **Tests:** ledger/reconciliation/payout/compliance/IDOR and simplified-workflow regression. Provider configuration is not completed transfers or compliance approval.

### Page ads, Video ads, Direct advertising, GAM, SSAI/DAI

**Audience:** consent-eligible public inventory; separately guarded advertising Admin and provider diagnostics. **Backend:** advertising-control, page/video-ad and GAM production controllers; supported runtime adapters. **Surfaces:** current Home/Watch/player/Live/TV hooks and `/admin/advertising`, `/admin/video-ads`. **Status/action:** consolidate Admin entrypoints later; retain logical placements, consent, kill switch, masked credentials, seller files, clean no-fill and content recovery. Full-surface inventory, density/CLS, official-policy research and native-app distinctions remain Phase 11. No default ads on auth/upload/Studio/Admin/sensitive Account/finance; Kids remains separately gated. **Tests:** ad runtime/consent/diagnostics/player/fallback and blocked-script/navigation/device/no-fill. No invented fill, revenue, SDK compatibility or provider delivery.

### Support, Moderation, Trust & Safety

**Audience:** creator-owned tickets/trust workflows and assigned/scoped Admin/moderators. **Backend:** governance, trust and Admin control controllers. **Surfaces:** `/studio/support`, `/studio/trust`, contextual comments/content, `/admin/operations`, `/admin/trust`, `/admin/moderation`. **Status/action:** focused contexts and named selectors instead of UUIDs; preserve reasons, ownership, assignment, MFA, audit and destructive confirmation. **Tests:** support/governance/trust/moderation/IDOR and role-specific workflow regression. Not public diagnostic controls.

### Media processing, Media workers, HLS

**Audience:** internal generation/queue execution; guarded Operations summaries/recovery; creator-owned progress and eligible Viewer playback. **Backend:** media-processing controller, queue/lifecycle/generation-safety/rollout services. **Surfaces:** upload progress, player, `/admin/operations`, `/admin/operations/media`. **Status/action:** preserve accepted generation fencing, atomic claims, leases/heartbeats, stale-generation recovery, bounded reads, pause/retry/reprocess and audited step-up. No arbitrary transcoder/queue commands for ordinary users. **Tests:** media/storage/lease/generation/operator/integration; throughput and multi-host production evidence remain separate.

### R2, FFmpeg

**Audience:** internal/background-only. **Backend:** storage adapter and processing worker. **Surface:** no standalone user console; only safe progress/outcomes in upload and Operations. **Status/action:** remain internal by design; never expose credentials, object commands or arbitrary execution for UI coverage. **Tests:** storage/FFmpeg/runtime/integration; production capacity/restore requires actual measurement.

### Adaptive playback, Playback fallback, Player

**Audience:** policy-eligible Viewer. **Backend:** Watch and supported media/native adapters. **Surfaces:** Watch, Live and channel TV. **Status/action:** keep video dominant and preserve ABR, canonical MP4 fallback, captions, progress and ad failure recovery. **Tests:** player/HLS/fallback/browser; startup, buffering, mobile/remote and hardware acceptance remain explicit. No exposed processing controls.

### SEO, Sitemaps

**Audience:** public machine-readable metadata, with internal generation and eligibility filtering. **Backend:** SEO/sitemap controllers and Web metadata. **Surfaces:** public canonical content/metadata, not an end-user console. **Status/action:** accepted aliases remove high-value placeholder entries; complete all sitemap/canonical/locale/deep-link review and retain private-content exclusion. **Tests:** existing sitemap/rights/metadata/route contracts; production crawl is separate.

### Admin, Operations dashboard, Observability, Database scaling

**Audience:** server-scoped Admin/Operations; detailed observability retains SUPERADMIN. **Backend:** Admin control/operations/observability and database services. **Surfaces:** Admin domain pages, Operations and media/database/discovery/warehouse/observability drill-downs. **Status/action:** existing shared access and truthful sanitized summaries remain; transform flat navigation, breadcrumbs, mobile controls and domain workflows without arbitrary SQL or unnecessary indexes/replicas. **Tests:** role/MFA/audit/bounded-query/operator/browser; database plans and production latency remain measured follow-ups.

### Warehouse export, Backups, Synthetic monitoring

**Audience:** internal/background-only execution; scoped Operations read-only summaries. **Backend:** warehouse worker/checkpoint and trusted Operations report producers. **Surfaces:** existing Operations status workspaces only. **Status/action:** retain sanitized bounded checkpoints and actual missing/stale/report status; no raw warehouse facts, credentials, arbitrary exports, backup/restore or probe buttons for ordinary users. Checkpoints are not heartbeats. **Tests:** status/report/warehouse/privacy contracts; actual export/backup/restore/synthetic health requires observed external evidence.

### PWA, Android, iOS, TV platforms

**Audience:** Viewer/creator shared product with normal server authorization and platform capability exceptions. **Backend:** shared APIs; Web manifest/service worker and existing Android/iOS/Tizen/webOS/tvOS code. **Status/action:** manifest/aliases accepted; full PWA bounded static caching, account isolation, no private/upload/ad/media caches, controller-change update sequencing, offline/reconnect and installability remain open. Preserve Android's shared shell and useful bridges. Assess duplicated ordinary iOS UI against current Apple policy without blindly rewriting required native auth/player/focus. Routine Web changes versus native SDK/permission/entitlement releases must be explicit. **Tests:** existing structural/build/platform contracts, then installed-PWA/native/device matrices. No signing, store submission/approval or physical-device claim from source/browser checks.

## Acceptance rule

Implemented or inventoried is not complete. Each user-facing capability needs a discoverable appropriate surface plus its relevant behavioral/security/visual/performance evidence; each internal capability needs an explicit reason to remain internal. Review the full detailed baseline alongside these current deltas until every master phase is accepted. Do not expose internal APIs merely to fill a matrix, delete working capabilities without UI, or treat historical remediation phase numbers as current master acceptance.

## Phase 4A design foundation adoption — 2026-09-29 candidate

From accepted main `96bb5e36563e80b9a13b7ffe66fc46f5b6c0fb6a`, the proposed foundation uses real shared headers/actions/fields/status/counters on Viewer Browse/directories, creator Studio/Playlists and Admin overview/search. Existing API callers, intended audiences and server permissions are unchanged. Media-card image failures reveal a stable decorative fallback while preserving the original content link. No worker, provider or financial capability is exposed by this styling work.

`AYIN_DESIGN_SYSTEM.md` maps components to actual consumers and separates remaining Phase 4 interactions/tables/forms from this foundation. Local Web tests/types/lint/build have passed; final CI/browser/visual/security acceptance remains pending in the master checkpoint. This entry does not claim full route redesign, PWA lifecycle, advertising/provider or native readiness.

## Phase 4B reconciliation — creator playlists, implementation under review

Backend authority remains `creator/playlist.controller.ts` and `creator/playlist.service.ts`: AuthGuard, channel ownership, protected Uploads and existing transactions unchanged. Creator surfaces `/studio/playlists` and `/channel/playlists` share one improved library consumer: EN/AR fields, named manage/preview links, actual totals, bounded local presentation, combined filters, and explicit loading/error/empty/recovery. The existing item editor remains on its working URL. Private records never gain public Preview through the new table; full record capabilities are read only from the real collection response.

Reusable FieldGroup/DataTable/PageControls have real adoption and semantic/request/filter tests. Create-once/refresh-failure/lost-response browser checks are added, but acceptance is pending final-head CI and actual visual review. There is no new backend pagination, provider/financial action or internal diagnostic UI. This supersedes only the relevant playlist missing-UX notes; other master capability statuses are unchanged.
