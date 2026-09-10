# TASK 51 — Creator Video Metadata V2

AYIN keeps the primary creator flow intentionally small: **choose video → title → publish**. All richer metadata is optional, lives behind collapsed Advanced settings, and is never required for publishing.

## Data ownership

- `Video.contentType` remains the source of truth for content type. TASK 51 does not duplicate it.
- `ContentRightsDeclaration` remains the source of truth for rights basis and creator rights statements.
- `VideoCreatorMetadata` is an optional 1:1 companion keyed by `videoId`. A row is created only when a creator supplies companion metadata.
- The migration is additive and does not backfill or modify existing videos.

## Optional metadata

The companion supports tags, category, primary BCP 47 language, recording date, a series/season/episode placeholder, maturity level, geographic-availability policy hooks, chapters, and creator ad-break preferences.

The series fields are deliberately placeholders. AYIN discovery must not treat them as a first-class series catalog until a real catalog relationship model exists.

Maturity and geographic fields are policy hooks only. They do not bypass or replace viewer eligibility, legal availability, parental-control, or regional policy domains.

## Validation

- Title: existing 200-character limit.
- Description: 20,000 characters.
- Tags: maximum 20, maximum 40 characters each; stored normalized and case-insensitively de-duplicated.
- Category: constrained enum.
- Primary language: valid/canonical BCP 47 language tag.
- Recording date: valid date and not in the future.
- Chapters: maximum 100; titles up to 100 characters; non-negative, strictly increasing start times; every start must be before the known video duration.
- Geographic country codes: ISO-style two-letter uppercase codes, maximum 50.
- Custom ad-break offsets: maximum 20 positive whole-second offsets, before the known video duration.

## Search and discovery

Search may consume normalized tags and category because those fields are creator-authored descriptors suitable for retrieval. Movie discovery may consume the existing `Video.contentType = MOVIE` classification. The series placeholder, maturity hook, and geographic hook are not used as ranking truth.

## Advertising

Creator ad-break settings feed the existing Creator TV ad-break hook. `DISABLED` suppresses returned markers for that program. `CUSTOM` offsets are preferences passed to the hook; TASK 51 does not fabricate ad inventory or override the advertising provider.

## SEO

SEO remains automatic. TASK 51 adds no manual SEO title, SEO description, keyword, canonical, or indexing field to the creator flow.

## Admin visibility

Authorized Operations and Content Moderation admins can read composed metadata through `GET /admin/video-metadata/:videoId`. This is visibility only; domain ownership remains with Video, rights, and creator metadata services.
