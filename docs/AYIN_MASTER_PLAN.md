# AYIN Master Product & Platform Plan

Status: Product blueprint / greenfield architecture
Owner: Horus Media
Product: AYIN
Primary domain: ayin.stream
Business model: Free ad-supported streaming (AVOD) + creator video platform + FAST/live expansion

## 1. Product Thesis

AYIN should not be built as a Netflix clone or a YouTube clone. The target is a unified entertainment network that combines:

- Netflix-style premium discovery, personalization, profiles, continue-watching, series/movies UX and TV-first navigation.
- YouTube-style creator channels, uploads, subscriptions, comments, playlists, Shorts/vertical video, community, live, studio analytics and creator monetization.
- Tubi/Pluto-style free ad-supported VOD and FAST/live television.
- CTV-first advertising architecture designed from day one for Google IMA / Google Ad Manager and later Google demand.
- AYIN-native differentiation: Creator TV channels, unified discovery across movies/series/creators/shorts/live, transparent monetization, social TV, watch parties and AI-assisted discovery.

The launch objective is not feature parity with Netflix or YouTube on day one. The architecture must make full parity possible without rebuilding the platform.

## 2. Product Surfaces

### Consumer

- ayin.stream — Web/PWA streaming experience.
- Android mobile app.
- iOS app.
- Android TV / Google TV.
- Amazon Fire TV.
- Samsung Tizen.
- LG webOS.
- Roku.
- Apple tvOS.
- Cast support.

### Creator

- studio.ayin.stream — Creator Studio.
- Creator channels and team roles.
- Direct video upload to Cloudflare R2.
- Content management, analytics, comments, revenue and rights tools.

### Operations

- admin.ayin.stream — Internal admin/control plane.
- ads.ayin.stream — Ad decisioning / direct campaign layer in early phases.
- api.ayin.stream — Application API.
- media.ayin.stream — Cloudflare R2 media delivery domain.

## 3. Account Model

Separate the concepts of Account, Viewer Profile and Creator Channel.

### Account

One login identity. Stores security, billing/payout identity, consent and ownership.

### Viewer Profile

An account can contain multiple viewer profiles, each with independent:

- Watch history.
- Continue Watching.
- My List.
- Likes/dislikes/preferences.
- Language and subtitle preferences.
- Recommendations.
- Notification preferences.
- Maturity restrictions.
- Kids mode / PIN lock.

### Creator Channel

An account can own or manage one or more creator channels. A creator channel has its own:

- Handle and display name.
- Avatar/banner.
- About page.
- Subscribers/followers.
- Videos/Shorts/live/posts/playlists.
- Team roles.
- Analytics.
- Monetization settings.
- Rights and payout records.

This separation lets AYIN offer Netflix-style household profiles and YouTube-style public creator identities at the same time.

## 4. Viewer Experience — Netflix-Class UX

### Home

TV-first 10-foot interface with:

- Cinematic hero/banner.
- Optional muted preview.
- Continue Watching.
- Top 10 / Trending.
- New on AYIN.
- Because You Watched.
- Popular in Your Country.
- Movies.
- Series.
- Documentaries.
- Live Now.
- FAST Channels.
- Creators You Follow.
- Recommended Creators.
- Shorts / Clips.
- Recently Added.
- Editor Picks.
- Personalized genre rows.

Rows, row order, title order and artwork should become personalized over time.

### Main Navigation

- Home
- Movies
- Series
- Live
- Creators
- Shorts / Clips
- Kids
- My AYIN
- Search

### My AYIN

- Continue Watching.
- My List.
- Watch Later.
- Liked videos/titles.
- Playlists.
- Subscriptions.
- Watch history.
- Downloads later where rights allow.
- Reminders / upcoming premieres.

### Title / Video Detail

- Hero artwork / trailer.
- Play / Resume.
- Runtime.
- Age rating.
- Genres/tags.
- Creator/studio/channel.
- Description.
- Cast/crew where relevant.
- Season/episode selector.
- Related content.
- More like this.
- Add to My List.
- Like/share.
- Chapters where applicable.
- Audio/subtitle languages.
- Comments for creator-enabled content.

### Playback

V1:

- Progressive MP4 playback.
- Seek/scrub.
- Resume position.
- Fullscreen.
- Picture-in-picture where supported.
- Playback speed.
- Captions/subtitles (WebVTT/SRT ingestion).
- Audio selection architecture for later multi-track support.
- Pre-roll/mid-roll/post-roll ad breaks.
- Autoplay next episode/video.
- Up Next overlay.
- Keyboard, touch and TV remote controls.
- Quality label reflecting source quality.

Later:

- Adaptive HLS/DASH renditions.
- Offline downloads.
- Multiple audio tracks.
- HDR / 4K where economically justified.

## 5. YouTube-Class Social & Creator Features

### Viewer Social

- Subscribe/follow channel.
- Notification bell levels.
- Like/dislike feedback signals.
- Comments.
- Threaded replies.
- Comment likes.
- Creator heart.
- Pin comment.
- Mentions.
- Share.
- Clip creation.
- Save to playlist.
- Watch Later.
- Public/private/unlisted playlists.
- Collaborative playlists later.
- Report video/comment/channel.

### Creator Channel

Tabs:

- Home
- Videos
- Shorts
- Live
- Playlists
- Posts
- About

### Community

- Text posts.
- Image posts.
- Polls.
- Quizzes later.
- Video shares.
- Scheduled posts.
- Subscriber-only posts later.

### Shorts / AYIN Clips

Use the same R2 upload pipeline with a separate content format:

- Vertical swipe feed.
- Like/comment/share/follow.
- Creator attribution.
- Watch history.
- Recommendations.
- Music/licensing system only when rights infrastructure exists.
- Short-form ad strategy separated from long-form CTV inventory.

### Live

Not required for zero-budget MVP, but architecture must support:

- Scheduled live streams.
- RTMP/SRT ingest later.
- Live chat.
- Moderators.
- Slow mode.
- Subscriber/member-only chat.
- DVR/replay.
- Concurrent viewer analytics.
- Live ad breaks.
- Stream health dashboard.
- Premieres.

### Membership / Fan Funding — Later

- Channel membership tiers.
- Members-only videos/Shorts/live/posts.
- Badges/emojis.
- Tips / Super-style contributions, subject to payment/regulatory readiness.

## 6. Creator Studio

Creator Studio should become a first-class product, not an admin form.

### Dashboard

- Realtime views.
- Watch time.
- Subscribers gained/lost.
- Top content.
- Latest upload performance.
- Estimated monetized playbacks.
- Revenue when monetization is live.
- Alerts and policy notices.

### Content Manager

Support:

- Video.
- Short.
- Series.
- Season.
- Episode.
- Trailer.
- Live event.
- Playlist.
- Community post.

Per-content controls:

- Title.
- Description.
- Thumbnail.
- Category/genres.
- Tags.
- Language.
- Captions.
- Chapters.
- Visibility: draft/public/unlisted/private/scheduled.
- Premiere.
- Audience/maturity rating.
- Geographic availability.
- Rights territories.
- Rights expiry.
- Monetization on/off.
- Ad-break timestamps.
- Comments on/off.
- Embedding/sharing setting.

### Analytics

Viewer metrics:

- Impressions.
- CTR.
- Video starts.
- Views.
- Unique viewers.
- Watch time.
- Average view duration.
- Completion rate.
- Audience retention curve.
- New vs returning viewers.
- Subscriber conversion.
- Traffic sources.
- Search terms.
- Geography.
- Device/platform.
- TV vs mobile vs web consumption.

Ad metrics:

- Ad requests.
- Filled impressions.
- Fill rate.
- Ad completion rate.
- eCPM.
- Revenue.
- Revenue per watch hour.
- Frequency.
- IVT/fraud adjustments later.

Live metrics later:

- Concurrent viewers.
- Peak concurrent viewers.
- Chat messages.
- Average watch time.
- Stream health.

### Comment & Community Moderation

- Reply.
- Heart.
- Pin.
- Hide user.
- Block words.
- Hold potentially inappropriate comments.
- Report queue.

### Copyright / Rights Dashboard

- Rights declaration for every upload.
- License type.
- Territory.
- Expiry.
- Source/proof attachment reference.
- Copyright notices.
- Takedown status.
- Disputes/appeals.
- Duplicate/hash matching later.

## 7. Video Storage & Upload Architecture

### Hard Rule

No AYIN video file is stored on AWS.

AWS/EC2 may host application compute, API and database, but media storage remains on Cloudflare R2.

### V1 Media Format

AYIN accepts playback-ready MP4 only.

Recommended initial acceptance profile:

- Container: MP4.
- Video: H.264/AVC.
- Audio: AAC-LC.
- Resolution: up to 1080p initially.
- Reasonable source bitrate cap to protect viewers from unnecessarily heavy files.
- Fast-start MP4 strongly required so metadata is available near the beginning of the file.

The uploader must validate the selected file before starting the upload. Validation can occur in the creator browser without converting the video.

### Direct Creator Upload

1. Creator creates a draft content record.
2. AYIN API verifies creator permissions and quota.
3. AYIN issues short-lived R2 upload authorization.
4. Browser uploads directly to R2; bytes never pass through EC2.
5. Large video uses multipart upload for resumability and parallel parts.
6. Upload completion is confirmed to AYIN API.
7. Technical validation and moderation state are recorded.
8. Creator completes metadata and submits for publishing.
9. New/untrusted creators can require review before public publication.

### R2 Object Layout

Example:

videos/{channelId}/{videoId}/source.mp4
thumbnails/{channelId}/{videoId}/cover.webp
captions/{channelId}/{videoId}/{language}.vtt
rights/{channelId}/{videoId}/metadata.json

Future adaptive output:

renditions/{channelId}/{videoId}/hls/...
renditions/{channelId}/{videoId}/dash/...

The original MP4 remains the source of truth so transcoding can be added later without migration.

### Delivery

- media.ayin.stream attached to R2.
- Cloudflare cache/CDN in front of public media where appropriate.
- HTTP byte-range support for seeking and progressive MP4 playback.
- Random/non-guessable object keys.
- Hotlink/token access controls later where required.
- r2.dev must not be used for production.

## 8. Advertising Architecture

Advertising must be designed into the player before Google monetization is enabled.

### Phase A — House Ads

- Integrate Google IMA SDK where supported.
- AYIN VAST endpoint.
- House campaigns for Horus Media / AYIN.
- Pre-roll, mid-roll and post-roll.
- Ad quartile tracking.
- Frequency caps.
- Basic targeting: country, platform, content category.

### Phase B — Direct Advertising

Internal campaign model:

- Advertiser.
- Campaign.
- Order.
- Creative.
- Targeting.
- Budget.
- CPM.
- Impression goal.
- Start/end time.
- Frequency cap.
- Pacing.
- Reporting.

This gives AYIN real ad-serving capability before programmatic demand.

### Phase C — Google Ad Manager

Preserve the same player architecture and replace/augment the ad source with Google Ad Manager VAST tags.

Prepare from day one for:

- IMA SDK.
- VAST 4.
- VMAP/ad rules.
- CTV content metadata.
- Content channel/network identifiers.
- Video duration.
- Continuous-play signal.
- Device/app identifiers where required and consented.
- Session/frequency-capping identifiers.
- app-ads.txt.
- ads.txt for web inventory.
- Open Measurement / OMID on supported app environments.

### Phase D — Google Demand / AdX Expansion

When AYIN has approved apps, compliant inventory, meaningful traffic and the appropriate Google relationship/account access:

- Google demand.
- Authorized Buyers.
- Programmatic deals.
- Open Bidding where eligible.
- Programmatic Guaranteed / Preferred Deals where available.

### Revenue Attribution

Every ad impression must map to:

- Viewer session.
- Content ID.
- Creator/channel ID.
- App/platform.
- Country.
- Ad break.
- Campaign/demand source.

This makes creator revenue sharing possible later without rebuilding reporting.

## 9. Creator Monetization & Economics

Do not hard-code a single revenue split.

Create a configurable contract model per creator/channel:

- Net-revenue share percentage.
- Minimum payout threshold.
- Eligible countries/content.
- Ad formats.
- Payment schedule.
- Rights term.
- Adjustments for invalid traffic/refunds.

Creator dashboard should show:

- Estimated revenue.
- Finalized revenue.
- Adjustments.
- Revenue by video.
- Revenue by country/platform.
- RPM/revenue per 1,000 views where meaningful.
- eCPM/fill where disclosure policy allows.
- Payout history.

Future monetization options:

- Advertising.
- Sponsorships.
- Memberships.
- Tips.
- Paid premieres/events.
- Premium/ad-free plans.
- Creator storefronts/merch integrations.

## 10. FAST / Linear TV Layer

AYIN should eventually offer both VOD and FAST.

### V1 FAST-Lite

A scheduled channel can be generated from existing VOD assets:

- 24-hour schedule.
- EPG.
- Now/Next.
- Auto-play scheduled programs.
- Ad breaks between/inside programs.
- Geo availability.

### Future True FAST

- Linear HLS output.
- SSAI/DAI.
- Live inputs.
- SCTE-35/ad markers where relevant.
- Real-time EPG.
- Channel distribution APIs/feeds.

### Differentiator: Creator TV

Verified creators can convert a playlist/library into a 24/7 AYIN FAST channel. This turns creator VOD into television inventory without requiring creators to run live infrastructure.

## 11. Recommendation & Discovery System

### Phase 1 — Rules

- Trending.
- Popular by country.
- Recently added.
- Category affinity.
- Followed creators.
- Continue Watching.
- Similar tags/genres.
- Completion-based recommendations.

### Phase 2 — Personalized Ranking

Signals:

- Starts.
- Completion.
- Watch time.
- Rewatches.
- Likes/dislikes.
- Saves.
- Search clicks.
- Skips/early exits.
- Creator follows.
- Recency.
- Device and session context.

Personalize:

- Which rows appear.
- Row order.
- Item order.
- Artwork variants later.

### Phase 3 — AYIN Lens / Semantic Discovery

Natural-language discovery across catalog and creators, e.g.:

- “Show me 20-minute history documentaries with Arabic subtitles.”
- “Funny technology videos I have not watched yet.”
- “Live sports channels available now.”

Keep recommendation controls transparent enough for users to reset history/preferences and understand why content is shown.

## 12. Search

V1:

- Title.
- Creator/channel.
- Series.
- Description.
- Tags.
- Genre/category.
- Autocomplete.
- Typo tolerance where possible.

Later:

- Semantic search.
- Voice search.
- Search by person/cast.
- Search filters by duration, year, language, availability and content type.

## 13. Analytics Architecture

Track events from day one, even before advanced analytics UI exists.

Core events:

- app_open
- home_impression
- row_impression
- content_impression
- content_click
- video_start
- video_25
- video_50
- video_75
- video_complete
- pause
- seek
- buffer_start
- buffer_end
- autoplay_next
- search
- search_result_click
- subscribe
- unsubscribe
- like
- dislike
- comment
- share
- playlist_add
- ad_request
- ad_start
- ad_25
- ad_50
- ad_75
- ad_complete
- ad_click

Key platform KPIs:

- DAU/MAU.
- Watch hours.
- Average session duration.
- Average watch time/user.
- D1/D7/D30 retention.
- Content start rate.
- Completion rate.
- Rebuffer ratio.
- Time-to-first-frame.
- Search success rate.
- Active creators.
- Upload success rate.
- Ad fill rate.
- Ad completion rate.
- Revenue per watch hour.
- eCPM.
- Invalid traffic rate.
- Crash-free sessions.

## 14. Moderation, Trust & Safety

A creator platform cannot launch safely without control systems.

### Creator Trust Levels

- New/unverified: pre-publication review.
- Established: faster review/post-publication moderation.
- Verified partner: additional permissions and monetization tools.

### Content Controls

- Report content.
- Report copyright.
- Age restriction.
- Geo restriction.
- Manual takedown.
- Automated expiry.
- Strikes/warnings.
- Appeal workflow.
- Duplicate file hashes.
- Re-upload blocking later.
- Ad suitability classification.

### Comments

- Spam protection.
- Rate limits.
- Blocked-word lists.
- Creator moderation.
- Platform moderation.
- User blocking/hiding.

### Security

- Short-lived upload authorization.
- No exposed R2 write credentials.
- Random object keys.
- CORS restricted to AYIN origins.
- Rate limiting.
- Cloudflare Turnstile where useful.
- CSRF/XSS protection.
- Sanitized user metadata.
- Audit log for admin actions.
- Role-based access control.
- 2FA for creators/admins later.

## 15. Rights, Legal & Policy Foundation

Required before serious creator onboarding:

- Terms of Service.
- Privacy Policy.
- Cookie/consent policy.
- Creator Terms.
- Creator Content License / distribution and monetization grant.
- Copyright/DMCA or applicable takedown procedure.
- Community Guidelines.
- Advertising Policy.
- Monetization Policy.
- Repeat-infringer policy.
- Payout/KYC terms later.

For every monetized upload, AYIN must be able to prove that it owns or has the necessary distribution/monetization rights.

Do not monetize YouTube-hosted videos through AYIN/IMA. AYIN must monetize its own hosted/authorized video inventory.

## 16. Kids / Family

Do not mix the Kids experience into the ordinary creator platform without controls.

Recommended model:

- Parent-owned account.
- Kids viewer profile.
- Maturity filtering.
- PIN-protected adult profiles.
- Restricted search/discovery.
- No ordinary public comments in Kids mode.
- Separate advertising/privacy treatment where law/policy requires.
- Creator accounts restricted by age/KYC policy.

## 17. Technical Platform Architecture

Recommended greenfield stack prioritizing speed, maintainability and low cost.

### Web / Studio / Admin

- TypeScript.
- React.
- Next.js or equivalent modern SSR framework.
- Shared design system.
- PWA support.

### API

- TypeScript.
- NestJS/Fastify or equivalent structured Node backend.
- REST initially; internal event model designed for later services.

### Data

- PostgreSQL as source of truth.
- PostgreSQL full-text/trigram search initially.
- Redis/Valkey only when caching/queues need it.
- Dedicated analytics store later when event volume outgrows PostgreSQL.

### Media

- Cloudflare R2 only for video/media storage.
- Cloudflare custom domain/CDN.
- Direct multipart creator uploads.

### Ads

- Google IMA SDK from first ad-enabled player.
- AYIN VAST endpoint for house/direct ads.
- Google Ad Manager integration later.

### TV

Order of implementation:

1. Web/PWA.
2. Android TV / Google TV.
3. Amazon Fire TV.
4. Android/iOS mobile.
5. Samsung/LG.
6. Roku.
7. tvOS/other platforms based on audience.

Native TV playback should be evaluated per platform rather than forcing one cross-platform framework where it harms remote-navigation, playback or ad support.

## 18. Suggested Repository Structure

```text
ayin/
  apps/
    web/
    api/
    studio/
    admin/
    tv-android/
  packages/
    ui/
    config/
    auth/
    db/
    video/
    ads/
    analytics/
    types/
  docs/
    AYIN_MASTER_PLAN.md
    ARCHITECTURE.md
    DATA_MODEL.md
    API.md
    ADS.md
    CONTENT_POLICY.md
    LAUNCH_CHECKLIST.md
  infra/
    cloudflare/
    deployment/
```

Do not create microservices prematurely. Start as a modular monolith with clear boundaries so services can be extracted when traffic justifies it.

## 19. Core Data Model

Main entities:

- accounts
- viewer_profiles
- channels
- channel_members
- videos
- series
- seasons
- episodes
- media_assets
- thumbnails
- captions
- chapters
- categories
- tags
- playlists
- playlist_items
- watch_history
- watch_progress
- reactions
- comments
- subscriptions
- notifications
- community_posts
- polls
- live_streams
- fast_channels
- fast_schedule_items
- content_rights
- moderation_cases
- reports
- ad_breaks
- advertisers
- campaigns
- creatives
- ad_impressions
- creator_contracts
- earnings_ledger
- payouts
- audit_logs

## 20. AYIN Differentiators

Features designed to make AYIN more than a clone:

### Unified Entertainment Graph

One recommendation/search system across studio movies, creator videos, Shorts, live and FAST.

### Creator TV

Turn a creator playlist/catalog into a scheduled FAST channel automatically.

### TV + Phone Companion Mode

Pair a phone with the TV via QR code for searching, comments, queue management, reactions and sharing without typing on a TV remote.

### Watch Parties

Synchronized playback rooms with optional chat/reactions and host controls.

### Transparent Creator Economics

Clear content-level ad/revenue reporting and a proper ledger rather than opaque payout totals.

### AYIN Lens

Natural-language catalog discovery and later semantic recommendation.

### Cross-Format Creator Identity

The same creator can publish premium long-form, episodes, Shorts, posts, live and a FAST channel from one studio.

## 21. MVP Launch Scope

AYIN MVP is ready for a private/public beta when all of the following work reliably:

### Viewer

- Registration/login.
- Viewer profiles.
- Netflix-style Home.
- Search.
- Movie/video detail.
- MP4 playback with seeking.
- Continue Watching.
- Watch history.
- My List/Watch Later.
- Playlists.
- Likes.
- Comments.
- Subscriptions.
- Notifications basics.

### Creator

- Channel creation.
- Direct R2 upload.
- Large-file multipart/resume.
- MP4 validation.
- Thumbnail.
- Metadata.
- Captions.
- Chapters.
- Visibility/scheduling.
- Video management.
- Basic analytics.
- Comment moderation.
- Rights declaration.

### Ads

- IMA integrated.
- House VAST ad.
- Pre-roll.
- Configurable mid-roll.
- Basic ad event analytics.

### Platform

- Admin moderation.
- User/content reports.
- Rights/takedown workflow.
- Cloudflare media custom domain.
- Database backup plan.
- Audit logs.
- Core legal pages.
- ads.txt/app-ads.txt planning.
- Monitoring/error reporting.

## 22. Development Roadmap

### Phase 0 — Foundation

- Product requirements.
- Brand/design system.
- Repo structure.
- Database schema.
- Auth/account/profile model.
- Cloudflare R2 setup.
- API conventions.
- Security baseline.

### Phase 1 — Netflix Core

- Home/discovery.
- Title pages.
- MP4 player.
- Profiles.
- Continue Watching.
- My List.
- Search.
- Series/seasons/episodes.

### Phase 2 — Creator Core

- Channels.
- R2 direct upload.
- Studio content manager.
- Publishing workflow.
- Captions/chapters.
- Creator analytics basics.

### Phase 3 — YouTube Social Layer

- Subscriptions.
- Comments/replies.
- Likes.
- Playlists/Watch Later.
- Notifications.
- Community posts.
- Clips.

### Phase 4 — Advertising Core

- IMA.
- VAST house ads.
- Ad breaks.
- Direct campaigns.
- Ad reporting.
- Revenue attribution architecture.

### Phase 5 — TV Launch

- Android TV / Google TV.
- Fire TV.
- Remote-first navigation.
- Deep links.
- Continue Watching sync.
- App-store publishing readiness.

### Phase 6 — Shorts & Creator Growth

- Vertical feed.
- Short uploads.
- Short analytics.
- Cross-format discovery.

### Phase 7 — FAST / Live

- FAST-Lite scheduling.
- EPG.
- Creator TV.
- Live ingestion infrastructure.
- Live chat/moderation.

### Phase 8 — Google Monetization Readiness

- Google Ad Manager integration.
- app-ads.txt.
- CTV metadata/signals.
- OMID/open measurement where applicable.
- Consent/IFA implementation.
- App readiness reviews.
- Programmatic demand expansion when eligible.

### Phase 9 — Advanced Platform

- Adaptive HLS/DASH transcoding.
- Offline downloads.
- Watch parties.
- Memberships.
- AI/semantic discovery.
- Advanced recommendation ranking.
- Advertiser self-service.
- Multi-language metadata and AI-assisted captions.

## 23. Cost Strategy

### Zero/near-zero launch

- Existing compute can run application/API/database.
- Video storage: R2 Standard.
- First 10 GB R2 storage within included monthly tier.
- No video transcoding.
- No AWS video storage.
- House ads first.
- Manual moderation first.
- PostgreSQL analytics/rollups first.

### Scale only when usage demands it

Spend first on the bottlenecks users can actually feel:

1. Storage beyond free tier.
2. Database reliability/backups.
3. Transcoding/adaptive bitrate.
4. TV app quality.
5. Moderation tooling.
6. Analytics infrastructure.
7. Live/FAST infrastructure.

## 24. Seed Content Strategy

Before asking creators to trust AYIN, the product must look alive.

Seed content sources must be legally safe and documented:

- AYIN-owned originals.
- Public-domain works with verified status.
- Commercially reusable Creative Commons content where terms are satisfied.
- Directly licensed content.
- Early creator pilot agreements.

Every seed asset gets a rights record, source, license, territories and expiry if applicable.

Do not build the catalog from copied YouTube videos.

## 25. Launch Gates

Do not launch public creator onboarding until:

- Large MP4 uploads survive interrupted connections.
- Seeking works consistently via HTTP ranges.
- Unauthorized users cannot write to R2.
- A creator cannot publish without a rights declaration.
- Admin can instantly unpublish content.
- Reports and takedowns are actionable.
- Comments have spam/rate-limit controls.
- Playback events and ad events are measured.
- Continue Watching sync works across devices.
- House ads can play without breaking content playback.
- Privacy/Terms/Creator Terms/Community Guidelines are live.

## 26. North-Star Metrics

Primary:

- Total watch hours.
- Returning viewers.
- Monthly active viewers.
- Active creators.
- Published content hours.
- Revenue per watch hour once monetized.

Guardrails:

- Rebuffer ratio.
- Time-to-first-frame.
- Ad load / ad abandonment.
- Copyright/takedown rate.
- Invalid traffic rate.
- Creator upload failure rate.
- Moderation response time.

## 27. Strategic Rule

AYIN should be built as a modular entertainment platform, not as a collection of pages.

Every important capability — viewer identity, creator identity, content, media asset, rights, recommendation, social graph, analytics, ads, moderation and revenue — must have a clean data model and API boundary from the beginning.

That is what allows AYIN to begin cheaply with direct MP4 on R2 and later evolve into a serious CTV/OTT/creator network without rewriting the business.