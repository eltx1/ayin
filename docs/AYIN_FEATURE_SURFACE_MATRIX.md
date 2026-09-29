# AYIN feature surface matrix

## Authority and complete inventory

AYIN at `https://ayin.stream` is one canonical Web/PWA with shared APIs. This file is the current backend-to-product acceptance index for master phases 0–16. Read [the checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md) for exact tested/merged/deployed commits and remaining risks.

The full 73-domain inventory, API/controller/model references, authorization, audience, Web/PWA/mobile surfaces, gaps and test requirements is retained byte-for-byte in [the detailed baseline through #144](AYIN_FEATURE_SURFACE_BASELINE_144.md), which includes the earlier detailed baseline links. It is historical evidence, not a competing authority: the dated entries below supersede its pending statuses. No domain or safety requirement is dropped by this consolidation. `scripts/audit-product-integration.mjs --stdout` supplies exact tracked-source metadata; static filename matches are not runtime/security proof.

**Current accepted main:** `5648df8800a801f716e75262dda9abfb784c3b14`, after #144. The originally parallel playlist candidate #145 must be reconciled onto it. All other audience/permission/internal-only classifications remain as detailed in the baseline. Native clients reuse these Web/PWA/API surfaces where appropriate; physical-device/store acceptance is separate.

## Current adopted surface changes

**Viewer discovery/catalog/TV/Clips:** #140 repaired `/movies`, `/series`, `/tv`, `/creators`, primary-TV identity, rights-aware bounded continuation and detail shells. `/shorts` and `/uploads` deliberately redirect to `/clips` and `/upload`; one manifest owns live shortcuts. #142 added the real `/browse` hub, at most five primary choices and safe mobile/remote navigation. #143 adopted shared headers/states/cards and stable failed-artwork fallback. Server territory/maturity/publication/media eligibility remains unchanged. Full detail redesign, all notification/sitemap links, per-series hydration and device/visual/performance gates are still open. Sources/tests remain the catalog/VideoPolicy/discovery and route/browser suites in the baseline.

**Creator/Admin hierarchy and design:** #142 retains twelve Studio and nineteen role-aware Admin destinations in grouped navigation with breadcrumbs and one existing access/MFA system. #143 uses real shared controls, fields, notices and actual-data metrics on existing Viewer/Studio/Admin pages. No UI-only permission gate, fake metrics, provider activation or whole-route design certification. Full account/creator simplification, coherent domain control centers and remaining advanced editor interactions are not complete.

## Comments and Support — accepted #144

**Domain / capability:** creator Comments review and owned Support tickets. **Backend/API:** unchanged Studio controller/service channel membership for comments and governance controller/service AuthGuard/account ownership for tickets. Existing latest-100 bounds remain. **Audience:** Creator; not new Viewer/Admin/internal controls. **Web/PWA/mobile:** existing `/studio/comments` and `/studio/support`, one Studio main landmark, typed EN/AR.

**Adopted UX:** native captioned scoped-header DataTable, local search/visibility filters explicitly within the recent snapshot, available long-text disclosure. Support has a short grouped form, optional priority, focused ticket disclosure, native input bounds, a synchronous write guard, pending-disabled fields, retained drafts and distinct acknowledged-write/failed-read/uncertain-write states. GET recovery never automatically replays POST. Loading, actual-empty and failed/malformed reads are distinct.

**Acceptance:** head `cd3e8d5ced9997f91517658e32fe7560f8d48563`, merge `5648df8800a801f716e75262dda9abfb784c3b14`; quality `36581604980`, browser `36581605108`, security `36581605127`, inventory `36581604877`; author-side review `5354266635`. Four new screenshots were inspected. Deployment `36586003863` and proof `11041522411` actually verified, including exact release and direct-origin health; see checkpoint for hashes/limits.

**Remaining:** global account-switch consistency, large payload/whole-product performance, full accessibility/route/device acceptance. No new backend capability or security exemption is inferred from native form/table presentation.

## Creator playlist library — reconciled #145 candidate

**Domain / capability:** owned playlist collection, create and named edit/preview access. **Backend/API:** existing creator playlist controllers/service, AuthGuard/channel membership, protected Uploads rules and public playlist visibility shaping. Client create type now reflects the actual server selection rather than fabricated summary/count/capability fields. **Audience:** Creator collection management with existing public eligible previews. **Web/PWA/mobile:** `/studio/playlists` and standalone `/channel/playlists`; original item editor `/channel/playlists/[playlistId]` and public channel playlist URLs stay intact.

**Candidate UX:** combines local name/description/visibility search, truthful totals and 12-row presentation pages without extra filter/page requests. Private lists never display a public Preview link. Uncertain POST results are never replayed; failed refresh after acknowledged creation is explicitly different from failed creation; drafts and synchronous pending/disabled behavior are retained. Read recovery is uncached, cancellable and must succeed before another creation.

**Shared component decision:** reuse #144's DataTable and FormSection, add optional scroll label/inline layout and PageControls, and remove the unaccepted duplicate data-workspace implementation. Both domains' consumers, tests and noncolliding EN/AR resources remain. This is one design system, not two parallel table/form APIs.

**Test evidence:** original #145 head `4cacd05` passed its own quality/browser/security/inventory gates. Combined source now passes 237 local Web tests/51 files, scoped lint/type generation/TypeScript and relevant formatting. Three retained browser journeys cover actual isolated records, traversal/filtering, private previews, EN/AR, double submit, acknowledged creation with failed reload and committed lost response. Final combined CI/build/browser screenshots, review, merge and deployment remain pending. Local restored tooling is not an exact frozen production graph.

**Limits/action:** collection API is unchanged; presentation paging is not DB pagination. Full creator editor/bulk workflows, backend query/payload measurement and global identity switching are later phases. No raw UUID copy/paste, no new permissions, no financial/provider/native behavior.

## All unchanged capability decisions remain in scope

The baseline's detailed entries still govern Authentication/Sessions/Accounts/MFA/Profiles; Watch progress/History/My AYIN; Channels/Uploads; Movies/Series/Episodes/Creator TV/FAST/Clips; Captions/Chapters/Metadata; Community/Comments/Social actions/Notifications/Live; Rights/Maturity/Geographic policy/Kids; Search/Language-aware search/Lens/Recommendations; Recommendation evaluation/Trending/Regional discovery; Localization/Arabic/RTL; Analytics/Cohorts; Revenue/Reconciliation/Payouts/Compliance; Page ads/Video ads/Direct advertising/GAM/SSAI/DAI; Support/Moderation/Trust & Safety; Media processing/Media workers/R2/FFmpeg/HLS/Adaptive playback/Playback fallback/Player; SEO/Sitemaps; Admin/Observability/Database scaling/Operations dashboard; Warehouse export/Backups/Synthetic monitoring; PWA/Android/iOS/TV platforms.

Internal storage/transcoder/queue/warehouse/backup/synthetic execution stays internal; only sanitized role-appropriate summaries are surfaced. Detailed database/observability keeps its existing privileged boundary. Finance, moderation, support and provider writes retain server ownership/roles/current MFA/audit. No ad/provider/backup/store readiness is fabricated. Kids monetization and native advertising require later explicit current-policy acceptance, not extrapolation from a shared Web screen.

## Acceptance rule

Implemented is not globally accepted. Each intended Viewer/Creator/Admin capability needs a discoverable appropriate surface and its relevant behavioral/security/visual/performance evidence, or an explicit internal-only reason. The current source counts and historical completed tasks do not imply all master phases are complete. Reconcile real code, preserve working backends and URLs, and update this index after each accepted phase.
