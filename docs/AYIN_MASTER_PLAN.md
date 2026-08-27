# AYIN Master Product & Platform Plan — V2

Status: Product blueprint / greenfield architecture
Owner: Horus Media
Product: AYIN
Primary domain: ayin.stream
Core model: Global free ad-supported streaming + creator video platform + automatic Creator TV + future FAST/live expansion
Primary delivery model: Web/PWA first, then thin hybrid/platform shells
Application server: AWS EC2 managed through CloudPanel
Video storage: Cloudflare R2 only
Initial video format: playback-ready MP4

---

## 1. Product Thesis

AYIN is not a country-specific service and must never be designed, worded, ranked, or branded as a platform for one country. It is a global entertainment network from day one.

AYIN combines four product ideas in one coherent platform:

- Netflix-class discovery and viewing UX: cinematic home, profiles, continue watching, movies, series, recommendations, My AYIN and TV-first navigation.
- YouTube-class creator ecosystem: every user is automatically a creator, every user receives a channel, uploads, followers/subscribers, comments, playlists, analytics and future Shorts/live/community tools.
- Tubi/Pluto-style AVOD and television: free viewing supported by advertising, plus automatic Creator TV and future true FAST/live channels.
- Horus Media advertising infrastructure: in-player video advertising plus page/app display placements, direct campaigns and Google Ad Manager readiness from the first architecture.

The key AYIN differentiator is simplicity. The platform can become technically sophisticated internally, but the creator experience must remain extremely simple externally.

A creator should be able to:

1. Register in seconds.
2. Instantly receive an AYIN profile, public channel, default playlist and TV channel.
3. Upload a compatible MP4 with almost no form-filling.
4. Publish quickly.
5. Automatically see the video on the channel, default playlist and Creator TV.

Advanced controls exist, but they are hidden behind optional Advanced settings and never block the basic flow.

---

## 2. Non-Negotiable Product Principles

### 2.1 Global by design

Do not hard-code Egypt, the Middle East, the US or any single country into the product experience.

Allowed contextual rows include:

- Trending Worldwide
- Popular Now
- Popular Near You
- Popular in Your Region
- Trending in [detected/selected region]
- New on AYIN
- Because You Watched
- Recommended for You

Country/region is a personalization signal, not the identity of the platform.

### 2.2 Every registered account is automatically a creator

Registration must atomically create:

- Account
- Default viewer profile
- Public creator channel
- Unique channel handle
- Default system playlist: Uploads
- Automatic TV entity: `{Channel Name} TV`
- Default channel settings
- Default monetization eligibility record
- Default analytics record/configuration

There is no separate “Become a creator” wizard.

### 2.3 Creator simplicity over creator bureaucracy

The default upload screen should ask for the minimum necessary information.

Required by default:

- Video file
- Title, automatically prefilled from filename and editable
- One simple rights confirmation checkbox before publish

Automatically handled where possible:

- Technical MP4 validation
- File size/duration/resolution extraction in browser
- Thumbnail capture suggestion from a video frame in browser
- Channel association
- Uploads playlist association
- Creator TV association
- Default category when no category is selected
- Default visibility
- Default ad eligibility
- Default comments setting

Optional Advanced drawer:

- Description
- Custom thumbnail
- Tags
- Category
- Language
- Captions
- Chapters
- Scheduled publication
- Comments toggle
- Age/maturity setting
- Geographic restrictions
- Advanced rights details
- Ad-break preferences

The platform may store detailed internal records without forcing creators to fill them manually.

### 2.4 Admin control is a first-class product

AYIN must not hard-code business decisions that an authorized administrator may reasonably need to change.

The owner/superadmin should be able to control essentially every operational dimension through a clean admin control plane, with safe defaults, permissions and audit logs.

### 2.5 Web/PWA is the source of truth

The primary AYIN product is the web application/PWA. Mobile and TV packages should reuse the web product wherever technically appropriate.

A normal website UI/content/configuration change should propagate to hosted/hybrid web surfaces without requiring a new store release. Platform-shell changes, permissions, native SDK changes or store metadata may still require a new package release.

### 2.6 No AYIN video storage on AWS

AWS EC2 may run application services, API, database and supporting compute. AYIN video objects are stored on Cloudflare R2 only.

---

## 3. Core Product Surfaces

### Public / Viewer

- `ayin.stream` — main responsive Web/PWA experience
- Mobile PWA
- TV-oriented web UI using the same product system
- Future packaged/hybrid apps

### Creator

Creator controls should be accessible without making users feel they are entering a different complicated product.

Recommended UX:

- Quick Create / Upload button globally
- `studio.ayin.stream` for deeper analytics and library management
- Creator Studio remains optional for simple uploads

### Admin

- `admin.ayin.stream`
- Full control plane for users, channels, videos, TVs, advertising, revenue, homepage, navigation, moderation, settings, analytics and infrastructure-facing configuration

### Service domains

- `api.ayin.stream` — application API
- `media.ayin.stream` — R2 media delivery custom domain
- `ads.ayin.stream` — AYIN advertising/direct VAST services when required

---

## 4. Registration and Instant Provisioning

The registration experience must feel closer to signing into a consumer product than applying to a creator network.

### Registration options

Initial target:

- Email + password
- Google sign-in where configured

Future:

- Apple sign-in
- Other providers based on demand

### Registration transaction

On successful account creation the backend immediately provisions:

1. Account
2. Default viewer profile
3. Channel using the selected/display name
4. Unique handle, generated automatically and editable later
5. Uploads system playlist
6. Creator TV channel named from the creator channel
7. Default avatar placeholder
8. Default channel banner/theme
9. Creator settings
10. Notification preferences
11. Monetization status record

The user is then redirected into AYIN, not into a setup wizard.

A subtle success message can state:

> Your AYIN channel and TV are ready.

No additional setup is required.

---

## 5. Automatic Creator TV — Core AYIN Differentiator

Every channel automatically owns a TV channel from the moment the account is created.

Example:

Channel: `Nova Films`
TV: `Nova Films TV`

### Default behavior

- TV object exists immediately even when the creator has zero videos.
- With zero videos it displays a branded off-air/empty state rather than failing.
- Every newly published public long-form video is automatically added to the channel’s Uploads playlist.
- By default, that video also enters the automatic TV rotation.
- The automatic TV continuously loops eligible content.
- The schedule is generated automatically so creators do not need to program television manually.

### Creator controls — optional

Creators may later:

- Remove a video from TV without deleting it
- Reorder priority
- Create custom TV blocks
- Schedule a premiere window
- Create additional playlists
- Choose which playlist feeds TV
- Add a channel trailer/ident

### Admin controls

Admin can:

- Enable/disable a TV
- Override schedule
- Force/remove content
- Set default rotation algorithm
- Insert house/direct/programmatic ad breaks
- Set TV-level monetization
- Feature a TV channel
- Restrict content
- View TV analytics

### Future true FAST

The V1 Creator TV can be an application-level scheduled linear experience using existing MP4 assets. Later it can evolve to true linear HLS/FAST/SSAI infrastructure without changing the creator-facing concept.

---

## 6. Viewer Experience — Netflix-Class, Globally Neutral

### Primary navigation

- Home
- Movies
- Series
- TV
- Creators
- Shorts / Clips
- Kids
- My AYIN
- Search

Items not ready for launch can be hidden by admin feature flags rather than removed from architecture.

### Home

Cinematic, responsive and TV-friendly.

Possible rows:

- Continue Watching
- Trending Worldwide
- Popular Now
- New on AYIN
- Because You Watched
- Popular Near You
- Movies
- Series
- Documentaries
- Creator TV
- Live Now
- Creators You Follow
- Recommended Creators
- Shorts / Clips
- Recently Added
- Editor Picks
- Personalized genre/topic rows

All rows must be controlled by Admin Home Builder:

- enable/disable
- reorder
- rename
- set source/query
- set maximum items
- device targeting
- logged-in/logged-out targeting
- country/region targeting only when intentionally configured
- manual items mixed with algorithmic items

### My AYIN

- Continue Watching
- My List
- Watch Later
- Liked content
- Playlists
- Subscriptions
- Watch history
- Notifications/reminders

### Content detail

Support a unified detail model for:

- Creator video
- Movie
- Series
- Season
- Episode
- Short
- TV channel
- Future live event

Details can include:

- artwork
- title
- creator/studio
- play/resume
- description
- runtime
- year/date
- genre/category
- tags
- age/maturity rating
- episodes/seasons
- related content
- more like this
- save/like/share
- comments when enabled
- captions/chapters where available

---

## 7. Video Upload and Media Architecture

### Storage rule

All AYIN video media is stored on Cloudflare R2.

AWS EC2 does not proxy or permanently store creator video uploads.

### V1 accepted media

AYIN initially accepts playback-ready MP4.

Preferred compatibility profile:

- Container: MP4
- Video: H.264/AVC
- Audio: AAC
- Resolution: initially up to 1080p
- Browser-seekable/progressive playback compatible

Do not burden users with codec terminology unless their file fails validation.

Friendly rejection example:

> This file cannot play reliably on AYIN yet. Please upload an MP4 using H.264 video and AAC audio.

### Direct-to-R2 upload

Flow:

1. Creator selects file.
2. Browser performs lightweight metadata/compatibility checks.
3. AYIN creates video draft automatically.
4. API authorizes a direct R2 upload.
5. Browser uploads directly to R2 using multipart upload when appropriate.
6. Upload can report progress and recover/retry parts.
7. Browser/API confirms completion.
8. Minimal publish view appears with title prefilled.
9. User confirms rights and presses Publish.
10. Video becomes eligible for channel, Uploads playlist and Creator TV automatically.

### Thumbnail simplification

Where browser capability permits, AYIN should capture several local frames from the selected MP4 before/after upload and offer them as one-click thumbnail choices. This avoids requiring creators to design a thumbnail before publishing.

Creators can upload a custom image later.

### R2 layout

Example:

```text
videos/{channelId}/{videoId}/source.mp4
thumbnails/{channelId}/{videoId}/cover.webp
captions/{channelId}/{videoId}/{language}.vtt
channel-assets/{channelId}/...
```

Future transcoded output can use separate rendition prefixes without moving the original object.

### Delivery

- R2 custom domain: `media.ayin.stream`
- Cloudflare caching/CDN where appropriate
- HTTP range requests for seekable MP4 playback
- private/non-guessable object identifiers
- future signed access controls if required

---

## 8. AYIN Player

The player is a core product, not an embedded afterthought.

V1 capabilities:

- MP4 playback
- seek/scrub
- resume position
- fullscreen
- picture-in-picture where supported
- mute/volume
- playback speed
- captions
- chapters when available
- autoplay next
- next/previous episode where applicable
- keyboard control
- touch control
- TV remote/focus control
- 10-second forward/back
- in-player advertising
- ad state integrated cleanly with controls

Future:

- HLS/DASH adaptive bitrate
- multiple audio tracks
- offline downloads where rights allow
- 4K/HDR where economically justified
- SSAI/DAI

---

## 9. Social and YouTube-Class Creator Features

### Viewer actions

- Subscribe/follow channel
- Notification preference
- Like
- Dislike as recommendation feedback
- Comments
- Replies
- Comment likes
- Creator heart
- Pin comment
- Share
- Save
- Watch Later
- Playlists
- Report content/comment/channel

### Creator channel tabs

- Home
- Videos
- TV
- Shorts
- Playlists
- Posts
- About

### Community — later phase

- Text posts
- Image posts
- Polls
- Video shares
- Scheduled posts

### Shorts / Clips — later phase

Use the same R2 foundation and a vertical feed experience.

### Live — later phase

Prepare the data model for live, but do not make zero-budget launch depend on live ingest infrastructure.

---

## 10. Creator Studio — Powerful Internally, Simple Externally

The basic creator workflow must not require Studio.

Quick Upload remains available everywhere.

Studio provides deeper optional capabilities:

### Dashboard

- realtime views
- watch time
- subscribers gained/lost
- top content
- latest upload performance
- estimated monetized playbacks
- revenue when enabled

### Content library

- Videos
- Shorts
- Series/episodes
- Playlists
- TV schedule
- Posts
- Future live

### Advanced edit controls

All advanced controls are optional and can be edited after publishing.

### Analytics

- impressions
- video starts
- views
- unique viewers
- watch time
- average view duration
- completion rate
- retention curve
- traffic sources
- search terms
- geography
- device/platform
- subscribers gained/lost
- ad requests/impressions
- fill rate
- ad completion
- eCPM/RPM where applicable
- estimated/final revenue

---

## 11. Admin Control Plane — Full Platform Control

The admin is not an afterthought. Build it as an operational control system.

### Superadmin principles

- Every configurable business behavior should be represented in Admin where safe.
- Avoid hard-coded limits, percentages, row order, ad slots and creator defaults.
- Every important destructive/configuration action is audit logged.
- Secret credentials are never exposed in plaintext after saving.
- High-risk actions receive confirmation.

### Admin sections

#### Dashboard

- global users
- active users
- creators/channels
- videos
- watch time
- TV channels
- ad requests/impressions
- revenue
- upload health
- errors
- R2 storage usage indicators
- latest moderation/report activity

#### Users & Accounts

- search/view/edit account
- suspend/unsuspend
- email/identity status
- reset creator/channel defaults
- profile controls
- role controls
- view activity/audit context where appropriate

#### Channels & Creators

- edit any channel
- verify/unverify
- feature/unfeature
- monetization status
- revenue share
- quotas
- permissions
- TV status
- playlists
- channel appearance

#### Videos & Content

- search/filter every asset
- edit metadata
- publish/unpublish
- feature
- remove
- age restrict
- disable comments
- monetization controls
- TV inclusion
- playlist management
- R2 object reference and media diagnostics

#### TV Control Center

- all creator TVs
- on/off
- now/next
- automatic schedule rules
- manual overrides
- ad-break rules
- featured TV rows
- TV analytics

#### Homepage & Navigation Builder

Admin can visually/configurably manage:

- hero content
- homepage rows
- row names
- row order
- data source
- manual item overrides
- navigation items
- footer links
- announcements
- promotional banners
- per-device visibility
- feature flags

#### Categories / Taxonomy

- categories
- genres
- tags policy
- content types
- sort order
- visibility

#### Advertising

See dedicated advertising section below.

#### Revenue & Monetization

- global default creator split
- creator-specific split
- channel-specific contract
- payout threshold
- adjustments
- estimated vs finalized revenue
- payout ledger
- manual corrections with audit reason

#### Moderation & Rights

- reports queue
- copyright requests
- strikes/warnings
- block words
- comment moderation
- creator trust level
- emergency unpublish
- appeals

#### Platform Settings

- registration settings
- creator auto-provisioning defaults
- default playlist name
- TV auto-create behavior
- upload limits
- video validation rules
- default comments
- default visibility
- recommendation weights
- notification defaults
- maintenance mode
- feature flags

#### Infrastructure-facing settings

Provide safe status/configuration surfaces for:

- Cloudflare R2 bucket connectivity
- media domain health
- upload signing health
- application queues if added
- email provider
- cache/session status
- cron/job status
- API health

Do not turn the admin into raw server root access; CloudPanel remains the server operations layer.

---

## 12. Advertising Architecture — In Player and Outside Player

Advertising is designed into AYIN from the beginning.

There are two distinct inventory families.

### A. In-player video inventory — highest priority

Initial architecture:

- Google IMA HTML5 SDK where supported
- VAST-compatible ad source
- pre-roll
- mid-roll
- post-roll
- frequency caps
- ad quartile tracking
- content/channel/session attribution

Demand stages:

1. AYIN/Horus Media house ads
2. Direct advertiser campaigns
3. Google Ad Manager video tags
4. Google/programmatic demand as account eligibility and approvals allow
5. Future VMAP/ad rules, DAI/SSAI and CTV-specific expansion

### B. Outside-player display/native inventory

Web/PWA pages should include a controlled ad-slot framework separate from video ads.

Examples:

- homepage top/hero-ad slot where UX allows
- between content rows
- below player
- content detail page
- search results
- channel pages
- creator TV directory
- desktop side placements where appropriate

Use responsive placements and never compromise the TV-style premium feel.

Google Ad Manager web display inventory can later be served through Google Publisher Tag (GPT) where appropriate.

### Admin Ad Control Center

Admin can create and manage placement definitions without code changes:

- placement key
- name
- page/route
- location
- device targets
- minimum/maximum sizes
- ad type
- enabled/disabled
- logged-in/logged-out rules
- content/category rules
- frequency
- fallback behavior
- priority/demand source

### Demand priority

Configurable routing may use:

- House
- Direct
- Google Ad Manager
- future approved SSP/programmatic sources

Do not bake demand tags directly into UI components. Components request a logical placement key from a centralized ads service/configuration layer.

### Ad safety and UX

- Ads must not cover player controls unexpectedly.
- Do not create accidental-click layouts.
- Mid-roll density is configurable globally and per channel/video.
- Admin can disable ads per content item/channel/page.
- Kids/restricted experiences receive separate ad rules.
- Consent/privacy signals must be respected.

### Google readiness

Prepare for:

- Google IMA
- Google Ad Manager
- VAST/VMAP
- ads.txt
- app-ads.txt for packaged app inventory where applicable
- consent/privacy framework
- content/channel metadata
- continuous-play/session signals where required
- OM/OMID on applicable native/CTV environments later

---

## 13. Direct Advertising System

Before or alongside Google demand, AYIN can sell direct campaigns.

Model:

- Advertiser
- Campaign
- Creative
- Placement/ad format
- CPM or fixed campaign
- impression goal
- budget
- start/end
- countries/regions
- device
- content category
- channel/content targeting
- frequency cap
- pacing
- reporting

Direct video creatives can feed the VAST service; display creatives can feed page placement slots.

Admin must be able to pause a campaign instantly.

---

## 14. Revenue Attribution and Creator Monetization

Do not hard-code a single creator split.

Every monetizable impression/event should be attributable to:

- content
- channel
- creator account
- viewer session/profile pseudonymous ID as appropriate
- platform/device
- geography
- placement/ad break
- campaign/demand source
- gross/net revenue fields when available

Configurable creator contract:

- revenue share percentage
- eligible ad formats
- eligible content
- start/end date
- minimum payout
- adjustment policy

Creator-facing display remains simple:

- Estimated revenue
- Finalized revenue
- Revenue by video
- Revenue by period
- Payout history

Admin sees deeper economics and adjustment tools.

---

## 15. Recommendation and Discovery

### V1 rules

- trending worldwide
- popular now
- recently added
- popular near user/region
- followed creators
- category affinity
- completion-based signals
- similar tags/categories
- continue watching

### Later personalized ranking

Signals:

- starts
- watch time
- completion
- rewatch
- likes/dislikes
- saves
- creator subscriptions
- search clicks
- early exits
- recency
- device/session context

### AYIN Lens — later

Natural-language semantic discovery across videos, movies, series, creators and TV.

No country is assumed in examples or defaults.

---

## 16. Search

Search across:

- title
- creator/channel
- movie/series
- description
- tags
- category/genre
- TV channel

V1:

- autocomplete
- useful empty-state suggestions
- typo tolerance where feasible

Later:

- semantic search
- voice search
- advanced filters

---

## 17. Analytics Architecture

Track events from day one even when UI reporting is basic.

Core event examples:

- app_open
- home_impression
- row_impression
- content_impression
- content_click
- video_start
- video_progress
- video_complete
- pause
- seek
- buffer_start
- buffer_end
- search
- search_result_click
- subscribe
- like
- dislike
- comment
- share
- playlist_add
- tv_start
- ad_request
- ad_start
- ad_quartile
- ad_complete
- ad_click
- upload_start
- upload_complete
- publish

Primary KPIs:

- DAU/MAU
- watch hours
- average watch time
- completion rate
- return/retention
- time to first frame
- rebuffer ratio
- upload completion rate
- creator activation rate
- ad fill rate
- ad completion rate
- revenue per watch hour

---

## 18. Web/PWA-First Application Strategy

### Primary codebase

AYIN should be a responsive Web/PWA application designed from the start for:

- desktop
- mobile
- tablet
- 10-foot TV screens
- keyboard
- touch
- remote directional navigation

Recommended initial stack:

- TypeScript
- React
- Next.js
- PWA manifest/service worker
- modular shared UI/design system

### Hybrid/platform strategy

The goal is maximum reuse, not pretending every store uses identical runtime technology.

- Android mobile: web-first package/thin shell using a suitable hybrid approach such as Capacitor where appropriate.
- Android TV / Google TV / Fire TV: thin Android shell with web experience plus remote/deep-link/player/native bridges as needed.
- Samsung Tizen: packaged web application using HTML/CSS/JS and platform adapter.
- LG webOS: packaged web application using HTML/CSS/JS and platform adapter.
- iOS: hybrid shell where store/runtime requirements permit.
- Roku: requires a platform-specific adapter/application and should be treated as a later exception rather than forcing the core product to become native.
- tvOS: may require a native/platform-specific shell; keep it later if it harms web-first speed.

### Web-change propagation

The business/UI source of truth remains web/config-driven. Hosted web surfaces and shells that load the hosted application can receive ordinary product updates immediately. Store-specific/native shell changes still follow store release processes.

### TV focus system

Build a reusable remote/focus-navigation layer inside the web codebase from early development rather than attempting to bolt it on later.

---

## 19. Infrastructure — AWS + CloudPanel + Cloudflare

### AWS EC2 / CloudPanel

AWS EC2 is the application server environment already available.

CloudPanel manages domains, certificates, reverse proxy/site configuration and server operations.

Suggested service mapping initially:

- `ayin.stream` → web/PWA
- `api.ayin.stream` → API
- `studio.ayin.stream` → Creator Studio, or route within the main app initially
- `admin.ayin.stream` → Admin

To reduce operational complexity, Studio and public web can share the same Next.js application initially if clean route/module separation is maintained.

### Database

PostgreSQL is preferred.

Initial deployment can run on the existing EC2 environment if capacity permits.

Database is application data, not video media.

Backups should be automated and stored outside the live database filesystem; R2 can be used for encrypted backup objects if desired.

### Cloudflare

- DNS/proxy/WAF where appropriate
- R2 video/media storage
- `media.ayin.stream` custom domain
- direct creator uploads using short-lived authorization

### Deployment

Use repeatable automated deployment from GitHub when stable. Avoid manual server edits that cannot be reproduced.

---

## 20. Initial Data Model

Core entities should include:

- accounts
- viewer_profiles
- channels
- channel_members
- channel_settings
- videos
- media_assets
- series
- seasons
- episodes
- captions
- chapters
- playlists
- playlist_items
- creator_tv_channels
- tv_schedule_items
- watch_history
- watch_progress
- subscriptions
- reactions
- comments
- notifications
- community_posts
- content_rights
- reports
- moderation_cases
- ad_placements
- advertisers
- campaigns
- creatives
- ad_events
- creator_contracts
- earnings_ledger
- payouts
- platform_settings
- feature_flags
- admin_audit_logs

The exact schema should be normalized where useful without making basic reads unnecessarily complex.

---

## 21. Admin-Configurable Defaults

The following must not require a code deployment:

- registration open/closed
- auto creator channel creation
- default channel name template
- default playlist name
- default TV name template
- auto-add uploads to TV
- upload size limit
- allowed file type/profile
- default visibility
- default comments state
- default ad state
- creator default revenue share
- homepage rows/order
- navigation
- hero/featured content
- categories
- platform announcement
- ad placements
- ad tags/demand configuration
- mid-roll policy
- feature flags
- moderation mode
- maintenance mode

---

## 22. Moderation and Rights Without Creator Friction

Do not force a legal dashboard during every upload.

At publish time require a clear simple confirmation that the uploader has the necessary rights to upload/distribute/monetize the content.

The backend records the declaration timestamp/version.

Advanced creators/partners can optionally manage detailed rights metadata later.

Moderation tools:

- report content
- report comment
- copyright request
- admin unpublish
- creator warning/strike
- comment controls
- blocked terms
- account/channel suspension
- appeal status

New creator review policy is configurable by admin. It must not be hard-coded to make every new creator wait by default.

---

## 23. Security and Reliability Principles

- Secure password hashing and session/token management
- CSRF/XSS/SQL injection protections appropriate to architecture
- Rate limiting on auth, comments, uploads and sensitive APIs
- Short-lived upload authorizations
- Server-side authorization for every admin/creator mutation
- No client-trusted ownership checks
- Encrypted secrets
- Audit logs for admin actions
- Soft-delete/recoverable workflow for important content where feasible
- Database backups
- R2 object lifecycle/cleanup for abandoned drafts
- health checks
- structured logs
- error monitoring

Keep security strong internally without adding unnecessary visible friction to normal users.

---

## 24. Development Architecture

Prefer a modular monolith initially.

Do not start with microservices.

Suggested repository structure:

```text
ayin/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── ui/
│   ├── config/
│   ├── db/
│   ├── auth/
│   ├── media/
│   ├── ads/
│   ├── analytics/
│   └── types/
├── docs/
└── infra/
```

Admin and Studio can begin as route groups inside the web app to reduce deployment complexity, while preserving module boundaries so they can split later.

---

## 25. V1 Launch Scope

V1 should feel complete but avoid infrastructure-heavy features that are not needed to prove AYIN.

### Must ship

#### Account/creator

- smooth registration/login
- automatic profile + channel + Uploads playlist + Creator TV
- editable channel
- quick upload
- direct R2 multipart upload
- MP4 compatibility validation
- publish

#### Viewer

- cinematic responsive home
- video detail
- AYIN Player
- search
- continue watching
- history
- My List
- watch later
- channel pages
- creator TV pages
- subscriptions
- likes
- comments
- playlists

#### Admin

- full user/channel/video CRUD and status control
- homepage builder
- navigation/settings
- categories
- TV control center
- ad placement center
- direct campaign basics
- revenue-share configuration
- moderation queue
- feature flags
- audit logs

#### Advertising

- IMA-ready player
- VAST house ads
- pre/mid/post architecture
- external ad-slot framework
- Google Publisher Tag-ready web placements
- ads.txt/app-ads.txt preparation
- ad event analytics

#### Infrastructure

- PWA
- AWS EC2 + CloudPanel deployment
- PostgreSQL
- Cloudflare R2 only for video media
- Cloudflare custom media domain

### Later, without architectural rewrite

- Shorts
- Community posts
- Live ingest/chat
- true FAST/HLS
- SSAI/DAI
- Android/iOS/TV packages
- advanced recommendations
- semantic/AI search
- memberships/tips
- premium/ad-free tier
- advanced copyright fingerprinting

---

## 26. Product Success Definition

AYIN succeeds if both sides feel simple:

### Viewer

Open → discover → press play.

### Creator

Register → instantly own a channel and TV → upload → publish.

### Admin

Open Admin → find any platform element → change it without code whenever that setting is reasonably operational.

### Business

Every meaningful playback path is measurable and advertising-ready from day one, while the system remains prepared for Google Ad Manager and future CTV/programmatic demand.

---

## 27. Final V2 Architecture Decision Summary

- AYIN is global, not country-specific.
- Every registered user is automatically a viewer and creator.
- Channel, Uploads playlist and Creator TV are created automatically at registration.
- Creator UX is intentionally minimal; advanced options are optional.
- Creator TV automatically uses published channel videos unless configured otherwise.
- Admin has comprehensive control across the entire product through a dedicated control plane.
- Advertising exists both inside the player and outside the player.
- Google IMA/Ad Manager readiness is designed from the start.
- Web/PWA is the product source of truth.
- Hybrid/TV apps reuse the web product as far as each platform reasonably permits.
- AWS EC2 + CloudPanel run application services.
- Cloudflare R2 is the only AYIN video storage layer.
- V1 uses direct playback-ready MP4 to eliminate transcoding cost and complexity.
- The architecture remains ready for future HLS, live, FAST, DAI/SSAI and large-scale monetization.
