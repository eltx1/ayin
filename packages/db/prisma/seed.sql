-- Minimal structural defaults required by zero-friction creator provisioning.
-- Idempotent by design: never overwrite values that an administrator may have changed.

INSERT INTO "PlatformSetting" (
  "id",
  "namespace",
  "key",
  "valueType",
  "value",
  "schemaVersion",
  "description",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'CREATOR',
    'uploadsPlaylistName',
    'STRING',
    '"Uploads"'::jsonb,
    1,
    'Protected system playlist name used during creator provisioning.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'TV',
    'creatorTvNameTemplate',
    'STRING',
    '"{channelName} TV"'::jsonb,
    1,
    'Default Creator TV name template used during creator provisioning.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("namespace", "key") DO NOTHING;
