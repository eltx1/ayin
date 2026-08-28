# AYIN direct Cloudflare R2 uploads

Task 06 keeps all source-video bytes out of `apps/api`. The browser uploads directly to the private Cloudflare R2 S3 endpoint using short-lived SigV4 presigned URLs. PostgreSQL stores only media metadata and the stable R2 object key.

## Required production environment

```text
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET=<private-ayin-media-bucket>
R2_ACCESS_KEY_ID=<r2-s3-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-s3-secret-access-key>
R2_REGION=auto
UPLOAD_SESSION_SECRET=<random-secret-at-least-32-characters>
```

Optional tuning:

```text
R2_UPLOAD_URL_TTL_SECONDS=900
R2_PART_SIZE_BYTES=16777216
R2_MULTIPART_THRESHOLD_BYTES=67108864
```

The API credentials stay server-side. They are used only to sign operation-specific URLs or R2 control-plane multipart requests. A creator never receives permanent R2 credentials.

When the four R2 credential variables are absent, AYIN selects `DevelopmentMediaStorageAdapter`. It intentionally returns a friendly `R2_NOT_CONFIGURED` failure and never issues fake upload URLs or marks a development upload successful.

## R2 browser CORS

The private bucket must allow `PUT` from the AYIN web origin and expose `ETag`, because multipart completion needs the ETag returned for each uploaded part. Example production policy:

```json
[
  {
    "AllowedOrigins": ["https://your-ayin-web-origin.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use the exact production and staging web origins rather than `*`.

## Object keys and lifecycle

Source objects use server-generated stable identifiers only:

```text
channels/<channel-uuid>/media/<media-asset-uuid>/source.mp4
```

Original filenames are never used in R2 keys.

Large files use multipart upload. The client requests a short-lived URL for each part, retries failed parts up to three times and asks R2 for already uploaded parts when resuming within the session lifetime. Small files use one short-lived presigned PUT.

`MediaAsset.status` remains `PENDING` until R2 completion is verified, then becomes `UPLOADED`. Task 07 owns draft creation, rights confirmation and publishing.

## Abandoned upload cleanup

`MediaUploadService.cleanupAbandonedUploads(olderThan)` is the cleanup job entry point. A deployment scheduler can invoke a thin internal job wrapper hourly with a conservative cutoff such as 24 hours. It lists incomplete R2 multipart uploads under the AYIN channel prefix, matches them to `PENDING` MediaAsset rows by object key, aborts the multipart upload and marks the stale asset rejected/removed.

Cloudflare R2 also automatically aborts incomplete multipart uploads after its bucket lifecycle interval (7 days by default), but AYIN should run its own cleanup earlier to keep application metadata tidy.

## Compatibility inspection

The web client rejects obvious non-MP4 selections, opens the local file with browser metadata APIs and checks browser support for the H.264/AAC MP4 profile. Standard browser APIs do not reliably expose the exact codecs inside every local MP4, so AYIN reports that uncertainty rather than claiming an exact inspection. There is no Task 06 transcoder; V1 expects playback-ready H.264/AAC MP4.
