from pathlib import Path

ROOT = Path.cwd()


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"anchor missing in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


def delete_if_exists(path: str) -> None:
    target = ROOT / path
    if target.exists():
        target.unlink()


# Register the media-processing admin controller in the real Admin module.
replace_once(
    "apps/api/src/admin/admin.module.ts",
    'import { AdminGovernanceService } from "./admin-governance.service.js";\n',
    'import { AdminGovernanceService } from "./admin-governance.service.js";\nimport { AdminMediaProcessingController } from "./admin-media-processing.controller.js";\n',
)
replace_once(
    "apps/api/src/admin/admin.module.ts",
    "    AdminGovernanceController,\n    AdminScopedDirectoryController,\n",
    "    AdminGovernanceController,\n    AdminMediaProcessingController,\n    AdminScopedDirectoryController,\n",
)

# Preserve the distinction between an upload that has not finished and a video
# that is genuinely queued/processing.
replace_once(
    "apps/api/src/creator/quick-upload.service.ts",
    '''      const canonicalReady = video.mediaAssets.some(\n        (asset) => asset.status === "VALIDATED" && asset.mimeType === "video/mp4",\n      );\n      if (!canonicalReady) {\n        const processing = video.mediaProcessingJobs[0];\n        if (processing?.status === "FAILED") {\n          throw new QuickUploadError(\n            "VIDEO_PROCESSING_FAILED",\n            "AYIN could not prepare this video for playback. It is saved in Studio for review or retry.",\n            409,\n          );\n        }\n        throw new QuickUploadError(\n          "VIDEO_PROCESSING",\n          "AYIN is preparing this video for reliable playback. Publishing will be available when processing reaches Ready.",\n          409,\n        );\n      }\n''',
    '''      const canonicalReady = video.mediaAssets.some(\n        (asset) => asset.status === "VALIDATED" && asset.mimeType === "video/mp4",\n      );\n      if (!canonicalReady) {\n        const processing = video.mediaProcessingJobs[0];\n        const uploadedSource = video.mediaAssets.some((asset) => asset.status === "UPLOADED");\n        if (!uploadedSource && !processing) {\n          throw new QuickUploadError(\n            "UPLOAD_NOT_COMPLETE",\n            "The video is still uploading. Processing starts automatically after the upload reaches 100%.",\n            409,\n          );\n        }\n        if (processing?.status === "FAILED") {\n          throw new QuickUploadError(\n            "VIDEO_PROCESSING_FAILED",\n            "AYIN could not prepare this video for playback. It is saved in Studio for review or retry.",\n            409,\n          );\n        }\n        throw new QuickUploadError(\n          "VIDEO_PROCESSING",\n          "AYIN is preparing this video for reliable playback. Publishing will be available when processing reaches Ready.",\n          409,\n        );\n      }\n''',
)

# A successful worker finalization also advances platform-seeded content so the
# admin catalog cannot publish a raw/staging upload.
replace_once(
    "apps/api/src/media/media-processing-lifecycle.service.ts",
    '''      await tx.video.update({\n        where: { id: job.videoId },\n        data: {\n          durationMs: input.metadata.durationMs,\n          ...(job.video.status === "VALIDATING" ? { status: "DRAFT" as const } : {}),\n        },\n      });\n      return { job: ready, asset: canonicalAsset };\n''',
    '''      await tx.video.update({\n        where: { id: job.videoId },\n        data: {\n          durationMs: input.metadata.durationMs,\n          ...(job.video.status === "VALIDATING" ? { status: "DRAFT" as const } : {}),\n        },\n      });\n      await tx.contentSeedItem.updateMany({\n        where: { videoId: job.videoId, status: "UPLOADING" },\n        data: { status: "READY", error: null },\n      });\n      return { job: ready, asset: canonicalAsset };\n''',
)

# Platform content seeding follows the same canonical-media gate as creator uploads.
replace_once(
    "apps/api/src/admin/content-seeding.service.ts",
    '''  async confirmUpload(itemId: string) {\n    const item = await this.item(itemId);\n    const source = await this.database.client.mediaAsset.findFirst({\n      where: {\n        videoId: item.videoId,\n        kind: "SOURCE_VIDEO",\n        status: { in: ["UPLOADED", "VALIDATED"] },\n        removedAt: null,\n      },\n      select: { id: true },\n    });\n    if (!source) {\n      throw adminBadRequest(\n        "SEED_UPLOAD_NOT_COMPLETE",\n        "The MP4 upload has not completed successfully.",\n      );\n    }\n''',
    '''  async confirmUpload(itemId: string) {\n    const item = await this.item(itemId);\n    const [source, processing] = await Promise.all([\n      this.database.client.mediaAsset.findFirst({\n        where: {\n          videoId: item.videoId,\n          kind: "SOURCE_VIDEO",\n          status: "VALIDATED",\n          mimeType: "video/mp4",\n          removedAt: null,\n        },\n        select: { id: true },\n      }),\n      this.database.client.mediaProcessingJob.findFirst({\n        where: { videoId: item.videoId },\n        orderBy: { generation: "desc" },\n        select: { status: true },\n      }),\n    ]);\n    if (!source) {\n      if (processing?.status === "FAILED") {\n        throw adminBadRequest(\n          "SEED_PROCESSING_FAILED",\n          "AYIN could not prepare this catalog video for playback. Retry it from Media Processing.",\n        );\n      }\n      throw adminBadRequest(\n        processing ? "SEED_VIDEO_PROCESSING" : "SEED_UPLOAD_NOT_COMPLETE",\n        processing\n          ? "AYIN is still preparing this catalog video for reliable playback."\n          : "The video upload has not completed successfully.",\n      );\n    }\n''',
)
replace_once(
    "apps/api/src/admin/content-seeding.service.ts",
    '''    const source = await this.database.client.mediaAsset.findFirst({\n      where: {\n        videoId: item.videoId,\n        kind: "SOURCE_VIDEO",\n        status: { in: ["UPLOADED", "VALIDATED"] },\n        removedAt: null,\n      },\n      select: { id: true },\n    });\n    if (!source) {\n      throw adminBadRequest("SEED_UPLOAD_REQUIRED", "Upload and verify an MP4 before publishing.");\n    }\n''',
    '''    const source = await this.database.client.mediaAsset.findFirst({\n      where: {\n        videoId: item.videoId,\n        kind: "SOURCE_VIDEO",\n        status: "VALIDATED",\n        mimeType: "video/mp4",\n        removedAt: null,\n      },\n      select: { id: true },\n    });\n    if (!source) {\n      throw adminBadRequest(\n        "SEED_PLAYBACK_NOT_READY",\n        "Wait for Media Processing to reach Ready before publishing this catalog video.",\n      );\n    }\n''',
)

# Public playback/discovery tests must represent the new canonical invariant.
for path in [
    "apps/api/test/watch-progress.integration.test.ts",
    "apps/api/test/discovery.integration.test.ts",
]:
    target = ROOT / path
    text = target.read_text()
    text = text.replace('status: "UPLOADED",', 'status: "VALIDATED",')
    target.write_text(text)

# Quick Upload integration: simulate the worker's already-tested READY finalization
# when testing publishing policy, and explicitly assert the processing gate.
replace_once(
    "apps/api/test/quick-upload.integration.test.ts",
    '''  async function completeUpload(cookie: string, draft: DraftPayload) {\n    const parts = Array.from({ length: draft.uploadSession.partCount }, (_, index) => ({\n      partNumber: index + 1,\n      etag: `etag-${index + 1}`,\n    }));\n    const completed = await app.inject({\n      method: "POST",\n      url: "/media/uploads/sessions/complete",\n      headers: { cookie },\n      payload: { sessionToken: draft.uploadSession.sessionToken, parts },\n    });\n    expect(completed.statusCode).toBe(201);\n  }\n''',
    '''  async function completeUpload(cookie: string, draft: DraftPayload) {\n    const parts = Array.from({ length: draft.uploadSession.partCount }, (_, index) => ({\n      partNumber: index + 1,\n      etag: `etag-${index + 1}`,\n    }));\n    const completed = await app.inject({\n      method: "POST",\n      url: "/media/uploads/sessions/complete",\n      headers: { cookie },\n      payload: { sessionToken: draft.uploadSession.sessionToken, parts },\n    });\n    expect(completed.statusCode).toBe(201);\n  }\n\n  async function markReady(videoId: string) {\n    const job = await prisma.mediaProcessingJob.findFirstOrThrow({\n      where: { videoId },\n      orderBy: { generation: "desc" },\n    });\n    const source = await prisma.mediaAsset.findFirstOrThrow({\n      where: { videoId, kind: "SOURCE_VIDEO", status: "UPLOADED", removedAt: null },\n    });\n    const canonical = await prisma.mediaAsset.create({\n      data: {\n        videoId,\n        channelId: source.channelId,\n        kind: "SOURCE_VIDEO",\n        status: "VALIDATED",\n        r2ObjectKey: job.outputR2ObjectKey,\n        mimeType: "video/mp4",\n        sizeBytes: 2048n,\n        durationMs: 120_000,\n        width: 1280,\n        height: 720,\n      },\n    });\n    await prisma.$transaction([\n      prisma.mediaAsset.update({\n        where: { id: source.id },\n        data: { status: "REMOVED", removedAt: new Date() },\n      }),\n      prisma.mediaProcessingJob.update({\n        where: { id: job.id },\n        data: {\n          finalAssetId: canonical.id,\n          status: "READY",\n          stage: "READY",\n          progressPercent: 100,\n          outputSizeBytes: 2048n,\n          completedAt: new Date(),\n        },\n      }),\n      prisma.video.update({\n        where: { id: videoId },\n        data: { status: "DRAFT", durationMs: 120_000 },\n      }),\n    ]);\n  }\n''',
)
replace_once(
    "apps/api/test/quick-upload.integration.test.ts",
    '''    await completeUpload(owner.cookie, draft);\n\n    const publish = await app.inject({\n''',
    '''    await completeUpload(owner.cookie, draft);\n    await markReady(draft.video.id);\n\n    const publish = await app.inject({\n''',
)
# Only the first replacement above is the happy path. Association also needs READY.
replace_once(
    "apps/api/test/quick-upload.integration.test.ts",
    '''    const draft = await createDraft(owner.cookie, owner.user.channel.id);\n    await completeUpload(owner.cookie, draft);\n\n    for (let attempt = 0; attempt < 2; attempt += 1) {\n''',
    '''    const draft = await createDraft(owner.cookie, owner.user.channel.id);\n    await completeUpload(owner.cookie, draft);\n    await markReady(draft.video.id);\n\n    for (let attempt = 0; attempt < 2; attempt += 1) {\n''',
)
replace_once(
    "apps/api/test/quick-upload.integration.test.ts",
    '''  it("requires explicit rights confirmation", async () => {\n''',
    '''  it("blocks publishing while canonical processing is still queued", async () => {\n    const owner = await register("Processing Owner", "processing-owner@example.com");\n    const draft = await createDraft(owner.cookie, owner.user.channel.id);\n    await completeUpload(owner.cookie, draft);\n\n    const status = await app.inject({\n      method: "GET",\n      url: `/creator/videos/${draft.video.id}/processing`,\n      headers: { cookie: owner.cookie },\n    });\n    expect(status.statusCode).toBe(200);\n    expect(status.json()).toMatchObject({\n      ready: false,\n      videoStatus: "VALIDATING",\n      processing: { status: "QUEUED" },\n    });\n\n    const publish = await app.inject({\n      method: "POST",\n      url: `/creator/videos/${draft.video.id}/publish`,\n      headers: { cookie: owner.cookie },\n      payload: { rightsConfirmed: true },\n    });\n    expect(publish.statusCode).toBe(409);\n    expect(publish.json().error.code).toBe("VIDEO_PROCESSING");\n  });\n\n  it("requires explicit rights confirmation", async () => {\n''',
)

# Content seeding integration proves raw uploads cannot be published before READY.
replace_once(
    "apps/api/test/content-seeding.integration.test.ts",
    '''    const confirm = await app.inject({\n      method: "POST",\n      url: `/admin/content-seeding/items/${item.id}/confirm-upload`,\n      headers: { cookie: admin.cookie },\n    });\n    expect(confirm.statusCode).toBe(201);\n    expect(confirm.json().status).toBe("READY");\n\n    const publish = await app.inject({\n''',
    '''    const waiting = await app.inject({\n      method: "POST",\n      url: `/admin/content-seeding/items/${item.id}/confirm-upload`,\n      headers: { cookie: admin.cookie },\n    });\n    expect(waiting.statusCode).toBe(400);\n    expect(waiting.json().error.code).toBe("SEED_VIDEO_PROCESSING");\n\n    const job = await prisma.mediaProcessingJob.findFirstOrThrow({\n      where: { videoId: item.video.id },\n      orderBy: { generation: "desc" },\n    });\n    const source = await prisma.mediaAsset.findFirstOrThrow({\n      where: { videoId: item.video.id, kind: "SOURCE_VIDEO", status: "UPLOADED" },\n    });\n    const canonical = await prisma.mediaAsset.create({\n      data: {\n        videoId: item.video.id,\n        channelId: owner.user.channel.id,\n        kind: "SOURCE_VIDEO",\n        status: "VALIDATED",\n        r2ObjectKey: job.outputR2ObjectKey,\n        mimeType: "video/mp4",\n        sizeBytes: 2048n,\n        durationMs: 60_000,\n        width: 1280,\n        height: 720,\n      },\n    });\n    await prisma.$transaction([\n      prisma.mediaAsset.update({\n        where: { id: source.id },\n        data: { status: "REMOVED", removedAt: new Date() },\n      }),\n      prisma.mediaProcessingJob.update({\n        where: { id: job.id },\n        data: {\n          finalAssetId: canonical.id,\n          status: "READY",\n          stage: "READY",\n          progressPercent: 100,\n          completedAt: new Date(),\n        },\n      }),\n      prisma.video.update({ where: { id: item.video.id }, data: { status: "DRAFT" } }),\n      prisma.contentSeedItem.update({ where: { id: item.id }, data: { status: "READY" } }),\n    ]);\n\n    const confirm = await app.inject({\n      method: "POST",\n      url: `/admin/content-seeding/items/${item.id}/confirm-upload`,\n      headers: { cookie: admin.cookie },\n    });\n    expect(confirm.statusCode).toBe(201);\n    expect(confirm.json().status).toBe("READY");\n\n    const publish = await app.inject({\n''',
)

# Quick Upload client helpers expose processing state.
replace_once(
    "apps/web/src/lib/quick-upload.ts",
    '''export interface QuickVideoDetails {\n''',
    '''export interface QuickProcessingStatus {\n  videoId: string;\n  ready: boolean;\n  videoStatus: string;\n  processing: null | {\n    generation: number;\n    status: "INGESTING" | "QUEUED" | "PROCESSING" | "UPLOADING" | "VERIFYING" | "READY" | "FAILED" | "CANCELLED";\n    stage: string | null;\n    progressPercent: number;\n    errorCode: string | null;\n    errorMessage: string | null;\n    attempt: number;\n    completedAt: string | null;\n  };\n}\n\nexport interface QuickVideoDetails {\n''',
)
replace_once(
    "apps/web/src/lib/quick-upload.ts",
    '''export async function confirmQuickUpload(videoId: string): Promise<void> {\n  await apiJson(`/creator/videos/${videoId}/upload-complete`, "POST", {});\n}\n''',
    '''export async function confirmQuickUpload(videoId: string): Promise<{ status: string }> {\n  return apiJson(`/creator/videos/${videoId}/upload-complete`, "POST", {});\n}\n\nexport async function getQuickProcessingStatus(\n  videoId: string,\n  signal?: AbortSignal,\n): Promise<QuickProcessingStatus> {\n  const response = await fetch(`${apiBaseUrl}/creator/videos/${videoId}/processing`, {\n    credentials: "include",\n    cache: "no-store",\n    signal,\n  });\n  if (!response.ok) throw new Error(await readApiError(response));\n  return (await response.json()) as QuickProcessingStatus;\n}\n''',
)

# The upload UI distinguishes network upload completion from canonical processing readiness.
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''  confirmQuickUpload,\n  createQuickDraft,\n''',
    '''  confirmQuickUpload,\n  createQuickDraft,\n  getQuickProcessingStatus,\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''  const [uploadComplete, setUploadComplete] = useState(false);\n  const [busy, setBusy] = useState(false);\n''',
    '''  const [uploadComplete, setUploadComplete] = useState(false);\n  const [processingReady, setProcessingReady] = useState(false);\n  const [processingLabel, setProcessingLabel] = useState<string | null>(null);\n  const [busy, setBusy] = useState(false);\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''    setUploadComplete(false);\n    setRightsConfirmed(false);\n''',
    '''    setUploadComplete(false);\n    setProcessingReady(false);\n    setProcessingLabel(null);\n    setRightsConfirmed(false);\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''      await confirmQuickUpload(draft.video.id);\n      trackAnalyticsEvent("UPLOAD_COMPLETE", {\n''',
    '''      const confirmation = await confirmQuickUpload(draft.video.id);\n      setProcessingReady(confirmation.status === "DRAFT");\n      setProcessingLabel(confirmation.status === "DRAFT" ? "Ready" : "Queued");\n      trackAnalyticsEvent("UPLOAD_COMPLETE", {\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''      setUploadComplete(true);\n      setMessage(\n        "Upload complete. Confirm your publishing rights, then publish when you're ready.",\n      );\n''',
    '''      setUploadComplete(true);\n      setMessage(\n        confirmation.status === "DRAFT"\n          ? "Upload and processing complete. Confirm your publishing rights, then publish when you're ready."\n          : "Upload complete. AYIN is preparing a reliable playback version in the background.",\n      );\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''  async function saveDetails() {\n''',
    '''  useEffect(() => {\n    if (!videoId || !uploadComplete || processingReady || published) return;\n    const controller = new AbortController();\n    let timeout: ReturnType<typeof setTimeout> | null = null;\n    let active = true;\n\n    const poll = async () => {\n      try {\n        const status = await getQuickProcessingStatus(videoId, controller.signal);\n        if (!active) return;\n        const processing = status.processing;\n        setProcessingReady(status.ready);\n        setProcessingLabel(\n          status.ready\n            ? "Ready"\n            : processing?.status === "FAILED"\n              ? "Failed"\n              : processing?.stage?.replaceAll("_", " ") ?? processing?.status ?? "Queued",\n        );\n        if (status.ready) {\n          setMessage("Processing complete. This video is ready to publish.");\n          return;\n        }\n        if (processing?.status === "FAILED") {\n          setMessage(\n            processing.errorMessage ||\n              "AYIN could not prepare this video for playback. It remains saved in Studio.",\n          );\n          return;\n        }\n        timeout = setTimeout(() => void poll(), 2000);\n      } catch (error) {\n        if (!active || controller.signal.aborted) return;\n        setMessage(error instanceof Error ? error.message : "Processing status is temporarily unavailable.");\n        timeout = setTimeout(() => void poll(), 4000);\n      }\n    };\n\n    void poll();\n    return () => {\n      active = false;\n      controller.abort();\n      if (timeout) clearTimeout(timeout);\n    };\n  }, [processingReady, published, uploadComplete, videoId]);\n\n  async function saveDetails() {\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''    if (!videoId || !uploadComplete || !rightsConfirmed || !title.trim()) return;\n''',
    '''    if (!videoId || !uploadComplete || !processingReady || !rightsConfirmed || !title.trim()) return;\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''              <strong>{uploadComplete ? "Upload complete" : "Uploading video"}</strong>\n              <span>{progress}%</span>\n''',
    '''              <strong>\n                {uploadComplete\n                  ? processingReady\n                    ? "Ready to publish"\n                    : "Processing video"\n                  : "Uploading video"}\n              </strong>\n              <span>{uploadComplete ? processingLabel ?? "Queued" : `${progress}%`}</span>\n''',
)
replace_once(
    "apps/web/src/components/upload/quick-upload.tsx",
    '''            disabled={!uploadComplete || !rightsConfirmed || !title.trim() || busy || published}\n''',
    '''            disabled={\n              !uploadComplete ||\n              !processingReady ||\n              !rightsConfirmed ||\n              !title.trim() ||\n              busy ||\n              published\n            }\n''',
)

# Remove completed one-shot generators/validators. The integration workflow and
# this script also delete themselves only after all checks pass and just before commit.
for obsolete in [
    "scripts/apply-media-processing-product-gates.py",
    "scripts/apply-media-processing-queue-phase1.mjs",
    "scripts/apply-media-processing-queue-phase1.py",
    ".github/workflows/apply-media-processing-product-gates.yml",
    ".github/workflows/apply-media-processing-queue-phase1.yml",
    ".github/workflows/validate-media-processing-queue-phase1.yml",
]:
    delete_if_exists(obsolete)

print("AYIN media pipeline integration patch applied.")
