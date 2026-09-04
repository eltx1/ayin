from pathlib import Path

ROOT = Path.cwd()


def patch(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"anchor missing: {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


patch(
    "apps/api/src/creator/quick-upload.service.ts",
    '''  async confirmUpload(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    const source = await this.database.client.mediaAsset.findFirst({
      where: {
        videoId,
        channelId: video.channelId,
        kind: "SOURCE_VIDEO",
        status: { in: ["UPLOADED", "VALIDATED"] },
        removedAt: null,
      },
      select: { id: true },
    });
    if (!source) {
      throw new QuickUploadError(
        "UPLOAD_NOT_COMPLETE",
        "The video is still uploading. Publishing will be available when it reaches 100%.",
        409,
      );
    }
    const updated = await this.database.client.video.update({
      where: { id: videoId },
      data: video.status === "UPLOADING" ? { status: "DRAFT" } : {},
      select: { id: true, status: true },
    });
    return { videoId: updated.id, status: updated.status };
  }
''',
    '''  async confirmUpload(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    const [source, canonical, processing] = await Promise.all([
      this.database.client.mediaAsset.findFirst({
        where: {
          videoId,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "UPLOADED",
          removedAt: null,
        },
        select: { id: true },
      }),
      this.database.client.mediaAsset.findFirst({
        where: {
          videoId,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          removedAt: null,
          mimeType: "video/mp4",
        },
        select: { id: true },
      }),
      this.database.client.mediaProcessingJob.findFirst({
        where: { videoId },
        orderBy: { generation: "desc" },
        select: { status: true, stage: true, progressPercent: true, errorCode: true },
      }),
    ]);
    if (!source && !canonical) {
      throw new QuickUploadError(
        "UPLOAD_NOT_COMPLETE",
        "The video is still uploading. Processing starts automatically after the upload reaches 100%.",
        409,
      );
    }
    if (!canonical) {
      return {
        videoId,
        status: "VALIDATING" as const,
        processing: processing ?? {
          status: "QUEUED" as const,
          stage: "QUEUED",
          progressPercent: 0,
          errorCode: null,
        },
      };
    }
    const updated = await this.database.client.video.update({
      where: { id: videoId },
      data: { status: video.status === "UPLOADING" || video.status === "VALIDATING" ? "DRAFT" : video.status },
      select: { id: true, status: true },
    });
    return { videoId: updated.id, status: updated.status, processing };
  }

  async processingStatus(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    const [canonical, processing] = await Promise.all([
      this.database.client.mediaAsset.findFirst({
        where: {
          videoId,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          removedAt: null,
          mimeType: "video/mp4",
        },
        select: { id: true },
      }),
      this.database.client.mediaProcessingJob.findFirst({
        where: { videoId },
        orderBy: { generation: "desc" },
        select: {
          generation: true,
          status: true,
          stage: true,
          progressPercent: true,
          errorCode: true,
          errorMessage: true,
          attempt: true,
          completedAt: true,
        },
      }),
    ]);
    return {
      videoId,
      ready: Boolean(canonical),
      videoStatus: video.status,
      processing,
    };
  }
''',
)

patch(
    "apps/api/src/creator/quick-upload.service.ts",
    '''          mediaAssets: {
            where: { kind: "SOURCE_VIDEO", removedAt: null },
            select: { id: true, status: true },
          },
''',
    '''          mediaAssets: {
            where: { kind: "SOURCE_VIDEO", removedAt: null },
            select: { id: true, status: true, mimeType: true },
          },
          mediaProcessingJobs: {
            orderBy: { generation: "desc" },
            take: 1,
            select: { status: true, errorCode: true },
          },
''',
)

patch(
    "apps/api/src/creator/quick-upload.service.ts",
    '''      if (
        !video.mediaAssets.some(
          (asset) => asset.status === "UPLOADED" || asset.status === "VALIDATED",
        )
      ) {
        throw new QuickUploadError(
          "UPLOAD_NOT_COMPLETE",
          "The video is still uploading. Publishing will be available when it reaches 100%.",
          409,
        );
      }
''',
    '''      const canonicalReady = video.mediaAssets.some(
        (asset) => asset.status === "VALIDATED" && asset.mimeType === "video/mp4",
      );
      if (!canonicalReady) {
        const processing = video.mediaProcessingJobs[0];
        if (processing?.status === "FAILED") {
          throw new QuickUploadError(
            "VIDEO_PROCESSING_FAILED",
            "AYIN could not prepare this video for playback. It is saved in Studio for review or retry.",
            409,
          );
        }
        throw new QuickUploadError(
          "VIDEO_PROCESSING",
          "AYIN is preparing this video for reliable playback. Publishing will be available when processing reaches Ready.",
          409,
        );
      }
''',
)

patch(
    "apps/api/src/creator/quick-upload.controller.ts",
    '''  Get,
''',
    '''  Get,
''',
) if False else None

# Add Get import to the controller.
patch(
    "apps/api/src/creator/quick-upload.controller.ts",
    '''  Controller,
  HttpException,
''',
    '''  Controller,
  Get,
  HttpException,
''',
)
patch(
    "apps/api/src/creator/quick-upload.controller.ts",
    '''  @Patch(":videoId")
  async updateDetails(
''',
    '''  @Get(":videoId/processing")
  async processingStatus(
    @Req() request: AuthenticatedRequest,
    @Param("videoId") videoIdRaw: string,
  ) {
    const videoId = this.videoId(videoIdRaw);
    return this.run(() => this.quickUpload.processingStatus(request.ayinAuth.accountId, videoId));
  }

  @Patch(":videoId")
  async updateDetails(
''',
)

patch(
    "apps/api/src/watch/watch.service.ts",
    '''const playableStates = ["UPLOADED", "VALIDATED"] as const;''',
    '''const playableStates = ["VALIDATED"] as const;''',
)
patch(
    "apps/api/src/discovery/discovery.service.ts",
    '''const playableAssetStates = ["UPLOADED", "VALIDATED"] as const;''',
    '''const playableAssetStates = ["VALIDATED"] as const;''',
)

patch(
    "apps/web/src/lib/video-inspection.ts",
    '''        "iPhone MOV opened successfully and can be uploaded. AYIN keeps the original source, so verify playback on Android/TV before broad publishing.",''',
    '''        "iPhone MOV opened successfully. AYIN will prepare an H.264/AAC MP4 after upload for reliable web, Android and TV playback.",''',
)
patch(
    "apps/web/src/lib/video-inspection.ts",
    '''      "Your browser cannot confirm the exact H.264/AAC profile. You can continue; AYIN will keep the original MP4 without transcoding.",''',
    '''      "Your browser cannot confirm the exact codec profile. You can continue; AYIN will prepare a canonical H.264/AAC MP4 after upload.",''',
)

print("Media processing product gates patched.")
