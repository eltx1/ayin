# Advertising control-center navigation increment

## Scope and source finding

The inspected baseline is main `27708005abb087f13cafc8b3293d56db659902a6`. It already contains the native, protected EN/AR Video Ads workspace. The sidebar still listed Advertising and Video Ads separately, while the legacy Advertising page displayed emergency controls, diagnostics, page settings, seller files, inventory, advertisers, campaigns and creatives together.

This candidate is a presentation/navigation increment, not a replacement advertising backend or acceptance of the complete advertising phase.

## Implemented boundaries

- One role-scoped Advertising sidebar destination. `/admin/advertising` and `/admin/video-ads` both retain their existing canonical routes. The latter still accepts its existing `query` parameter. Locale-aware native links connect both areas; sidebar active matching recognizes the existing player route without redirecting or rewriting it.
- Six shared manual-activation tabs organize the page-ad/campaign area: Overview, Page inventory, Advertisers, Campaigns, Creatives and Seller files. Inactive panels stay mounted and hidden, preserving local draft fields while switching sections. This is presentation grouping, not lazy API loading or database pagination. Section changes do not create synthetic browser history entries.
- Route-scoped EN/AR vocabulary covers the shared navigation, overview, page-delivery labels, statuses and section guidance. Existing detailed inventory/campaign/creative/seller editors remain in English and are explicitly identified as such on the Arabic surface.
- The native PageHeader, MetricList, DataBadge, ActionButton, TextAreaField, Disclosure and EditorTabs are reused. The overview presents real loaded counts and compact status badges, with emergency controls, diagnostics and event details behind native disclosures. Initial read failure is unavailable, never fabricated zero or readiness; retry reads the existing endpoints.
- Accepted Video Ads logic changes only by adding the shared route navigation. Server roles, MFA/step-up, actor/target binding, version conflicts, uncertain writes, audit records and provider adapters are unchanged. Its existing departure guard also covers the new native links.

No provider activation, live campaign mutation, spend, billing change, consent-setting change, credential change or production mutation was performed. Isolated fixture mutations are used only for the existing local API and browser regression suites.

## Validation

Final local candidate validation used Node 24.19.0, the pinned pnpm graph, the actual production Next/Nest builds and isolated PostgreSQL initialized with UTF8, C.UTF-8 and UTC. No production data or provider credentials were used.

- Shared package/Prisma generation and API/Web production builds passed.
- Web TypeScript, scoped source/test ESLint, changed-file Prettier and whitespace checks passed.
- Complete Web unit suite: 575 tests in 97 files passed, including six independent read-reconciliation cases.
- Existing advertising API/PostgreSQL suites: 44 tests in four files passed (`admin-video-ad-directory`, `admin-video-ad-version`, `admin-video-ad-write-authority`, `admin-json-actions`). These include protected/current-authority/version and audit-rollback regressions, not just route rendering.
- Production Chromium browser: all 18 owning journeys passed in one minute. The four initial new journeys cover actual authorized reads, EN/AR keyboard activation, independent draft retention across tabs, sidebar roles and route activation, compatible player deep links, Back/Forward, canceled native player departure, no navigation writes, unavailable/retry presentation and Finance API denial. All ten existing native Video Ads cases passed unchanged, including uncertain results, target/settings conflicts, step-up cancellation, freeze concealment and actual role transition.
- The twelve normal-data rendered captures were inspected: Overview, Page inventory and Player navigation at 390/1440 in both EN/AR. An initial visual review rejected mid-word English mobile tab wrapping even though the first browser suite passed. The final advertising-scoped two-column tab layout has an additional per-word range-geometry assertion, with all labels and controls contained and at least 44px-high tabs. The rejected first capture set was retained separately; final evidence does not reuse it.

Independent review of the initial patch `4a2d74d8fe9105f7a81408b6523bc6bdcf4ca14b121d6f0014d92e9af5c49cd9` reproduced two refresh defects: the new manual read replaced unsaved page/seller drafts, and populated old event counters bypassed the failed-read state. The reviewer also identified oversized unavailable text at 1280px. The replacement addresses these bounded paths:

- Manual reads compare each form's latest synchronous draft against its last server snapshot at response time. Dirty page-ad, web-seller and app-seller forms are retained independently, including edits entered while the read is pending. Clean forms take fresh response values; reverted values count as clean. No draft is submitted by reading, and legacy mutation/automatic-refresh contracts are unchanged.
- A failed read renders event counters unavailable before examining old entries. Unknown count slots use the existing compact DataBadge; known numeric counts retain their existing hierarchy.
- Four additional owning browser journeys cover independent clean/dirty refresh, three in-flight drafts with zero writes, and EN/AR nonempty-counters-to-read-failure transitions. Six additional recovery images at 390/1280/1440 were inspected; range/typography assertions prevent splitting unavailable labels. Ten normal-data captures match the earlier inspected bytes exactly; the two regenerated player captures were reopened and inspected.
- The reviewer's original outside-checkout `refresh.spec.ts` ran unchanged against the replacement production build: all three cases passed in 9.4 seconds, including both exact former reds and the Arabic focus/no-write case. Its two new diagnostic captures were also inspected. The original failed-review artifacts remain separate.

The replacement local evidence bundle is `ayin-ad-controls-repair-evidence.zip`, SHA256 `ba436341ddba4f89585377980f9dc835521295b0fa37f23bbae851c2bc17c625`; it contains all 18 owning captures, two exact-review replay captures and final build/API/browser/unit/typecheck logs. The original `ayin-ad-controls-evidence.zip` (`d596524a3151e680c92ba34a8926be41a5da15d8c7988d5fcf9ba838faee5468`) remains historical and does not certify these repairs. Local source/UI acceptance remains separate from CI, release/deployment acceptance and live-provider/device certification.

## Remaining work

The next concrete legacy UX slice is the direct-campaign editor: a native, labeled, searchable, route-localized advertiser/campaign flow that preserves the existing field meanings and protected mutation contracts. Inventory details, creatives and seller editors also still need native/localization adoption. Legacy cross-route draft-loss/recovery behavior is not certified by in-page tab retention. Whole-workspace identity/lifecycle, large-data behavior and full master acceptance remain open.

This increment does not certify Google demand eligibility, provider response/fill, CMP or age treatment, native SDK/WebView monetization compliance, app-ads.txt ownership, store approval, physical devices or production advertising delivery.
