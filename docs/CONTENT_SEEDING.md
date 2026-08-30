# Controlled content seeding

AYIN launch content must enter the platform through the same ownership, rights, media and publishing boundaries used by production content. This workflow is intentionally administrative and is not a scraper or downloader.

## Safety boundary

Only authenticated AYIN administrators may use `/admin/content-seeding/*`. A destination channel must first be explicitly marked `isPlatformOwned=true` through the audited Admin channel control endpoint. This prevents the seed importer from silently publishing into creator-owned channels.

Every imported row must provide a title, content type (`CREATOR_VIDEO`, `MOVIE`, or `DOCUMENTARY`), rights basis, and internal source notes. AYIN stores the source note on the internal seed record and creates a versioned `ContentRightsDeclaration`. Source notes are operational evidence and are not a substitute for counsel, a signed license, or provenance records kept outside the application.

## JSON import

`POST /admin/content-seeding/batches` accepts one validated JSON batch of up to 100 items. JSON is the canonical bulk format for V1; CSV can be converted to this contract before calling the API rather than adding a second parsing path.

Example shape:

```json
{
  "channelId": "<platform-owned-channel-uuid>",
  "sourceLabel": "2026 launch licensed catalog",
  "items": [
    {
      "title": "Example documentary",
      "description": "Optional catalog description",
      "contentType": "DOCUMENTARY",
      "visibility": "PUBLIC",
      "rightsBasis": "LICENSED",
      "sourceNotes": "Internal license/source reference"
    }
  ]
}
```

No third-party URL is accepted as a media source. The workflow never downloads YouTube or arbitrary web video.

## MP4 upload and publish

For each seed item:

1. Request `POST /admin/content-seeding/items/:itemId/upload-session` with the MP4 size, MIME type, and optional duration.
2. Upload the bytes using the returned media authorization. Production uses the configured Cloudflare R2 adapter; tests use the isolated test adapter. AWS/S3 is not introduced by this workflow.
3. Complete the upload through the existing `/media/uploads/sessions/complete` endpoint.
4. Call `POST /admin/content-seeding/items/:itemId/confirm-upload` so AYIN verifies an uploaded source asset is attached.
5. Call `POST /admin/content-seeding/items/:itemId/publish`. Publishing adds the video to the protected Uploads playlist and connects the primary Creator TV source playlist when necessary.

The privileged upload-session flag exists only in the server-side Admin service path. Normal creator upload requests still require channel ownership.

## Validation and rollback

Invalid rights metadata, unsupported content types, malformed IDs, non-MP4 uploads, oversized/invalid media, and non-platform-owned channels fail before publication.

`POST /admin/content-seeding/batches/:batchId/rollback` is allowed only while no item in the batch is published. It deletes staged objects through the configured media adapter where possible, marks media and videos removed, marks seed items rolled back, and records an Admin audit event. A published item must first go through the explicit moderation/unpublish process; the importer does not silently erase published history.

## Production launch checklist

Before importing real catalog content:

- create or designate an AYIN-owned channel and audit the `isPlatformOwned` change;
- verify the R2 production bucket/CORS/lifecycle configuration;
- keep the signed license, ownership record, public-domain analysis, or authorization reference outside AYIN and put a stable internal reference in `sourceNotes`;
- upload only files AYIN has the right to distribute;
- spot-check playback after publication;
- keep batch IDs in the launch change log so unpublished batches can be rolled back precisely.
