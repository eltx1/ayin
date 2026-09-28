# AYIN information architecture

## Product boundary

AYIN at `https://ayin.stream` is one canonical Web/PWA product. This hierarchy organizes existing capabilities; it does not introduce a new backend, parallel Clips product or duplicated native UI. Server authorization, channel ownership, rights, moderation, financial controls and MFA remain authoritative. Navigation visibility is not authorization.

This document describes the Phase 3 candidate. Exact accepted source, tests, review, deployment and remaining work belong in [the master checkpoint](AYIN_WEB_PWA_MASTER_CHECKPOINT.md). Do not interpret a proposed hierarchy as completed runtime, visual or device certification.

## Viewer

Primary choices are Home, Browse, TV, My AYIN and Search when their existing controls permit them. The relative order of configured primary items is preserved. Browse is inserted after Home, or first when Home is absent, and exists only when there are enabled discovery categories. Duplicate keys/destinations cannot expand the primary list beyond five. Disabled items and unknown/disabled feature flags remain absent.

Browse is a real `/browse` route, not a placeholder. It provides Movies, Series, Creators, Clips, Kids and enabled custom internal destinations from the existing central product controls. It shares the shell's public configuration requests instead of issuing another pair. Its heading and metadata render on the server; the existing rights-aware catalog directory pages remain server-rendered. Loading, unavailable/retry and genuinely empty configuration are distinct states. Category pages retain their current URLs, pagination, server policies and metadata.

Legacy `/shorts` resolves to `/clips` and `/uploads` to `/upload`, retaining locale/query. There is one Clips product. No previously accepted public URL is removed. Navigation rejects non-internal/protocol-relative URLs and duplicate destination/key collisions rather than making external links appear to be AYIN sections.

Desktop and mobile represent the same information model. The mobile bar has at most five readable choices; a signed-in creator's Create / Upload remains visible in the header and leads directly to Quick Upload. Anonymous users receive Join AYIN instead. Upload is never forced through Studio.

The header account menu separates account links (Account, Notifications, public channel) from creator links (Create / Upload, My videos, Creator Studio). Analytics, earnings, playlists and channel management are reached in the grouped Studio rather than repeated as an eleven-item account menu. Contextual page links remain where useful.

Existing web/mobile/TV visibility controls are retained. TV styling recognizes the actual runtime platform values rather than inferring TV from the shared focus-scope marker, which also exists on ordinary browsers. Native app inventory and SDK capabilities are outside this navigation phase.

## Creator Studio

The existing twelve destinations are preserved exactly once in the navigation model:

| Group | Existing destinations |
| --- | --- |
| Overview | Dashboard |
| Content | Content, Playlists, Live, TV |
| Audience & community | Analytics, Comments, Community |
| Earnings | Monetization |
| Channel | Channel settings, Trust & safety, Support |

Single-destination groups are direct links, not unnecessary extra clicks. Multi-destination groups are expandable; the active route's group opens automatically. Quick Upload is a separate primary action, not another expanded form or wizard. Captions/chapters remain contextual content-editing capabilities rather than empty navigation pages. All legacy creator routes remain available.

## Admin

The existing nineteen destinations are grouped without changing their role visibility:

| Group | Existing destinations |
| --- | --- |
| Overview | Dashboard |
| Content | Content Library, Videos, Movies, Series, Kids Classification, Localized Metadata, Creator TV |
| Users & creators | Users, Channels |
| Monetization | Advertising, Video Ads, Revenue |
| Safety | Moderation, Trust & Safety |
| Product & discovery | Product Controls, Feature Flags |
| Operations | Operations & Audit |
| Settings | Settings |

SUPERADMIN and ADMIN retain the existing broad navigation visibility. Other roles retain the exact prior scopes. Content moderation visibility does not gain catalog writes; finance does not gain user management; advertising does not gain revenue or operations mutations. Empty groups disappear. The shared Admin access provider remains the only navigation session source, and one existing reauthentication component remains mounted. There is no second MFA implementation or frontend-only protection.

Phase 7 will consolidate Advertising/Video Ads and other domain workspaces into actual control centers after inspecting their workflows. Phase 3 deliberately preserves both functioning destinations inside one group rather than hiding capabilities behind an unfinished replacement. Operations drill-downs remain in the existing Operations workspace; sensitive diagnostics are not promoted to public or creator menus.

## Navigation and accessibility behavior

Workspace breadcrumbs show the role-appropriate group and known page, with a generic Details segment for deeper routes. They never print database UUIDs or construct guessed entity links. Current-route matching respects locale prefixes, trailing slashes and path-segment boundaries; `/admin` and `/studio` are exact roots, not active on every descendant.

Mobile workspace navigation uses one native modal dialog with a labelled heading, explicit close action, browser-managed Tab containment and trigger focus restoration. Native remote Back closes an open navigation dialog before TV page-back/exit handling. The geometric arrow-focus scope excludes underlying page targets while a modal is open. Expand controls and links are keyboard/remote focus targets. A focused group is not remounted merely on a disclosure toggle; route changes intentionally reveal the next active group.

The new components use existing AYIN tokens, logical CSS properties, minimum 44px actions, bounded safe-area-aware dialog height and local scrolling. There is no animation library, icon package or new font dependency. English and Arabic strings use the existing typed translator; existing catalog continuation labels are not overridden. These are design constraints, not a claim that all product pages already pass the complete accessibility/visual gates.

## Acceptance evidence and remaining boundaries

Pure tests cover all destinations, role filtering, locale/path matching, translation completeness, flags, custom order, legacy aliases, duplicate keys/URLs and unsafe destinations. Browser tests cover shared configuration request counts, five-choice navigation, real catalog links, network recovery, long labels, responsive EN/AR, modal keyboard/remote containment, direct upload, Studio groups, finance navigation and an actual forbidden user-management API request.

Existing responsive route and account/MFA journeys are retained and adapted to the new disclosure controls. CI retains public directory and navigation screenshots for actual inspection. Synthetic navigation settings are isolated browser fixtures; they do not enable production categories, invent catalog inventory or certify a physical TV.

No schema migration, provider activation, credential change, native signing or production-data mutation is part of this phase. Full design-system normalization, page redesign, account-session consolidation, control-center transformation, installed PWA behavior, measured performance, advertising policy acceptance and physical-device/store readiness remain their subsequent master phases.
