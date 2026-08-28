# Task 07 — Quick Upload

AYIN's creator upload path is intentionally simple: choose a playback-ready MP4, wait for the direct Cloudflare R2 upload, confirm rights, and publish.

## Flow

1. Signed-in users get a global **Create / Upload** action.
2. File selection runs the existing lightweight browser compatibility check.
3. AYIN immediately creates a Video draft and a Task 06 R2 upload session.
4. The browser uploads source-video bytes directly to R2 with visible progress; `apps/api` never receives those bytes.
5. The title is prefilled from the filename and remains editable.
6. Browsers that can decode the local MP4 may offer three locally captured frame thumbnail choices. Thumbnail bytes also upload directly to R2 through short-lived authorization.
7. The only mandatory publish-time confirmation beyond the video/title is the rights checkbox.
8. Publish verifies the source MediaAsset is complete, persists rights declaration version 1, transitions the Video atomically, adds it to the protected Uploads playlist exactly once, and uses that playlist as the Creator TV source when platform/channel settings permit.

## Advanced settings

The collapsed drawer exposes only capabilities represented by the current schema: description, thumbnail, schedule, visibility, and comments. Tags/category, language, captions, chapters, maturity, geo restrictions, and ad-break preferences remain non-blocking future capabilities rather than being stored in invented fields.

Creator details remain editable after publication through the same ownership-checked details endpoint.

## Scope boundaries

Task 07 does not add transcoding, Studio dependency, public channel pages, caption pipelines, Creator TV scheduling logic, or new unsupported metadata schema. Those remain later roadmap tasks.
