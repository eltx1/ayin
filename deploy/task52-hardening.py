from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected text not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


# DB invariants: one locale/kind identity per video, stable creation-order listing.
replace(
    "packages/db/prisma/captions.prisma",
    '  @@index([videoId, isEnabled])\n  @@index([videoId, languageCode])',
    '  @@unique([videoId, languageCode, kind])\n  @@index([videoId, isEnabled])\n  @@index([videoId, createdAt, id])',
)
replace(
    "packages/db/prisma/migrations/20260910020000_video_captions/migration.sql",
    'CREATE UNIQUE INDEX "VideoCaptionTrack_pendingMediaAssetId_key" ON "VideoCaptionTrack"("pendingMediaAssetId");\nCREATE INDEX "VideoCaptionTrack_videoId_isEnabled_idx"',
    'CREATE UNIQUE INDEX "VideoCaptionTrack_pendingMediaAssetId_key" ON "VideoCaptionTrack"("pendingMediaAssetId");\nCREATE UNIQUE INDEX "VideoCaptionTrack_videoId_languageCode_kind_key" ON "VideoCaptionTrack"("videoId", "languageCode", "kind");\nCREATE INDEX "VideoCaptionTrack_videoId_isEnabled_idx"',
)
replace(
    "packages/db/prisma/migrations/20260910020000_video_captions/migration.sql",
    'CREATE INDEX "VideoCaptionTrack_videoId_languageCode_idx" ON "VideoCaptionTrack"("videoId", "languageCode");',
    'CREATE INDEX "VideoCaptionTrack_videoId_createdAt_id_idx" ON "VideoCaptionTrack"("videoId", "createdAt", "id");',
)

# API: label is optional; canonical language code is the deterministic fallback.
replace(
    "apps/api/src/creator/caption.validation.ts",
    '  label: captionLabelSchema,\n  kind: z.enum(["CAPTIONS", "SUBTITLES"]).default("SUBTITLES"),',
    '  label: captionLabelSchema.optional(),\n  kind: z.enum(["CAPTIONS", "SUBTITLES"]).default("SUBTITLES"),',
)
replace(
    "apps/api/src/creator/caption.service.ts",
    '      orderBy: [{ isDefault: "desc" }, { languageCode: "asc" }, { createdAt: "asc" }],',
    '      orderBy: [{ createdAt: "asc" }, { id: "asc" }],',
)
replace(
    "apps/api/src/creator/caption.service.ts",
    '    const video = await this.assertVideoEditor(accountId, videoId);\n    this.assertStorage();\n    const assetId = randomUUID();',
    '    const video = await this.assertVideoEditor(accountId, videoId);\n    this.assertStorage();\n    await this.assertUniqueIdentity(videoId, input.languageCode, input.kind);\n    const assetId = randomUUID();',
)
replace(
    "apps/api/src/creator/caption.service.ts",
    '          languageCode: input.languageCode,\n          label: input.label,\n          kind: input.kind,',
    '          languageCode: input.languageCode,\n          label: input.label ?? input.languageCode,\n          kind: input.kind,',
)
replace(
    "apps/api/src/creator/caption.service.ts",
    '    const track = await this.track(videoId, trackId);\n    if (!track.mediaAssetId) {\n      throw new CaptionError(\n        "CAPTION_NOT_READY",',
    '    const track = await this.track(videoId, trackId);\n    if (!track.mediaAssetId) {\n      throw new CaptionError(\n        "CAPTION_NOT_READY",',
)
# Insert identity check after the ready-track guard and before transaction.
replace(
    "apps/api/src/creator/caption.service.ts",
    '        409,\n      );\n    }\n    return this.database.client.$transaction(async (tx) => {\n      const explicitlyDisable = input.enabled === false;',
    '        409,\n      );\n    }\n    const nextLanguageCode = input.languageCode ?? track.languageCode;\n    const nextKind = input.kind ?? track.kind;\n    if (nextLanguageCode !== track.languageCode || nextKind !== track.kind) {\n      await this.assertUniqueIdentity(videoId, nextLanguageCode, nextKind, trackId);\n    }\n    return this.database.client.$transaction(async (tx) => {\n      const explicitlyDisable = input.enabled === false;',
)
replace(
    "apps/api/src/creator/caption.service.ts",
    '  private objectKey(videoId: string, assetId: string): string {',
    '''  private async assertUniqueIdentity(\n    videoId: string,\n    languageCode: string,\n    kind: CaptionUploadInput["kind"],\n    excludeTrackId?: string,\n  ) {\n    const existing = await this.database.client.videoCaptionTrack.findFirst({\n      where: {\n        videoId,\n        languageCode,\n        kind,\n        ...(excludeTrackId ? { id: { not: excludeTrackId } } : {}),\n      },\n      select: { id: true },\n    });\n    if (existing) {\n      throw new CaptionError(\n        "CAPTION_TRACK_DUPLICATE",\n        "This video already has a caption track with the same language and type.",\n        409,\n      );\n    }\n  }\n\n  private objectKey(videoId: string, assetId: string): string {''',
)

# Public playback keeps track order stable even if the default flag changes.
replace(
    "apps/api/src/watch/watch.service.ts",
    '        orderBy: [{ isDefault: "desc" }, { languageCode: "asc" }, { createdAt: "asc" }],',
    '        orderBy: [{ createdAt: "asc" }, { id: "asc" }],',
)

# Privacy-safe player analytics: identifiers/locale/kind/timestamp only; never cue text, label or URI.
replace(
    "apps/web/src/lib/ayin-player.ts",
    '  | { type: "playback_protocol"; videoId: string; protocol: "HLS" | "MP4" }\n  | {\n      type: "quality_switch";',
    '''  | { type: "playback_protocol"; videoId: string; protocol: "HLS" | "MP4" }\n  | {\n      type: "caption_change";\n      videoId: string;\n      trackId: string | null;\n      language: string | null;\n      kind: "CAPTIONS" | "SUBTITLES" | null;\n    }\n  | { type: "chapter_seek"; videoId: string; chapterId: string; startMs: number }\n  | {\n      type: "quality_switch";''',
)
replace(
    "apps/web/src/lib/analytics.ts",
    '  | "VIDEO_FALLBACK"\n  | "SEARCH"',
    '  | "VIDEO_FALLBACK"\n  | "VIDEO_CAPTION_CHANGE"\n  | "VIDEO_CHAPTER_SEEK"\n  | "SEARCH"',
)
replace(
    "apps/web/src/lib/analytics.ts",
    '        case "quality_switch":\n          trackAnalyticsEvent("VIDEO_QUALITY_SWITCH", {',
    '''        case "caption_change":\n          trackAnalyticsEvent("VIDEO_CAPTION_CHANGE", {\n            ...common,\n            metadata: {\n              protocol,\n              trackId: event.trackId,\n              language: event.language,\n              kind: event.kind,\n            },\n          });\n          break;\n        case "chapter_seek":\n          trackAnalyticsEvent("VIDEO_CHAPTER_SEEK", {\n            ...common,\n            positionMs: event.startMs,\n            metadata: { protocol, chapterId: event.chapterId },\n          });\n          break;\n        case "quality_switch":\n          trackAnalyticsEvent("VIDEO_QUALITY_SWITCH", {''',
)

# Common web/TV player emits the new analytics and keeps remote-focusable selectors.
replace(
    "apps/web/src/components/player/ayin-player.tsx",
    '''  const toggleCaptions = useCallback(() => {\n    setSelectedCaptionId((current) =>\n      current ? null : (defaultCaptionId ?? captions[0]?.id ?? null),\n    );\n  }, [captions, defaultCaptionId]);''',
    '''  const selectCaption = useCallback(\n    (trackId: string | null) => {\n      const track = trackId ? captions.find((candidate) => candidate.id === trackId) : undefined;\n      const nextId = track?.id ?? null;\n      setSelectedCaptionId(nextId);\n      analytics.emit({\n        type: "caption_change",\n        videoId,\n        trackId: nextId,\n        language: track?.language ?? null,\n        kind: track?.kind ?? null,\n      });\n    },\n    [analytics, captions, videoId],\n  );\n\n  const toggleCaptions = useCallback(() => {\n    selectCaption(selectedCaptionId ? null : (defaultCaptionId ?? captions[0]?.id ?? null));\n  }, [captions, defaultCaptionId, selectCaption, selectedCaptionId]);''',
)
replace(
    "apps/web/src/components/player/ayin-player.tsx",
    '''  const toggleMute = useCallback(() => {''',
    '''  const seekToChapter = useCallback(\n    (chapter: AyinPlayerChapter) => {\n      analytics.emit({\n        type: "chapter_seek",\n        videoId,\n        chapterId: chapter.id,\n        startMs: chapter.startMs,\n      });\n      seekTo(chapter.startMs);\n    },\n    [analytics, seekTo, videoId],\n  );\n\n  const toggleMute = useCallback(() => {''',
)
replace(
    "apps/web/src/components/player/ayin-player.tsx",
    '                      seekTo(chapter.startMs);',
    '                      seekToChapter(chapter);',
)
replace(
    "apps/web/src/components/player/ayin-player.tsx",
    '                onChange={(event) => setSelectedCaptionId(event.currentTarget.value || null)}',
    '                onChange={(event) => selectCaption(event.currentTarget.value || null)}',
)
replace(
    "apps/web/src/components/player/ayin-player.tsx",
    '                onChange={(event) => seekTo(Number(event.currentTarget.value))}\n                value={activeChapter?.startMs ?? chapters[0]?.startMs ?? 0}',
    '''                onChange={(event) => {\n                  const startMs = Number(event.currentTarget.value);\n                  const chapter = chapters.find((candidate) => candidate.startMs === startMs);\n                  if (chapter) seekToChapter(chapter);\n                }}\n                value={activeChapter?.startMs ?? chapters[0]?.startMs ?? 0}''',
)

# Integration coverage: optional label fallback + duplicate locale/kind rejection.
replace(
    "apps/api/test/captions-chapters.integration.test.ts",
    '        languageCode: "en-US",\n        label: "English CC",\n        kind: "CAPTIONS",',
    '        languageCode: "en-US",\n        kind: "CAPTIONS",',
)
replace(
    "apps/api/test/captions-chapters.integration.test.ts",
    '      label: "English CC",\n      language: "en-US",',
    '      label: "en-US",\n      language: "en-US",',
)
replace(
    "apps/api/test/captions-chapters.integration.test.ts",
    '    expect(finalized.json()).toMatchObject({ status: "READY", cueCount: 2 });\n\n    const playback = await app.inject({',
    '''    expect(finalized.json()).toMatchObject({ status: "READY", cueCount: 2 });\n\n    const duplicate = await app.inject({\n      method: "POST",\n      url: `/creator/studio/videos/${video.id}/captions/uploads`,\n      headers: { cookie: owner.cookie },\n      payload: {\n        fileName: "duplicate.vtt",\n        sizeBytes: captionBytes.byteLength,\n        mimeType: "text/vtt",\n        languageCode: "en-US",\n        kind: "CAPTIONS",\n      },\n    });\n    expect(duplicate.statusCode).toBe(409);\n    expect(duplicate.json().error.code).toBe("CAPTION_TRACK_DUPLICATE");\n\n    const playback = await app.inject({''',
)

Path("docs/CAPTIONS_CHAPTERS_V1.md").write_text("""# Captions + Chapters v1\n\nTask 52 adds creator-managed WebVTT captions/subtitles and chapter navigation to AYIN's existing playback stack.\n\n## Caption lifecycle\n\nCaption bodies are never stored in the primary database. The API creates an internal `MediaAsset(kind=CAPTION)` and a short-lived direct-to-media-storage `text/vtt` upload URL. Finalization verifies object size, MIME type, UTF-8, WebVTT structure, cue ordering, and known video duration before the track becomes playable. Invalid replacement uploads are rejected without replacing the currently validated asset.\n\nA track has a canonical BCP 47 language, optional creator label (falling back to the canonical language code), `CAPTIONS` or `SUBTITLES` kind, enabled/default state, and deterministic creation-order playback. `(video, language, kind)` is unique and only one track can be default per video. Creator ownership is resolved from the authenticated account's channel membership; clients cannot supply an ownership account ID.\n\n## Chapters\n\nChapters reuse Task 51 `VideoCreatorMetadata.chapters`. They remain optional and are validated as strictly increasing, non-negative integer start times inside known video duration. The public playback contract converts them to stable player chapter IDs and milliseconds. No second chapter schema is introduced.\n\n## Web + TV player\n\nAYIN uses the same `AyinPlayer` for browser and TV/remote-focus playback. Caption and chapter selectors participate in `TvFocusScope`, while existing HLS-to-MP4 fallback, IMA ad lock behavior, progress persistence, keyboard shortcuts, fullscreen and accessibility labels remain intact. `C` toggles the selected/default timed-text track. Chapter selection seeks through the normal guarded seek path.\n\n## Analytics and privacy\n\nUser-driven caption changes emit `VIDEO_CAPTION_CHANGE`; chapter navigation emits `VIDEO_CHAPTER_SEEK` in addition to the existing generic seek event. Caption analytics contain only track ID, canonical language, kind and playback protocol. Chapter analytics contain only chapter ID/start position and protocol. Cue text, caption labels, object keys/URLs and file contents are never sent as analytics metadata. Existing ad-mode analytics suppression remains unchanged.\n\n## Rollback\n\nThe feature is additive. Removing caption rows/assets leaves video media and Task 51 metadata untouched. Existing videos with no caption tracks or chapters preserve their previous playback response and controls.\n""")
