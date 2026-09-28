# AYIN feature surface matrix

## Authority and evidence

This is the human backend-to-product inventory for the current Web/PWA master goal. Read [the master checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md) for exact accepted commits and phase status. AYIN remains one Web/PWA product, with platform capability adapters rather than independently maintained ordinary product UIs.

The entries below reconcile all **73 domain labels** in the historical [source inventory](AYIN_PRODUCT_INTEGRATION_MATRIX.json) and [authored audit](AYIN_PRODUCT_INTEGRATION_AUDIT.md). Related capabilities share an entry where their authorization and product surfaces are the same. Historical filename matches are not runtime coverage. Full per-endpoint, visual, device and production acceptance remains open; this document does not mark the master audit complete.

Source baseline: accepted main `912e64b3ef91644abe9b8c2475ea3faffb519597`. The route implementation in PR #140 is under review. API source paths below are relative to `apps/api/src/`; Viewer, Creator and Admin paths identify Web/PWA destinations, not new access permissions. Mobile/PWA access uses those same responsive routes unless an entry explicitly says internal or native. Physical-device verification is separate.

**Test notation:** existing test inventory means the named domain's `tests` entries in the historical JSON; it is source evidence, not a new successful run. New route tests are `apps/api/test/public-directory.integration.test.ts`, `apps/web/src/lib/public-directory.test.ts`, `apps/web/src/lib/public-route-integrity.test.ts` and `tests/e2e/public-directories.acceptance.spec.ts`. Exact execution results belong in the checkpoint. A hidden navigation link is never an authorization control.

## Identity and personal library

### Authentication, Sessions, Accounts

**Backend/API:** `auth/auth.controller.ts`, `privacy/privacy.controller.ts`. **Audience/authorization:** Viewer account owner; scoped Admin user operations remain separately guarded. **Web/PWA/mobile:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/account`; Admin `/admin/users`. **Status/action:** existing surfaces with gaps; unify request failures, sign-in return context and the Account hub without weakening revocation, CSRF, ownership, privacy export/deletion or audit. Not internal-only. **Tests:** existing auth/session/privacy inventory; full account-switch and simplified-workflow regression remains required.

### MFA

**Backend/API:** `auth/auth.controller.ts`, `admin/admin.guard.ts`. **Audience/authorization:** authenticated account ownership for enrollment/recovery; server roles and current step-up for privileged operations. **Web/PWA/mobile:** `/login`, `/account`, privileged Admin confirmation. **Status/action:** historical Account MFA acceptance through PR #134 follows recovery/enrollment/concurrency fixes in #131–#133. Retain one-time secrets, revocation, no-store and audit. Full design/device acceptance remains open. Not internal-only. **Tests:** historical account-MFA unit/integration/browser journeys; revalidate after navigation/workflow consolidation.

### Profiles

**Backend/API:** `discovery/discovery.controller.ts`. **Audience/authorization:** Viewer profile ownership and Kids policy context. **Web/PWA/mobile:** `/my-ayin`, `/kids`. **Status/action:** partial surface; default/Kids context exists, but general profile switching/management is not established merely by the inventory. Do not invent an implemented profile manager. **Tests:** existing discovery/profile isolation tests; account switching and private-cache boundaries require explicit acceptance.

### Watch progress, History, My AYIN

**Backend/API:** `watch/watch.controller.ts`, `discovery/discovery.controller.ts`. **Audience/authorization:** authenticated Viewer/profile-scoped actions and public playback policy. **Web/PWA/mobile:** `/my-ayin`, `/watch/[slug]`. **Status/action:** existing surfaces; make Continue Watching, History, Watch Later, Likes and subscriptions discoverable. Recheck post-policy empty states and capped cursors while preserving scan position and profile isolation. Not internal-only. **Tests:** existing watch/discovery suites; historical defect status must be verified against current code rather than assumed open or fixed.

## Creator and catalog

### Channels

**Backend/API:** `creator/channel.controller.ts`; new public creator directory in `discovery/discovery.controller.ts`. **Audience/authorization:** public active/non-removed channel reads; creator membership for management; separate Admin guards. **Web/PWA/mobile:** `/creators`, `/c/[handle]`, `/studio/channel`, `/channel/edit`, `/admin/channels`. **Status/action:** the real bounded creator index is implemented in PR #140 pending acceptance. Shared editor wrappers are intentional reuse; do not create a second channel product. **Tests:** new route/integration/browser tests plus existing channel tests.

### Uploads

**Backend/API:** `creator/quick-upload.controller.ts`, `media/media-upload.controller.ts`. **Audience/authorization:** authenticated creator and upload ownership, signed upload sessions and server validation. **Web/PWA/mobile:** `/upload`; old `/uploads` redirects there. **Status/action:** direct R2/multipart flow exists; corrected manifest shortcut is under review. Preserve retries, presign renewal, stall handling and monotonic progress. Simplify publish/details safely and keep advanced metadata optional. **Tests:** existing upload/media suites; large-upload, cancellation and publish persistence journeys remain required.

### Playlists

**Backend/API:** `creator/playlist.controller.ts`. **Audience/authorization:** public eligible playlist reads; creator channel membership for writes. **Web/PWA/mobile:** `/c/[handle]/playlists/[slug]`, `/studio/playlists`, `/channel/playlists`, `/channel/playlists/[playlistId]`. **Status/action:** integrated with gaps; shared components are intentional. Clarify canonical entry and return context, use named video selectors and preserve ordering/ownership. **Tests:** existing playlist inventory and creator/browser journeys.

### Movies

**Backend/API:** `movie-catalog/movie-catalog.controller.ts`, `movie-catalog/admin-movie-catalog.controller.ts`, existing catalog/VideoPolicy services. **Audience/authorization:** public availability-filtered reads; guarded catalog Admin mutations. **Web/PWA/mobile:** `/movies`, `/movies/[slug]`, `/admin/movies`. **Status/action:** PR #140 replaces the placeholder with localized SSR browse and bounded continuation, filters catalog/video rights before page limits, batches movie hydration, distinguishes upstream failure from missing content and adds the Viewer shell to details. Final design, concurrent-state and production performance acceptance remain open. **Tests:** new strict-query, territorial parity, 80-title traversal, private/removed/unplayable exclusion and browser directory/detail tests; existing catalog suites retained.

### Series, Episodes

**Backend/API:** `series-catalog/series-catalog.controller.ts`, `series-catalog/admin-series-catalog.controller.ts`, catalog/VideoPolicy services. **Audience/authorization:** public catalog/episode eligibility; separately guarded Admin mutations. **Web/PWA/mobile:** `/series`, `/series/[slug]`, Watch episode context, `/admin/series`. **Status/action:** PR #140 adds the real localized index, eligible released-episode filtering and compact directory responses, preserving legacy no-rights-row global availability. Seasons/episodes/details already exist. Full per-series hydration remains a measured performance follow-up; do not claim an N+1 fix for this domain. **Tests:** new directory/release/privacy/parity tests and real browser links; existing series/context tests remain authoritative.

### Creator TV, FAST

**Backend/API:** `creator/creator-tv.controller.ts`, `creator/creator-tv-linear-output.controller.ts`, new discovery TV directory. **Audience/authorization:** public eligible playback; creator membership for schedules; separately guarded Admin/provider operations. **Web/PWA/mobile:** `/tv`, `/c/[handle]/tv`, `/studio/tv`, `/channel/tv`, `/admin/tv`. **Status/action:** PR #140 lists only each active channel's active, correctly owned primary TV, never a secondary output under the primary route. Configuration marked ACTIVE is not a claim of live provider playback. Keep provider activation/credentials, command concurrency and audit review separate. **Tests:** new primary/secondary/owner/disabled tests plus existing TV/FAST contracts; actual hardware/provider output remains external evidence.

### Clips

**Backend/API:** `creator/clips.controller.ts`. **Audience/authorization:** public eligible clips; creator-owned creation/editing. **Web/PWA/mobile:** `/clips`, `/upload`, `/studio/content`; `/shorts` becomes a locale/query-preserving alias. **Status/action:** one Clips product, with existing saved `navigation.shorts` configuration preserved and destinations normalized. Dedicated short-form UX/ad policy remains later acceptance. **Tests:** new navigation/alias contracts and browser redirect journey; existing clips tests retained.

### Captions

**Backend/API:** `creator/caption.controller.ts`, `watch/watch.controller.ts`. **Audience/authorization:** public eligible playback tracks; creator ownership for editing. **Web/PWA/mobile:** Watch player and `/studio/content`. **Status/action:** manager/player integration exists; simplify contextual editing and verify language, accessibility, keyboard and target-device rendering. Not an operations screen. **Tests:** existing caption/watch tests; device/subtitle acceptance remains open.

### Chapters, Metadata

**Backend/API:** `creator/quick-upload.controller.ts`, `admin/admin-video-metadata.controller.ts`. **Audience/authorization:** creator ownership and separately guarded Admin metadata writes; public eligible chapter reads. **Web/PWA/mobile:** `/upload`, `/studio/content`, `/watch/[slug]`, `/admin/videos`. **Status/action:** extensive fields already exist; progressively disclose advanced controls and remove stale Series-unavailable copy after checking actual creator permissions. Never make SEO, tags, captions or manual thumbnails mandatory for ordinary upload. **Tests:** existing metadata/upload/watch tests and atomic save/publish regression after simplification.

## Social and live

### Community

**Backend/API:** `community/community.controller.ts`. **Audience/authorization:** eligible public feed; authenticated/creator-owned writes; server moderation roles. **Web/PWA/mobile:** `/community`, `/c/[handle]/community`, `/studio/community`, `/admin/moderation`. **Status/action:** features exist; redesign the minimal feed and remove inconsistent inline styling. Preserve poll/moderation semantics and clear failure/pending states. **Tests:** existing community inventory; full EN/AR/mobile and moderated-state browser coverage remains open.

### Comments

**Backend/API:** `comments/comments.controller.ts`. **Audience/authorization:** authenticated eligible Viewer actions, creator contextual moderation and Admin roles. **Web/PWA/mobile:** `/watch/[slug]`, `/studio/comments`, `/admin/moderation`. **Status/action:** integrated; retain ownership/reasons/abuse protections while simplifying moderation. Review keyboard, RTL and action recovery. **Tests:** existing comments/trust/browser inventory.

### Social actions, Notifications

**Backend/API:** `social/social.controller.ts`. **Audience/authorization:** Viewer account/profile-scoped actions; public channel context. **Web/PWA/mobile:** Watch, `/notifications`, `/c/[handle]`. **Status/action:** mounted controls/feed exist; verify success/failure feedback, account-switch cleanup and correct localized destination links. Do not cache another account's personalized state. **Tests:** existing social/notification tests and cross-route/account regression.

### Live

**Backend/API:** `live/live.controller.ts`. **Audience/authorization:** public eligible live watch; creator stream ownership; privileged provider/key operations. **Web/PWA/mobile:** `/live/[slug]`, `/studio/live`. **Status/action:** historical PR #126 accepted recovery/pending/drafts/key rotation/secret cleanup/ownership/audit and Arabic mobile. Unbounded listing and terminal provider-command concurrency remain review items. Real provider/hardware activation is not established by passing fixtures. **Tests:** existing live/API/browser tests; provider and device plans remain separate.

## Rights, discovery and localization

### Rights, Maturity, Geographic policy, Kids

**Backend/API:** `video-policy/video-policy.service.ts`, `admin/admin-video-policy.controller.ts`, trusted-region and catalog policies. **Audience/authorization:** Viewer eligibility enforced server-side; creator-owned declarations; separately guarded Admin policy/moderation decisions. **Web/PWA/mobile:** `/kids`, Watch, upload/content editors, `/admin/kids`, `/admin/trust`. **Status/action:** never bypass policy to make a directory fuller. Unknown region remains conservative; exact territory and date-boundary semantics must agree with existing catalog rules. Replace consumer-facing legal/developer caveats without falsely claiming legal approval. Kids monetization remains a separate strict policy decision. **Tests:** existing policy/Kids suites plus new SQL-versus-policy, trusted-header, publication and media eligibility tests. Full profile switching and advertising compliance are not certified here.

### Search, Language-aware search

**Backend/API:** `search/search.controller.ts`. **Audience/authorization:** public eligibility-filtered discovery, scoped context where required. **Web/PWA/mobile:** `/search`. **Status/action:** lexical/language-aware UI exists; preserve bounded query behavior, rights/maturity filters, localization and RTL. Improve empty/error/loading and result hierarchy without converting every public page to client rendering. **Tests:** existing search suites; measured query/latency and locale browser acceptance remain open.

### Lens

**Backend/API:** `search/search.controller.ts`, `CatalogSearchEmbedding` boundary. **Audience/authorization:** Viewer with existing authenticated/profile requirements. **Web/PWA/mobile:** `/my-ayin/lens`. **Status/action:** lexical fallback and optional semantic boundary exist; no claim that an external AI provider is configured. Keep operational provider settings out of ordinary Viewer UI. **Tests:** existing Lens/search inventory and provider-disabled/fallback cases.

### Recommendations

**Backend/API:** `recommendations/recommendation.controller.ts`. **Audience/authorization:** Viewer public/profile-safe recommendations and feedback; Admin configuration remains privileged. **Web/PWA/mobile:** Home, Watch, Clips; existing Admin settings/discovery workspaces. **Status/action:** verify recommendations, versions and exposure attribution independently; never present fixture scores as measured production improvement. **Tests:** existing recommendation/privacy/exposure suites and full Viewer journeys.

### Recommendation evaluation, Trending

**Backend/API:** `admin/admin-recommendation-evaluation.controller.ts`, `admin/admin-trending.controller.ts`. **Audience/authorization:** OPERATIONS controls; mutations keep required step-up and audit. **Web/PWA/mobile:** existing discovery Operations workspace, not a Viewer diagnostic screen. **Status/action:** historical PR #124 provides fixed-fixture comparisons, versions/exposure evidence/export intent and reviewed trending configuration. Retain draft preservation, attribution limits and last-write-wins caveats; improve grouped navigation and localization. **Tests:** historical discovery-operator unit/integration/browser tests; production impact remains unverified.

### Regional discovery

**Backend/API:** `admin/admin-product.controller.ts`, `discovery/discovery.controller.ts`. **Audience/authorization:** public safe discovery; server-scoped Admin/OPERATIONS merchandising writes with step-up/audit. **Web/PWA/mobile:** Home and `/admin/product-controls`. **Status/action:** PR #139's recovery/single-snapshot/scoped-save behavior is accepted at the recorded main. Preserve unrelated drafts, trusted location, cohort fallback and explicit regional validation; don't replay writes after identity verification. **Tests:** `admin-product.test.ts` and merchandising workspace browser journeys; complete design remains later.

### Localization, Arabic/RTL

**Backend/API:** `catalog-localization/catalog-localization.controller.ts`, catalog localization models and Web i18n/locale routing. **Audience/authorization:** Viewer locale choice; permission-scoped creator/Admin editing. **Web/PWA/mobile:** Search, catalog directories/details, `/admin/catalog-localizations` and shared Web shells. **Status/action:** EN/AR directories are part of PR #140; existing Admin/Studio English copy, physical-direction CSS and full detail translation require route-by-route review. Do not claim universal RTL acceptance from a shared stylesheet. **Tests:** existing i18n/localization suites plus directory/alias/RTL browser journeys; broader accessibility/device checks remain open.

## Analytics and finance

### Analytics, Cohorts

**Backend/API:** `analytics/analytics.controller.ts` and event/daily/cohort rollups. **Audience/authorization:** creator-owned aggregates and scoped Admin analytics; privacy suppression remains mandatory. **Web/PWA/mobile:** `/studio/analytics`, `/admin`. **Status/action:** already surfaced; preserve minimum cohorts, date definitions and evidence distinctions. Consolidate filters and avoid loading all datasets on first paint. Never fabricate revenue, viewers or cohort results. **Tests:** existing analytics/rollup/privacy suites; real data latency and load measurements remain separate.

### Warehouse export

**Backend/API:** `warehouse/warehouse-export.service.ts`, `warehouse/warehouse-export-worker.service.ts`, `WarehouseExportCheckpoint`. **Audience/authorization:** internal worker execution; sanitized scoped Operations read-only summary. **Web/PWA/mobile:** existing Operations warehouse status workspace, not a Viewer/Creator export console. **Status/action:** historical PR #125 accepted bounded sanitized configuration/checkpoint status. No raw facts, credentials, arbitrary execution or export mutation UI; checkpoint progress is not a heartbeat or provider-success claim. **Tests:** existing warehouse/status/privacy tests; production export verification remains external.

### Revenue, Reconciliation, Payouts, Compliance

**Backend/API:** `revenue/revenue.controller.ts`, `revenue/revenue-reconciliation.controller.ts`, `revenue/payout-provider.controller.ts`, `revenue/creator-compliance.controller.ts`. **Audience/authorization:** creator-owned earnings/submissions; separate finance Admin roles, current step-up, transactional audit and immutable ledger controls. Reconciliation is Admin-facing, not an ordinary creator mutation. **Web/PWA/mobile:** current Account earnings area, `/studio/monetization`, `/admin/revenue`, `/admin/revenue/payouts/[payoutId]`. **Status/action:** existing surfaces/provider capability states need coherent Finance sub-navigation and named entity selectors. Preserve scoped identity data and high-risk confirmation. Never infer provider readiness, completed payouts or approved compliance from configuration alone. **Tests:** existing ledger/reconciliation/payout/compliance authorization/integration suites; actual provider credentials/commercial approvals are separate blockers.

## Advertising

### Page ads, Video ads, Direct advertising, GAM

**Backend/API:** `ads/advertising-control.controller.ts`, `ads/gam-production.controller.ts`, `ads/page-ad.controller.ts`, `ads/video-ad.controller.ts`. **Audience/authorization:** public consent/placement decisions; advertising Admin configuration and direct campaign controls remain server-guarded. **Web/PWA/mobile:** existing Home/Watch placements and `/admin/advertising`, `/admin/video-ads`. **Status/action:** consolidate the two Admin entrypoints into one coherent control center later. Retain logical placements, consent, emergency kill switch, masked credentials, no-fill/content recovery and seller files. A deliberate full-public-surface inventory, density/CLS measurement and current official Google policy review remain Phase 11. No default monetization on auth, upload, Studio, Admin or sensitive Account/finance forms. **Tests:** existing ad runtime/consent/diagnostics/player suites; no-fill/blocked-script/navigation/TV/native acceptance remains explicit. Real fill/revenue is not fabricated.

### SSAI/DAI

**Backend/API:** `ads/video-ad.controller.ts` and supported runtime adapters. **Audience/authorization:** Viewer playback and privileged provider configuration/diagnostics. **Web/PWA/mobile:** Watch, Live, Creator TV and Advertising diagnostics. **Status/action:** preserve the provider/technical boundary; configured, supported and actually delivering are different states. Native SDK/app inventory cannot be assumed equivalent to GPT inside a WebView. **Tests:** existing SSAI/DAI/player contracts; official documentation, real provider and physical-device evidence required separately.

## Safety and support

### Support

**Backend/API:** `admin/admin-governance.controller.ts`. **Audience/authorization:** creator-owned tickets; assigned/scoped Admin operations. **Web/PWA/mobile:** `/studio/support`, current `/admin/operations`. **Status/action:** ticket forms/queues exist; isolate the support context from unrelated operations, preserve assignment and audit, improve entity links and recovery. **Tests:** existing governance/support authorization and workflow tests.

### Moderation, Trust & Safety

**Backend/API:** `trust/trust.controller.ts`, `admin/admin-control.controller.ts`. **Audience/authorization:** creator-owned trust workflows and separately scoped moderation/Admin actions. **Web/PWA/mobile:** `/studio/trust`, `/admin/trust`, `/admin/moderation`, contextual comments/content. **Status/action:** replace raw UUID entry and dense action walls with named selectors and focused panels, retaining reasons, ownership, MFA, audit and destructive confirmation. Never hide enforcement solely in navigation. **Tests:** existing trust/moderation/IDOR/ownership suites and new consolidated-workflow security regression when changed.

## Internal and operational systems

### Media processing, Media workers

**Backend/API:** `admin/admin-media-processing.controller.ts`, `media/media-processing-queue.service.ts`, `media/media-processing-lifecycle.service.ts`, `media/media-generation-safety.ts`. **Audience/authorization:** internal worker claims/leases/heartbeats; guarded Operations summaries and reviewed mutations; creator-owned processing progress only. **Web/PWA/mobile:** `/admin/operations`, `/admin/operations/media`, relevant owned upload progress. **Status/action:** historical reviewed jobs/capacity/retry/reprocess/recovery/pause acceptance through #123, generation recovery #127 and bounded overview #128 must remain intact. Keep atomic claims, leases, generation safety, step-up, confirmation and audit. No arbitrary transcoder/queue commands for normal users. **Tests:** existing queue/generation/storage/lease/operator suites; real throughput, provider and multi-host capacity evidence remains separate.

### R2, FFmpeg

**Backend/API:** `media/media-storage.adapter.ts`, `media/media-processing-worker.service.ts`. **Audience/authorization:** internal storage/transcoding only. **Web/PWA/mobile:** no standalone user control surface; expose safe outcomes/progress through existing upload/Operations views. **Status/action:** deliberately internal. Never expose storage credentials, object operations or command execution merely to increase UI coverage. **Tests:** existing media/storage/FFmpeg runtime and integration fixtures; production capacity and recovery remain separately measured.

### HLS, Adaptive playback, Playback fallback, Player

**Backend/API:** `watch/watch.controller.ts`, `admin/admin-media-processing.controller.ts`, `media/media-adaptive-rollout.service.ts`, existing Web player adapters. **Audience/authorization:** eligible Viewer playback; guarded Operations rollout/recovery; internal media generation. **Web/PWA/mobile:** `/watch/[slug]`, `/live/[slug]`, `/c/[handle]/tv`, Operations media workspace. **Status/action:** preserve ABR, canonical MP4 fallback, captions, progress and ad failure recovery. Generation/recovery history is not real hardware certification. Keep the video dominant and advanced processing controls out of Viewer UI. **Tests:** existing adaptive/player/HLS/operator suites; real startup/buffering/ABR, mobile/remote and fallback measurements remain required.

### SEO, Sitemaps

**Backend/API:** `seo/seo.controller.ts`, `seo/seo-sitemap-counts.controller.ts`, Web metadata/canonical routing. **Audience/authorization:** public eligible index metadata; internal sitemap generation excludes private/unavailable content. **Web/PWA/mobile:** ordinary content pages and machine-readable routes, not a new end-user settings console. **Status/action:** align canonical paths/aliases, preserve locale/deep links, distinguish upstream error from not-found and remove obsolete placeholder indexing. **Tests:** existing SEO/sitemap rights tests and new route/metadata contracts; crawl/production evidence remains separate.

### Admin

**Backend/API:** `admin/admin.controller.ts`, `admin/admin-control.controller.ts` and domain-specific guards. **Audience/authorization:** server-scoped Admin roles and MFA, never link visibility alone. **Web/PWA/mobile:** `/admin` and existing domain pages. **Status/action:** replace the flat navigation with grouped role-aware control centers, shared scoped session reads, breadcrumbs and mobile navigation. Not accepted by this route repair. **Tests:** existing Admin authorization/browser inventory and complete master role/security regression after consolidation.

### Observability, Database scaling

**Backend/API:** `admin/admin-observability.controller.ts`, `database/database.service.ts`. **Audience/authorization:** existing SUPERADMIN boundary for detailed evidence; internal measurement sources. **Web/PWA/mobile:** `/admin/operations`, `/admin/operations/database`. **Status/action:** historical #111/#129 expose sanitized PostgreSQL/application evidence. Distinguish process samples, lifetime counters and DB counts from worker heartbeats/provider health. No arbitrary SQL, raw sensitive queries, replica routing or indexes without evidence. **Tests:** existing observability/query/role tests; production plans, connections and latency remain separate.

### Backups, Synthetic monitoring

**Backend/API:** `admin/admin-operations-dashboard.service.ts` and trusted report producers. **Audience/authorization:** scoped Operations summaries; execution/restore/probing remains internal. **Web/PWA/mobile:** `/admin/operations`. **Status/action:** summaries must reflect actual trusted report files, including stale/missing state. Do not fabricate successful backups, restore drills or synthetic health. No ordinary Viewer/Creator action surface. **Tests:** existing dashboard/report contract tests; real backup/restore/production probes need observed evidence.

### Operations dashboard

**Backend/API:** `admin/admin-operations-dashboard.service.ts` and domain workspaces. **Audience/authorization:** role-scoped Admin/Operations; privileged writes retain shared step-up/audit. **Web/PWA/mobile:** `/admin/operations` with media/database/discovery/warehouse/observability drill-down. **Status/action:** Task 87 and historical operator improvements exist. Grouped information architecture, cross-domain task flow and mobile/visual/device acceptance remain current master work. **Tests:** existing Operations, MFA, audit and bounded-read tests; no blanket production certification.

## Web/PWA and native boundaries

### PWA

**Backend/API:** Web manifest, service worker, registration/update and shared API/network behavior. **Audience/authorization:** public static shell; account/auth/upload/advertising/media responses must retain their own privacy/network semantics. **Web/PWA/mobile:** same canonical product routes. **Status/action:** PR #140 establishes one generated manifest and fixes Upload/TV shortcuts. Raster/maskable assets, install metadata, controller-change update sequencing, safe bounded caches, offline/reconnect, cross-origin API assumptions and account-switch isolation remain Phase 9. Do not call a manifest repair full PWA acceptance. **Tests:** new manifest/alias tests; full installed-PWA/service-worker acceptance not yet complete.

### Android

**Backend/API:** existing Android shell/bridge and shared AYIN APIs. **Audience/authorization:** platform capability adapter preserving normal server authorization and safe sessions. **Web/PWA/mobile:** intended hosted shared Web product; retain app links, back/file picker/fullscreen/player/share and supported native capabilities. **Status/action:** audit current code before changing architecture; platform structural tests are not Play approval or physical-device validation. Distinguish routine Web-only changes from native SDK/permission/entitlement releases. **Tests:** existing platform structural/build checks; current official policy, device and store evidence required in Phase 15.

### iOS

**Backend/API:** existing Swift authentication/discovery/player code and shared APIs. **Audience/authorization:** platform-native capability/session boundary plus unchanged API controls. **Web/PWA/mobile:** current native ordinary UI duplicates part of the product and requires a careful hosted/hybrid assessment. **Status/action:** architecture gap remains; preserve genuinely required native auth/AVPlayer/bridge features rather than blindly rewriting. Apple policy/minimum functionality, universal links, ATT/ad SDK and lifecycle must be verified against current official documentation. **Tests:** existing structural/build tests where toolchain exists; no signing, store or physical-device claim.

### TV platforms

**Backend/API:** existing Tizen/webOS/Android TV/tvOS adapters and shared APIs. **Audience/authorization:** platform capability/focus/player boundary, normal API authorization. **Web/PWA/mobile:** shared product where technically supported; native tvOS exceptions must remain explicit. **Status/action:** preserve remote focus, back/lifecycle, HLS/captions and supported ad integration without copying ordinary business logic. Emulator, hardware, submission and approval are separate statuses. **Tests:** existing platform contracts and device test matrices; only observed stages may be accepted.

## Required acceptance follow-through

Every entry marked existing or implemented still needs its current phase's explicit behavioral, security, visual and performance evidence. The main purpose of this inventory is to prevent both orphaned user-facing capabilities and pointless exposure of internal APIs. Current PR #140 repairs high-value public entrypoints; it does not complete the full master modernization. Update this inventory after each accepted phase without overwriting historical evidence or inventing production/provider success.
