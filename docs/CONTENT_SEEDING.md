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
4. Upload completion acknowledges received bytes. The canonical media worker must still validate playback. In the native `/admin/content` workflow, use **Refresh original batch** to read the original batch and item's durable processing status. A pending worker job is **Processing**, not an upload failure. The worker transitions the seed item to `READY`; the UI does not call or replay `confirm-upload`. API clients may explicitly call `POST /admin/content-seeding/items/:itemId/confirm-upload` after readiness, preserving its current validation contract.
5. Review the ready original item, then explicitly choose **Publish**. The former “publish immediately” option is replaced by this separate review step; publication intent is never silently resumed after processing, navigation, verification, or reload. API clients call `POST /admin/content-seeding/items/:itemId/publish`. Publishing adds the video to the protected Uploads playlist and connects the primary Creator TV source playlist when necessary.

The privileged upload-session flag exists only in the server-side Admin service path. Normal creator upload requests still require channel ownership.

### Native processing and recovery

The page retains the exact returned batch/item IDs as soon as creation is acknowledged. It offers bounded, explicit status reads, with no background polling. `GET /admin/content-seeding/batches/:batchId` returns the original batch even after it leaves the recent-50 list, including each video's latest durable processing-job status. The read uses the same Admin roles as the existing list. Eligible channel filtering happens on the server before the 100-channel bound; eligibility remains platform-owned and not removed, including suspended channels as before.

A failed upload/session/publication acknowledgment never restarts file bytes, creates a replacement batch, replays upload confirmation, or publishes automatically. If the server explicitly rejects the original upload-session request (for example, step-up is required), the operator may verify and choose **Continue original upload** while that file is still present. When upload bytes finish after the five-minute verification window, a definitive `STEP_UP_REQUIRED` completion rejection opens verification and retains only that exact completion payload in transient, identity-bound memory. After verification, **Finish original upload** submits that metadata explicitly; it never resends file bytes. A timeout, lost acknowledgment, changed identity, unverified failure or departure cannot replay that completion. An ambiguous transfer/session outcome instead requires reading the original batch. This is not durable file-transfer recovery. If batch creation's acknowledgment is lost, creation is blocked until the operator reviews recent source/title evidence and opens the original batch.

A lost publication or rollback acknowledgment blocks repeating that mutation while its outcome is unknown. A subsequent read can establish that the original operation committed. An acknowledged publication remains shown as committed even if the next status read fails. Processing failures link to the existing Media Processing controls; retry there and then refresh the original batch. Rollback always requires an explicit confirmation, and published content remains protected.

The native workspace uses the shared Admin session coordinator, pre/post authority reads, bounded request cancellation and synchronous native-field concealment. A session/role/lifecycle change cancels ongoing work and destroys private draft/file state when authority is invalidated. No publish intent or file is stored across reloads.

Acceptance coverage: `tests/e2e/content-import.acceptance.spec.ts` uses isolated API/Prisma fixtures and the existing worker lifecycle to prove processing → ready → explicit publication, failures, ambiguous acknowledgments, duplicate actions, rollback cancellation and EN/AR originals. The test storage endpoint is isolated; it does not activate a real catalog import or claim production R2 processing evidence.

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
