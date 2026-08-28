-- Safe, structural defaults for AYIN platform configuration.
-- Idempotent by design: never overwrite values an authorized administrator changed.

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
    'Default Creator TV name template. The {channelName} token is required.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'PLATFORM',
    'registrationEnabled',
    'BOOLEAN',
    'true'::jsonb,
    1,
    'Allow new AYIN account registrations.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'CREATOR',
    'automaticCreatorProvisioningEnabled',
    'BOOLEAN',
    'true'::jsonb,
    1,
    'Gate automatic profile/channel/Uploads/Creator TV provisioning. Disabling blocks new registration rather than creating partial accounts.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'TV',
    'autoAddPublishedUploadsToCreatorTv',
    'BOOLEAN',
    'true'::jsonb,
    1,
    'Default channel behavior for adding eligible published uploads to Creator TV.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    'CREATOR',
    'defaultVideoVisibility',
    'STRING',
    '"PUBLIC"'::jsonb,
    1,
    'Default visibility for newly created creator videos.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000007',
    'CREATOR',
    'defaultCommentsEnabled',
    'BOOLEAN',
    'true'::jsonb,
    1,
    'Default comments state for new creator content.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000008',
    'MONETIZATION',
    'defaultMonetizationAdEligibility',
    'BOOLEAN',
    'false'::jsonb,
    1,
    'Safe default advertising/monetization eligibility until creator monetization rules are explicitly enabled.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000009',
    'UPLOAD',
    'uploadMaxSizeBytes',
    'INTEGER',
    '5368709120'::jsonb,
    1,
    'Maximum creator source upload size in bytes. Default is 5 GiB.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000010',
    'UPLOAD',
    'initialMediaCompatibilityProfileText',
    'STRING',
    '"MP4 using H.264/AVC video and AAC audio, up to 1080p"'::jsonb,
    1,
    'Creator-facing compatibility guidance. This is display text, not a provider secret or raw codec policy object.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000011',
    'MONETIZATION',
    'defaultCreatorRevenueShareBps',
    'INTEGER',
    '0'::jsonb,
    1,
    'Default creator revenue share in basis points. Zero is the safe bootstrap value until commercial terms are configured.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000012',
    'MODERATION',
    'moderationDefaultMode',
    'STRING',
    '"STANDARD"'::jsonb,
    1,
    'Default moderation posture for new content and community surfaces.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000013',
    'PLATFORM',
    'maintenanceMode',
    'BOOLEAN',
    'false'::jsonb,
    1,
    'Platform maintenance mode. Runtime surfaces may consume this setting in later tasks.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("namespace", "key") DO NOTHING;
