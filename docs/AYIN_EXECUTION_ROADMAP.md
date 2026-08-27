# AYIN Sequential AI Execution Roadmap

Purpose: turn the AYIN master plan into small, deterministic AI coding tasks that can be executed one at a time without long unfocused runs.

**Important:** Every prompt below is designed to be run separately. Do not give an AI several task prompts at once.

Before each task, the AI must read:

- `docs/AYIN_MASTER_PLAN.md`
- `docs/AYIN_AI_AGENT_RULES.md`
- this roadmap

Each task ends with tests/build/report and must stop before the next task.

---

# PHASE 0 — FOUNDATION AND REPOSITORY DISCIPLINE

## TASK 00 — Repository audit and implementation contract

### Goal

Establish the exact greenfield baseline and create lightweight technical decision records before scaffolding production code.

### Copy-ready AI prompt

```text
You are implementing AYIN in repository eltx1/ayin.

First read docs/AYIN_MASTER_PLAN.md and docs/AYIN_AI_AGENT_RULES.md completely. Inspect the entire current repository before making changes.

TASK 00 ONLY: establish the implementation contract and repository baseline. Do not scaffold the application yet.

Create/update documentation that locks the initial engineering decisions needed for the next tasks:
- Web/PWA is the source of truth.
- TypeScript throughout.
- pnpm workspace monorepo.
- apps/web: Next.js current stable App Router.
- apps/api: structured Node.js API using NestJS with Fastify adapter unless repository evidence makes this unsafe.
- PostgreSQL.
- Prisma ORM unless a concrete repository constraint exists.
- shared runtime validation using Zod where useful.
- modular monolith, not microservices.
- Cloudflare R2 is the only AYIN video media storage.
- AWS EC2/CloudPanel hosts application services/database but never creator video objects.
- Admin and Creator Studio initially live as isolated route groups/modules in the web application to keep deployment simple.
- PWA architecture and TV-focus support are first-class.
- external providers must be adapters.

Create docs/ARCHITECTURE.md describing modules, boundaries, runtime topology, domains and data flow at a practical level. Create docs/DEVELOPMENT.md with local prerequisites, conventions, commands that future tasks should preserve, and environment naming conventions. Create docs/DECISIONS.md with short ADR-style entries for the decisions above.

Do not invent production credentials. Do not create application code in this task.

Acceptance criteria:
1. The docs are consistent with the master plan.
2. No country-specific product assumption exists.
3. The direct Creator -> R2 media rule is explicit.
4. Auto-provisioning of profile/channel/Uploads playlist/Creator TV is explicit.
5. Advertising inside and outside the player is explicitly represented as separate inventory families.
6. The end report follows AYIN_AI_AGENT_RULES.md.

Stop after Task 00. Do not begin Task 01.
```

---

## TASK 01 — Monorepo scaffold and quality gates

### Goal

Create a buildable, clean repository skeleton with no product feature implementation yet.

### Copy-ready AI prompt

```text
Read docs/AYIN_MASTER_PLAN.md, docs/AYIN_AI_AGENT_RULES.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT.md and Task 01 in docs/AYIN_EXECUTION_ROADMAP.md. Inspect the repository state produced by Task 00.

TASK 01 ONLY: scaffold the AYIN monorepo and baseline quality tooling.

Implement:
- pnpm workspace.
- apps/web using current stable Next.js App Router + TypeScript.
- apps/api using NestJS + Fastify adapter + TypeScript.
- packages/ui for shared UI primitives.
- packages/config for typed shared configuration helpers.
- packages/types for shared domain/API types that are genuinely cross-app.
- packages/db placeholder package prepared for Prisma/PostgreSQL but do not design the full schema yet.
- root lint/format/typecheck/test/build scripts.
- strict TypeScript settings with practical exceptions only where required by frameworks.
- environment example files with placeholders only; never commit secrets.
- basic health endpoint in API and minimal home route in web proving both apps build.
- consistent import aliases.
- gitignore and repository hygiene.

Do not implement authentication, database entities, upload, player, ads, creator features or admin features in this task.

Acceptance criteria:
- fresh dependency install succeeds.
- lint succeeds.
- typecheck succeeds.
- tests, even if only baseline smoke tests, succeed.
- production builds for web and API succeed.
- no large generated/build directories are committed.
- workspace commands are documented.

Stop after reporting Task 01. Do not start Task 02.
```

---

## TASK 02 — Core PostgreSQL data model and migrations

### Goal

Create the first durable schema that supports the V1 architecture without implementing UI.

### Copy-ready AI prompt

```text
Read the AYIN master plan, AI rules, architecture docs and inspect the code. Execute Task 02 only.

Design and implement the initial PostgreSQL/Prisma schema and migrations for V1. Keep it practical and normalized, but do not over-engineer.

Required entities/relationships:
- Account
- ViewerProfile
- Channel
- ChannelMember/ownership role
- ChannelSettings
- Video
- MediaAsset
- Playlist
- PlaylistItem
- CreatorTvChannel
- TvScheduleItem
- WatchProgress
- WatchHistory or an equivalent efficient history model
- Subscription
- Reaction
- Comment with threaded parent relation
- Notification
- ContentRightsDeclaration
- Report/ModerationCase baseline
- PlatformSetting
- FeatureFlag
- AdminAuditLog
- AdPlacement
- Advertiser
- Campaign
- Creative
- AdEvent
- CreatorContract
- EarningsLedgerEntry
- Payout

Important rules:
- Use stable IDs for relationships; handles/slugs remain mutable unique fields.
- Support soft/unpublish states where operationally useful.
- Model video states clearly: draft/uploading/processing-or-validating/published/unlisted/private/scheduled/removed as appropriate without creating meaningless states.
- Creator TV must be one-to-one by default with a channel but data model must not make future additional TVs impossible.
- Uploads playlist must be representable as a protected/system playlist.
- Platform settings must support admin-driven values without becoming an untyped arbitrary mess; define namespaces/keys/types or validated JSON schema strategy.
- Add indexes for obvious access patterns such as channel videos, public published feed, comments, subscriptions, watch progress and schedules.

Add seed support for minimal system defaults only, not fake production content.

Add tests that validate important relational constraints and migration/bootstrap behavior where practical.

Do not implement auth or auto-provisioning yet.

Acceptance criteria:
- migration applies on a clean PostgreSQL database.
- Prisma generation/typecheck succeeds.
- schema supports the automatic account->profile/channel/playlist/TV transaction required in Task 03.
- no video binary/blob storage exists in the database.

Stop after Task 02.
```

---

# PHASE 1 — ZERO-FRICTION IDENTITY AND CREATOR CREATION

## TASK 03 — Authentication and instant creator auto-provisioning

### Goal

Make registration itself create the entire default AYIN creator identity atomically.

### Copy-ready AI prompt

```text
Read all required AYIN docs and inspect current code/schema. Execute Task 03 only.

Implement production-shaped authentication and zero-friction registration.

Required V1 path:
- email + password registration/login.
- secure password hashing.
- secure session/token strategy suitable for the web/PWA and later hybrid shells.
- logout.
- current-user endpoint.
- basic forgot/reset architecture may be stubbed behind an email adapter if no provider is configured, but do not fake sending email.

CRITICAL: successful registration must run one database transaction that automatically creates:
1. Account
2. Default ViewerProfile
3. Public Channel
4. Unique generated handle
5. System Uploads playlist
6. Creator TV named `{Channel Name} TV`
7. Default ChannelSettings
8. Default CreatorContract/monetization status record as defined by schema

There must be no separate creator onboarding wizard.

UX:
- registration form must be short and polished.
- sensible minimum fields only.
- after success, redirect user into AYIN with a small confirmation that their channel and TV are ready.
- account/channel names and handle can be edited later.

Implementation requirements:
- provisioning must be idempotent/recoverable and tested.
- handle collision generation must be deterministic enough to avoid fragile loops.
- API authorization must never trust client-provided account ownership.
- no geographic assumptions.

Tests must cover:
- successful registration creates all required records.
- duplicate email handling.
- handle collision handling.
- transaction rollback if provisioning fails.
- login/logout/current-user authorization.

Do not implement full account settings or upload yet.

Stop after Task 03.
```

---

## TASK 04 — Platform settings, feature flags and admin RBAC foundation

### Goal

Create the control substrate that prevents future business logic from being hard-coded.

### Copy-ready AI prompt

```text
Read AYIN docs and execute Task 04 only.

Implement the platform configuration foundation and admin authorization model.

Build:
- typed PlatformSetting service with schema validation and defaults.
- FeatureFlag service.
- secure admin role model with at least SUPERADMIN and ADMIN; design so more roles can be added later.
- server-side guards for admin APIs/routes.
- AdminAuditLog helper/service for high-impact mutations.
- initial admin settings UI at /admin/settings with clear sections, not raw JSON editing.

Initial editable settings should include:
- registration enabled
- automatic creator provisioning enabled (default true; changing this should be clearly high impact)
- default Uploads playlist name
- Creator TV name template
- auto-add published uploads to Creator TV
- default video visibility
- default comments enabled
- default monetization/ad eligibility
- upload max size
- allowed initial media compatibility profile display text
- default creator revenue share
- moderation default mode
- maintenance mode

Provide safe seed/default values.

Do not expose secrets as ordinary settings. Provider secrets remain environment/secret configuration.

Tests:
- non-admin cannot mutate settings.
- admin changes validated values.
- invalid value rejected.
- audit record created for sensitive settings changes.
- settings fall back safely if not explicitly stored.

Do not implement the full Admin product yet.

Stop after Task 04.
```

---

# PHASE 2 — WEB/PWA DESIGN SYSTEM AND NAVIGATION

## TASK 05 — AYIN design system, responsive shell and TV focus engine

### Goal

Create the Netflix-class visual foundation before feature pages multiply.

### Copy-ready AI prompt

```text
Read AYIN docs and current code. Execute Task 05 only.

Build the AYIN web/PWA application shell and reusable design system. Do not clone Netflix pixels or copyrighted artwork; create an original premium dark entertainment identity.

Implement:
- responsive application shell.
- desktop/mobile navigation.
- TV/10-foot layout foundations.
- reusable content row/carousel component.
- reusable poster/card/landscape-card skeletons.
- hero component.
- loading/skeleton/error/empty states.
- accessible focus styles.
- reusable directional TV focus/navigation engine that supports arrow keys and can later map to remote events.
- keyboard navigation.
- PWA manifest baseline with placeholder owned assets only.
- installable/service-worker foundation without offline video caching.

Navigation architecture includes:
Home, Movies, Series, TV, Creators, Shorts/Clips, Kids, My AYIN, Search.
Use feature flags so unfinished sections can be hidden safely.

Global rule: never show country-specific product wording. If sample placeholders are required use neutral text such as Trending Worldwide or Popular Now.

Keep the design fast and avoid giant animation libraries unless justified.

Tests should cover critical focus-navigation helpers/components and basic shell rendering.

Stop after Task 05.
```

---

# PHASE 3 — DIRECT R2 UPLOAD AND SIMPLE PUBLISHING

## TASK 06 — Cloudflare R2 media adapter and direct multipart upload

### Goal

Upload video from creator browser directly to R2 without proxying bytes through AWS.

### Copy-ready AI prompt

```text
Read AYIN docs and execute Task 06 only.

Implement the Cloudflare R2 media storage adapter and secure direct creator upload flow.

Hard constraints:
- video bytes must never be proxied through apps/api or stored on AWS/EBS.
- R2 is the only AYIN video media storage.
- V1 is playback-ready MP4; no transcoding system.

Implement:
- typed R2 configuration from environment variables.
- provider adapter/interface so storage calls are isolated.
- create-upload-session API authorized to the authenticated channel owner.
- short-lived direct upload authorization.
- multipart upload for large files where appropriate, including create/upload-parts/complete/abort flow.
- client-side upload progress.
- retry/resume at part level where practical.
- abandoned upload cleanup metadata/job design.
- R2 object keys based on server-generated stable IDs, never unsanitized filenames.
- client-side lightweight video inspection before upload for MP4/H.264/AAC compatibility where browser APIs allow; provide graceful fallback when exact codec introspection is unavailable.
- friendly validation errors rather than technical walls.

Do not ask creator for advanced metadata yet.

Security:
- authenticated ownership check server-side.
- short expiration.
- file size/quota checks driven by platform settings.
- do not expose permanent R2 credentials.

Tests must cover authorization, generated key ownership, invalid size/type path and multipart completion state.

When real R2 credentials are absent, provide a documented development adapter/mock that never pretends production upload succeeded.

Stop after Task 06.
```

---

## TASK 07 — Quick Upload and one-click publishing

### Goal

Make creator flow feel radically simpler than traditional creator studios.

### Copy-ready AI prompt

```text
Read AYIN docs and execute Task 07 only.

Build the creator Quick Upload UX on top of Task 06.

Target feeling:
Choose video -> Upload -> Publish.

Required behavior:
- global Create/Upload action available to signed-in users.
- selecting a file immediately creates a draft and begins the authorized direct R2 upload after compatibility/size checks.
- prefill title from filename cleanly; creator can edit it.
- show progress clearly.
- offer optional local frame thumbnail capture choices in the browser when feasible without server transcoding.
- the only mandatory publish-time creator action besides title/video is a clear rights confirmation checkbox.
- Publish button should be obvious.
- Advanced settings are collapsed by default and include optional description, thumbnail, tags/category, language, captions, chapters, schedule, visibility, comments, maturity, geo restrictions and ad-break preferences as supported by current schema.

On publish:
- verify upload completed.
- persist rights declaration version/timestamp.
- publish state atomically.
- add the video automatically to system Uploads playlist.
- add video automatically to Creator TV rotation when platform/channel setting permits.
- do not require a separate Studio workflow.

Creator can edit details later.

Tests:
- happy path publish.
- cannot publish incomplete upload.
- rights confirmation required.
- creator cannot publish another channel's draft.
- playlist/TV auto-association occurs exactly once.

Stop after Task 07.
```

---

# PHASE 4 — CHANNEL, PLAYLIST AND AUTOMATIC TV ENGINE

## TASK 08 — Public channel pages and channel editing

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 08 only.

Implement public creator channel pages and simple channel editing.

Public channel:
- handle URL.
- avatar/banner.
- name/handle/about.
- subscribe button placeholder wired if subscription module exists later; otherwise prepare clean boundary without fake counts.
- tabs: Home, Videos, TV, Playlists, About. Feature-flag Shorts/Posts until implemented.
- published video grid/rows.
- visible Creator TV entry.

Creator edit:
- edit channel name, handle, avatar/banner, description and basic appearance.
- handle uniqueness/redirect strategy for changed handles.
- simple settings, not an overwhelming studio.

Admin override capability must remain possible through service/API design.

No hard-coded country content.

Stop after Task 08.
```

---

## TASK 09 — Playlist system and automatic Uploads playlist

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 09 only.

Implement the playlist product cleanly.

Requirements:
- system Uploads playlist created at registration is protected from accidental deletion but editable naming behavior follows platform policy.
- every published channel upload appears in Uploads exactly once.
- user-created playlists.
- add/remove/reorder playlist items.
- visibility: public/private/unlisted where schema supports it.
- Watch Later should use a dedicated list/model or protected playlist strategy that cleanly supports My AYIN.
- public playlist page.
- creator channel Playlists tab.
- admin can inspect/edit playlists and items later through service permissions.

Do not implement collaborative playlists yet.

Tests focus on ordering, duplicate prevention, ownership and system-playlist protections.

Stop after Task 09.
```

---

## TASK 10 — Creator TV automatic scheduler V1

### Goal

Make every channel a television channel automatically without creator effort.

### Copy-ready AI prompt

```text
Read AYIN docs carefully, especially Automatic Creator TV. Execute Task 10 only.

Implement Creator TV V1 as an application-level linear schedule generated from the creator's eligible published MP4 library.

Required behavior:
- every registered channel already owns a CreatorTvChannel.
- zero-video TV renders a polished branded off-air/empty state.
- newly published eligible videos enter automatic rotation without manual scheduling.
- generate deterministic now/next schedule for a rolling window.
- loop/repeat eligible library when necessary.
- schedule calculation must account for video duration when available.
- viewers joining mid-program should be able to calculate the correct current video and offset conceptually; if exact mid-file synchronized start is not reliable with current browser/media constraints, implement the schedule and now/next correctly and document the V1 playback limitation instead of faking synchronization.
- provide creator optional controls to exclude/include videos and priority/order.
- provide admin service hooks for override, enable/disable and future ad-break insertion.

TV page:
- channel branding.
- Now Playing.
- Up Next.
- simple guide list.
- continuous autoplay through scheduled content.

Do not build true HLS FAST or live ingest in this task.

Tests:
- empty channel.
- one-video loop.
- multi-video deterministic rotation.
- excluded video.
- schedule rollover.

Stop after Task 10.
```

---

# PHASE 5 — PLAYER, WATCHING AND NETFLIX-CLASS DISCOVERY

## TASK 11 — AYIN Player and watch progress

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 11 only.

Build the reusable AYIN Player for progressive MP4 from media.ayin.stream/R2.

Implement:
- play/pause.
- seek/scrub using normal HTTP range-capable MP4 playback.
- volume/mute.
- fullscreen.
- PiP where supported.
- playback speed.
- 10-second forward/back.
- captions using WebVTT where available.
- chapters where available.
- keyboard/touch controls.
- TV focus/remote-compatible control surface using Task 05 focus engine.
- next/up-next hook.
- clean ad mode boundary so Task 17 can integrate IMA without rewriting player architecture.

Watch state:
- persist progress for authenticated viewer profile.
- resume from prior position.
- mark completed near configured threshold.
- update Continue Watching efficiently, not every playback millisecond.
- send analytics hooks through an interface even before full event pipeline exists.

Do not implement HLS/transcoding.

Tests should cover progress throttling, resume, completion and profile isolation.

Stop after Task 11.
```

---

## TASK 12 — Netflix-style Home, My AYIN and discovery APIs

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 12 only.

Implement the first real consumer discovery experience.

Home must support admin-configurable rows, not hard-coded page layout business rules.

Initial row sources:
- Continue Watching
- Trending Worldwide
- Popular Now
- New on AYIN
- Because You Watched (simple rule-based V1)
- Popular Near You/Region when location signal exists and privacy rules allow
- Movies
- Series
- Creator TV
- Creators You Follow later if subscriptions are not yet implemented
- Recently Added
- Editor Picks/manual

Build a row configuration model/service that Admin Home Builder can later edit. Seed a sensible global default set.

Build My AYIN:
- Continue Watching
- My List
- Watch Later
- history
- liked content hooks if reactions not implemented yet
- playlists

Use real database data and honest empty states, not fake catalog entries.

Performance:
- paginate/lazy-load large rows.
- avoid N+1 queries.
- responsive loading skeletons.

Never hard-code Egypt or a specific country.

Stop after Task 12.
```

---

## TASK 13 — Search and unified content detail pages

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 13 only.

Implement V1 search and unified content detail patterns.

Search:
- videos
- channels
- playlists where useful
- Creator TV
- movie/series entities if catalog records exist
- autocomplete/debounced suggestions.
- pagination.
- useful no-results state.
- PostgreSQL search first; do not introduce Elasticsearch just for prestige.

Detail pages:
- video detail/watch page.
- series/movie-ready component architecture.
- metadata, creator, play/resume, save hooks, related content.
- comments slot reserved for Task 15.
- external ad placement keys reserved for later ad task without rendering fake ads now.

Search API must be rate-limited/paginated and sanitize queries safely.

Stop after Task 13.
```

---

# PHASE 6 — SOCIAL FEATURES WITHOUT CREATOR FRICTION

## TASK 14 — Subscriptions, likes, Watch Later and notifications baseline

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 14 only.

Implement social graph basics:
- subscribe/unsubscribe to creator channel.
- subscription count and subscribed state.
- like/unlike video.
- dislike feedback state as private recommendation signal; do not expose a public dislike count unless platform setting explicitly allows it.
- Watch Later.
- My List where distinct from Watch Later.
- basic in-app notifications for meaningful creator events; keep notification fan-out architecture efficient.
- channel Subscribe action and video actions.

All actions require server-side ownership/auth validation and idempotent endpoints.

Add tests for duplicate toggles, counts, isolation and unauthenticated behavior.

Stop after Task 14.
```

---

## TASK 15 — Comments and creator moderation controls

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 15 only.

Implement YouTube-class V1 comments while keeping the model manageable.

Features:
- top-level comments.
- threaded replies with a bounded/practical nesting strategy.
- comment likes.
- creator heart.
- creator/admin pin comment.
- edit own comment within sensible policy.
- soft delete.
- report comment.
- creator can disable comments per video.
- creator can hide a user from their channel if schema/service supports it; otherwise prepare the minimal model cleanly.
- admin moderation hooks.

Security/abuse:
- rate limits.
- length limits configurable.
- sanitized rendering.
- blocked-term hook.

UI must be responsive and not dominate TV playback. On 10-foot TV, comments may be secondary/collapsed.

Stop after Task 15.
```

---

# PHASE 7 — CREATOR STUDIO AND FULL ADMIN CONTROL

## TASK 16 — Creator Studio V1

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 16 only.

Build Creator Studio V1 at /studio or studio.ayin.stream-compatible route structure, but preserve Quick Upload outside Studio.

Studio navigation:
- Dashboard
- Content
- Playlists
- TV
- Analytics placeholder backed by available metrics
- Comments
- Monetization summary placeholder using real current data only
- Channel settings

Dashboard:
- views/watch time if analytics exists, otherwise real basic counters from current data.
- subscriber count.
- recent uploads.
- quick upload button.

Content manager:
- list/filter videos.
- edit metadata.
- visibility/status.
- delete/unpublish.
- TV inclusion toggle.
- comments toggle.

TV:
- show automatically created Creator TV.
- now/next.
- include/exclude/reorder controls.

Keep the default creator UX easy. Advanced controls should not be presented as mandatory steps.

Stop after Task 16.
```

---

## TASK 17 — Admin Control Plane V1: users, channels, videos and TV

### Copy-ready AI prompt

```text
Read AYIN docs, especially Admin Control Plane. Execute Task 17 only.

Build the first comprehensive operational Admin UI and APIs.

Sections:
- Dashboard
- Users
- Channels
- Videos
- Creator TV
- Moderation entry point

Admin requirements:
- fast server-side search/filter/pagination.
- inspect/edit account basics.
- suspend/unsuspend.
- inspect/edit channel.
- verify/feature flags if modeled.
- set creator/channel monetization status.
- inspect/edit video metadata/state.
- publish/unpublish/remove.
- toggle comments/monetization/TV inclusion.
- inspect Creator TV now/next/rotation.
- enable/disable TV.
- safe bulk actions where useful.
- every sensitive mutation audited.

Superadmin should be able to find and control any content object quickly.

Do not implement advertising admin in this task; that gets dedicated tasks.

Stop after Task 17.
```

---

## TASK 18 — Admin Home Builder, navigation, taxonomy and global controls

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 18 only.

Extend Admin with the product control surfaces that eliminate hard-coded merchandising.

Implement:
- Home Builder: enable/disable/reorder/rename rows; choose supported row source; item limits; manual featured items; device visibility where architecture supports it.
- hero/featured content selector.
- main navigation visibility/order for feature-flagged sections.
- categories/genres taxonomy management.
- platform announcement/promo banner setting.
- creator default settings UI backed by Task 04 settings service.
- upload rules UI.
- maintenance/feature flags UI.

Changes should reflect on public web without code deployment.

All high-impact changes audited.

Do not create arbitrary HTML injection fields.

Stop after Task 18.
```

---

# PHASE 8 — ADVERTISING: PLAYER FIRST, THEN PAGE INVENTORY

## TASK 19 — In-player advertising abstraction and Google IMA integration

### Goal

Make the player genuinely ready for video monetization without binding UI to one demand provider.

### Copy-ready AI prompt

```text
Read AYIN docs and current Google IMA integration requirements from official documentation if internet access is available. Execute Task 19 only.

Implement in-player ad architecture for AYIN Player.

Requirements:
- provider-neutral VideoAdService boundary.
- Google IMA HTML5 integration as the first production adapter where supported.
- VAST ad tag source configurable centrally/admin-side, never hard-coded in player component.
- house-ad VAST endpoint/test mode that uses AYIN/Horus-owned test creatives or a safe development fixture; do not impersonate Google demand.
- pre-roll support.
- mid-roll cue architecture with configurable policy.
- post-roll support.
- ad start/quartile/complete/error/click event hooks.
- frequency/session controls architecture.
- content and channel IDs passed through AYIN attribution layer without leaking private data.
- player controls enter/exit ad mode cleanly.
- handle ad failure by resuming content rather than blocking playback.

Admin-configurable settings:
- ads master enable.
- pre/mid/post enable.
- default mid-roll policy.
- house VAST tag/source.
- per-channel/video override capability through data model/service.

Do not integrate Google Ad Manager account-specific production tags without supplied credentials/config.

Tests must cover ad decision logic and content fallback when ads fail.

Stop after Task 19.
```

---

## TASK 20 — Outside-player ad slots and Google Publisher Tag readiness

### Copy-ready AI prompt

```text
Read AYIN docs and official Google Publisher Tag documentation if web access is available. Execute Task 20 only.

Implement AYIN external/page ad placement system separately from video ads.

Create logical placement components driven by Admin AdPlacement records/settings, not raw tags scattered through pages.

Initial supported placement keys may include:
- home_top
- home_between_rows
- watch_below_player
- content_detail
- search_between_results
- channel_between_rows
- tv_directory
- desktop_sidebar where layout allows

Each placement supports:
- enabled/disabled
- route/context
- responsive sizes
- device targets
- logged-in/out rules
- content/category filters
- demand source
- fallback

Implement a Google Publisher Tag adapter for web/PWA when configured, plus a house/direct fallback adapter. Do not fake Google fill.

UX rules:
- no accidental-click positioning.
- never cover player controls.
- preserve premium streaming layout.
- ads collapse cleanly when no fill/fallback.

Create/update ads.txt/app-ads.txt templates/configuration docs without inventing seller IDs.

Stop after Task 20.
```

---

## TASK 21 — Admin Advertising Control Center and direct campaign manager

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 21 only.

Build Admin Advertising Control Center combining in-player and outside-player inventory controls.

Admin capabilities:
- list/create/edit/disable AdPlacements.
- set video ad defaults and overrides.
- map placements to demand adapter/config references.
- inspect ad event counters.
- emergency master kill switch.

Direct campaign manager:
- Advertiser CRUD.
- Campaign CRUD/status.
- Creative CRUD for video/display metadata and R2-hosted or approved creative references according to architecture.
- start/end.
- CPM/fixed pricing metadata.
- impression goal/budget fields.
- country/region, device, category, channel/content targeting.
- frequency cap.
- pacing baseline.
- pause/resume instantly.

Build a deterministic direct-ad decision service for eligible campaigns. Keep complexity V1-level but test priority, dates, targeting, frequency and no-eligible-campaign behavior.

All financial/campaign changes audited.

Stop after Task 21.
```

---

# PHASE 9 — ANALYTICS AND REVENUE

## TASK 22 — Event analytics pipeline and dashboards

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 22 only.

Implement a scalable-enough V1 analytics pipeline without introducing a data warehouse prematurely.

Track at least:
- app/session open where appropriate
- content impressions/clicks
- video start/progress/complete
- pause/seek/buffer
- search/query click
- subscribe/like/comment/share
- TV starts
- upload start/complete/publish
- ad request/start/quartile/complete/click/error

Requirements:
- event schema/versioning.
- batching/debouncing for noisy client events.
- avoid writing progress every second.
- privacy-aware pseudonymous session/profile identifiers.
- server-side validation.
- indexes/aggregation strategy.
- retention/cleanup strategy documented.

Expose real V1 metrics to:
- Creator Studio: views, watch time, average view duration, completion, top videos, subscribers.
- Admin: DAU/MAU approximation, watch hours, uploads, TV usage, ad events, errors where tracked.

Do not claim realtime if data refresh is periodic.

Stop after Task 22.
```

---

## TASK 23 — Creator revenue ledger, contracts and payout readiness

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 23 only.

Implement revenue attribution/ledger foundation. Do not integrate payment payouts yet unless explicitly configured later.

Requirements:
- CreatorContract defaults driven by admin settings.
- per-channel contract override.
- effective-date handling.
- EarningsLedgerEntry supports estimated/final/adjustment states.
- attribution to channel/video/ad source/campaign/period where data exists.
- idempotent revenue import/calculation process.
- adjustment entries rather than destructive rewriting of historical ledger.
- payout threshold and payout record model/services.

Creator UI:
- Estimated Revenue
- Finalized Revenue
- Revenue by video/period
- Payout history/status

Admin UI:
- global default split
- per-channel split
- ledger search
- manual adjustment with mandatory reason + audit log
- payout status controls

Use decimal-safe money representation; never floating point for money.

Tests must cover revenue share math, effective contract selection, adjustments and idempotency.

Stop after Task 23.
```

---

# PHASE 10 — MODERATION, RIGHTS AND TRUST

## TASK 24 — Rights declaration, reports, moderation and creator trust

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 24 only.

Implement moderation/rights infrastructure without adding creator friction.

Upload/publish UX remains one simple rights checkbox. Backend records:
- declaration version.
- timestamp.
- account/channel/video.

Admin/operations:
- content reports.
- comment reports.
- copyright/takedown request intake baseline.
- moderation case queue.
- warn/strike/suspend channel/account.
- unpublish/remove video.
- appeals status.
- blocked-term settings/hooks.
- creator trust level field/configuration.

Creator:
- see meaningful moderation notices.
- basic appeal/action history.

Admin can configure whether new creators require review, but default architecture must not force every creator through a manual approval queue.

Every destructive moderation action is audited.

Stop after Task 24.
```

---

# PHASE 11 — PWA, HYBRID READINESS AND DEPLOYMENT

## TASK 25 — Production PWA behavior and web-first platform adapters

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 25 only.

Harden AYIN as the web/PWA source of truth and create platform-adapter boundaries for future shells.

Implement:
- complete PWA manifest.
- icons/placeholders generated from repository-owned assets only.
- service worker caching strategy for app shell/static assets/API-safe reads as appropriate.
- explicitly DO NOT offline-cache entire video library.
- update prompt/version handling.
- install UX that is unobtrusive.
- deep-link-compatible routing.
- platform capability interface for web/mobile/TV shells.
- TV remote key mapping abstraction.
- safe-area/mobile shell handling.

Document wrapper strategy:
- Android/iOS hybrid shell candidate.
- Android TV/Fire TV thin web shell plus remote/native bridge.
- Samsung Tizen packaged web app.
- LG webOS packaged web app.
- Roku/tvOS exceptions later.

Do not build all store packages in this task.

Stop after Task 25.
```

---

## TASK 26 — CloudPanel/AWS deployment and repeatable CI/CD

### Copy-ready AI prompt

```text
Read AYIN docs and inspect deployment state. Execute Task 26 only.

Prepare a repeatable production/staging deployment for the existing AWS EC2 + CloudPanel environment without storing video on AWS.

Create deployment documentation and scripts/configuration for:
- ayin.stream web/PWA.
- api.ayin.stream API.
- admin/studio routing according to actual current architecture.
- Node process management appropriate for CloudPanel server.
- Nginx/reverse proxy expectations.
- HTTPS via CloudPanel/Cloudflare as appropriate.
- PostgreSQL connection.
- environment variables/secrets outside git.
- health checks.
- restart/rollback procedure.
- GitHub Actions CI for lint/typecheck/test/build.
- optional CD through secure SSH/deploy key only if credentials are available; otherwise provide the complete workflow with deployment step safely disabled/documented.

Cloudflare media domain/R2 stays separate from AWS.

Do not make undocumented manual edits on production.

Stop after Task 26.
```

---

# PHASE 12 — SECURITY, PERFORMANCE AND LAUNCH HARDENING

## TASK 27 — Security and abuse hardening pass

### Copy-ready AI prompt

```text
Read AYIN docs and inspect the implemented V1. Execute Task 27 only.

Perform a focused security hardening pass without changing product simplicity.

Review/fix:
- auth/session security.
- password policy without excessive friction.
- CSRF model.
- XSS and user-generated text rendering.
- server authorization for creator/admin mutations.
- IDOR risks.
- SQL/query safety.
- upload authorization expiry/ownership.
- rate limits for auth, comments, search, upload-session creation and reports.
- admin route protection.
- secret handling.
- security headers/CSP compatible with Google ads/R2 and required external scripts.
- audit logs.
- abandoned R2 draft lifecycle cleanup.

Add tests for real discovered risks.

Do not impose unnecessary CAPTCHAs/manual reviews unless evidence justifies them; prefer risk-based/rate-limit mechanisms.

Stop after Task 27.
```

---

## TASK 28 — Performance, accessibility and TV usability pass

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 28 only.

Optimize the actual implemented app for perceived and measured performance.

Focus:
- Core Web Vitals where relevant.
- image sizing/lazy loading.
- content row virtualization/pagination where needed.
- API query efficiency and indexes.
- player startup behavior for MP4.
- avoid excessive analytics writes.
- caching of safe public catalog reads.
- responsive behavior.
- keyboard accessibility.
- screen reader basics.
- color contrast.
- TV focus visibility.
- remote traversal order.
- no focus traps.
- reduced-motion support where reasonable.

Measure before/after where tools are available. Do not sacrifice correctness for synthetic scores.

Stop after Task 28.
```

---

## TASK 29 — End-to-end V1 test suite and launch checklist

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 29 only.

Create the V1 end-to-end acceptance suite and launch checklist.

Automate critical journeys with an appropriate browser E2E tool:
1. Register -> automatically receive profile/channel/Uploads playlist/TV.
2. Login/logout.
3. Direct upload flow using test storage adapter or safe R2 test environment.
4. Publish -> appears on channel, Uploads playlist and Creator TV.
5. Watch -> progress -> resume.
6. Subscribe/like/comment.
7. Admin finds and edits user/channel/video.
8. Admin changes homepage row and public UI reflects it.
9. House video ad path does not block content if ad fails.
10. External ad slot no-fill collapses cleanly.
11. Creator revenue contract math smoke path.
12. Suspend/unpublish/moderation path.

Create docs/LAUNCH_CHECKLIST.md covering:
- DNS/domains.
- CloudPanel/app health.
- PostgreSQL backups.
- R2/media domain.
- upload test.
- auth/email configuration.
- ads.txt/app-ads.txt placeholders replaced only when real IDs exist.
- privacy/terms/content policy pages.
- admin superuser.
- analytics sanity.
- security headers.
- error monitoring.
- rollback.

Stop after Task 29.
```

---

# PHASE 13 — CONTENT SEEDING AND PUBLIC BETA

## TASK 30 — Admin content import/seed workflow

### Copy-ready AI prompt

```text
Read AYIN docs. Execute Task 30 only.

Build a controlled admin content-seeding workflow for AYIN's initial catalog without hard-coding third-party copyrighted assets.

Requirements:
- Admin can create/import metadata for content AYIN has rights to use.
- Upload actual MP4 files through the same R2 media abstraction, not AWS storage.
- support assigning content to an AYIN-owned channel.
- support movie/documentary/creator-video content type metadata as current schema permits.
- rights declaration/source notes stored internally.
- bulk CSV/JSON metadata import is acceptable if validated.
- do not automatically scrape/download YouTube or third-party media.
- provide clear validation and rollback of failed imports.

Create docs/CONTENT_SEEDING.md describing a legally safe operational workflow.

Stop after Task 30.
```

---

# POST-V1 EXPANSION — EXECUTE ONLY AFTER V1 IS STABLE

## TASK 31 — Shorts / AYIN Clips

```text
Read AYIN docs and confirm Tasks 00-30 are stable. Execute Task 31 only.

Add short-form vertical content using the existing account/channel/R2/social foundations. Reuse direct MP4 upload. Add a vertical swipe feed, autoplay discipline, like/comment/share/subscribe, history and recommendation events. Keep Shorts ad rules separate from long-form video ad rules and admin configurable. Do not add music licensing assumptions. Extend Studio/Admin/analytics cleanly. Stop after Task 31.
```

---

## TASK 32 — Community posts

```text
Read AYIN docs and execute Task 32 only.

Add channel community posts: text, image, poll and video-share posts with creator publishing, subscriber feed distribution, comments/reactions where appropriate, moderation/reporting, scheduling and admin controls. Images may use R2 through a media asset path; keep video media rules unchanged. Do not build a general-purpose social network unrelated to AYIN channels. Stop after Task 32.
```

---

## TASK 33 — Advanced recommendations and AYIN Lens search

```text
Read AYIN docs and real analytics data structures. Execute Task 33 only.

Improve discovery using collected signals. Implement a measurable ranking pipeline that starts with explainable scoring and can later incorporate embeddings/models. Add semantic search/AYIN Lens behind a feature flag only when a configured AI/embedding provider exists; provide a non-AI fallback. Do not send private viewing data to external providers unnecessarily. Admin must control feature enablement and ranking weights where practical. Add offline evaluation fixtures and avoid untestable 'AI magic'. Stop after Task 33.
```

---

## TASK 34 — Live streaming foundation

```text
Read AYIN docs. Execute Task 34 only.

Design and implement the minimum live product foundation without breaking the R2 VOD architecture. Add scheduled live entities, creator live setup UX, stream keys/ingest provider abstraction, live watch page, live chat/moderation model and analytics interfaces. Select/configure an actual ingest/streaming provider only when credentials/budget are available; do not pretend R2 alone performs live transcoding. Preserve Google/IMA ad-break hooks. Stop after Task 34.
```

---

## TASK 35 — True FAST / linear streaming upgrade

```text
Read AYIN docs and current Creator TV implementation. Execute Task 35 only.

Upgrade from application-level Creator TV scheduling toward true FAST/linear output through a provider-neutral linear-streaming layer. Preserve the existing creator concept and schedules. Design HLS output, EPG, ad markers and future SSAI/Google DAI integration. Do not remove MP4 VOD fallback. Admin must retain full TV schedule/ad control. Implement only against a real selected provider/compute plan when available; otherwise finish provider-neutral orchestration and test adapters without fake production streams. Stop after Task 35.
```

---

## TASK 36 — Google Ad Manager production integration

```text
Read AYIN docs plus current official Google Ad Manager/IMA guidance. Execute Task 36 only when real Google Ad Manager account/ad unit information is available.

Connect AYIN's existing video and display ad abstractions to real Google Ad Manager configuration. Preserve house/direct fallbacks. Implement correct content/channel/device/session metadata, consent handling, ads.txt/app-ads.txt real entries supplied by the account, reporting identifiers and test-mode validation before production. Never invent publisher/network IDs. Add Admin status diagnostics and a kill switch. Stop after Task 36.
```

---

## TASK 37 — Android/Fire TV hybrid shells

```text
Read AYIN docs and current web/PWA platform adapters. Execute Task 37 only.

Create thin Android-based shells for mobile/Android TV/Google TV/Fire TV using the shared AYIN web product where technically appropriate. Add deep links, remote/back handling, fullscreen/media lifecycle, safe-area/platform capability bridge and store-ready configuration. Do not duplicate business UI in native code unless the platform requires it. Validate Google IMA behavior on the target runtime rather than assuming desktop browser equivalence. Stop after Task 37.
```

---

## TASK 38 — Samsung Tizen and LG webOS packages

```text
Read AYIN docs and official current Samsung Tizen/LG webOS TV web-app documentation. Execute Task 38 only.

Package the AYIN TV web experience for Samsung Tizen and LG webOS using platform-specific web app manifests/configuration, remote keys, lifecycle and media constraints while keeping shared web UI/business logic. Build adapter shims rather than forks. Test on emulators/real devices when available. Document model/version compatibility. Stop after Task 38.
```

---

# Execution Rule

The safest sequence is **00 -> 01 -> 02 ... -> 30**, one prompt at a time.

Post-V1 tasks 31+ are intentionally separated so an AI agent does not bloat or destabilize the launch product before the core business loop works:

**Register -> instant channel/TV -> upload -> publish -> watch -> ads -> analytics -> revenue -> admin control.**
