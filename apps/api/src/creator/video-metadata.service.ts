import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  hasCompanionMetadata,
  metadataData,
  type VideoMetadataInput,
  validateMetadataDuration,
} from "./video-metadata.validation.js";

const CREATOR_RIGHTS_NOTE_SEPARATOR = "\n\nCreator note: ";

export class VideoMetadataError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "VideoMetadataError";
  }
}

@Injectable()
export class VideoMetadataService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async applyForOwner(accountId: string, videoId: string, input: VideoMetadataInput) {
    const video = await this.database.client.video.findFirst({
      where: { id: videoId, channel: { members: { some: { accountId, role: "OWNER" } } } },
      select: { id: true, durationMs: true, status: true },
    });
    if (!video) {
      throw new VideoMetadataError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
    }
    if (video.status === "REMOVED") {
      throw new VideoMetadataError("VIDEO_REMOVED", "This video can no longer be edited.", 409);
    }
    return this.apply(video.id, video.durationMs, input);
  }

  async applyForStudio(accountId: string, videoId: string, input: VideoMetadataInput) {
    const video = await this.database.client.video.findFirst({
      where: {
        id: videoId,
        channel: {
          members: { some: { accountId, role: { in: ["OWNER", "ADMIN", "EDITOR"] } } },
        },
      },
      select: { id: true, durationMs: true, status: true },
    });
    if (!video) {
      throw new VideoMetadataError(
        "VIDEO_NOT_FOUND",
        "This video is not available in your Studio.",
        404,
      );
    }
    if (video.status === "REMOVED") {
      throw new VideoMetadataError("VIDEO_REMOVED", "This video can no longer be edited.", 409);
    }
    return this.apply(video.id, video.durationMs, input);
  }

  async updateRightsForOwner(accountId: string, videoId: string, input: VideoMetadataInput) {
    if (input.rightsBasis === undefined && input.rightsNote === undefined) return;
    const video = await this.database.client.video.findFirst({
      where: { id: videoId, channel: { members: { some: { accountId, role: "OWNER" } } } },
      select: { id: true },
    });
    if (!video) {
      throw new VideoMetadataError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
    }
    const declaration = await this.database.client.contentRightsDeclaration.findFirst({
      where: { videoId, status: "CONFIRMED" },
      orderBy: { version: "desc" },
      select: { id: true, statement: true },
    });
    if (!declaration) return;
    await this.database.client.contentRightsDeclaration.update({
      where: { id: declaration.id },
      data: {
        ...(input.rightsBasis !== undefined ? { basis: input.rightsBasis } : {}),
        ...(input.rightsNote !== undefined
          ? { statement: withCreatorRightsNote(declaration.statement, input.rightsNote) }
          : {}),
      },
    });
  }

  async readOne(videoId: string) {
    const [video, metadata, rights] = await Promise.all([
      this.database.client.video.findUnique({
        where: { id: videoId },
        select: { id: true, contentType: true },
      }),
      this.database.client.videoCreatorMetadata.findUnique({ where: { videoId } }),
      this.database.client.contentRightsDeclaration.findFirst({
        where: { videoId, status: "CONFIRMED" },
        orderBy: { version: "desc" },
        select: { basis: true, statement: true },
      }),
    ]);
    if (!video) return null;
    return {
      contentType: video.contentType,
      tags: metadata?.tags ?? [],
      category: metadata?.category ?? null,
      primaryLanguage: metadata?.primaryLanguage ?? null,
      recordingDate: metadata?.recordingDate?.toISOString().slice(0, 10) ?? null,
      seriesTitle: metadata?.seriesTitle ?? null,
      seasonNumber: metadata?.seasonNumber ?? null,
      episodeNumber: metadata?.episodeNumber ?? null,
      maturityLevel: metadata?.maturityLevel ?? null,
      geoAvailabilityMode: metadata?.geoAvailabilityMode ?? null,
      geoCountries: metadata?.geoCountries ?? [],
      chapters: metadata?.chapters ?? [],
      adBreakPreference: metadata?.adBreakPreference ?? null,
      adBreakOffsetsSeconds: metadata?.adBreakOffsetsSeconds ?? [],
      rightsBasis: rights?.basis ?? null,
      rightsNote: creatorRightsNote(rights?.statement),
    };
  }

  async readMany(videoIds: string[]) {
    const ids = [...new Set(videoIds)];
    if (!ids.length) return new Map();
    const [videos, metadata, rights] = await Promise.all([
      this.database.client.video.findMany({
        where: { id: { in: ids } },
        select: { id: true, contentType: true },
      }),
      this.database.client.videoCreatorMetadata.findMany({ where: { videoId: { in: ids } } }),
      this.database.client.contentRightsDeclaration.findMany({
        where: { videoId: { in: ids }, status: "CONFIRMED" },
        orderBy: [{ videoId: "asc" }, { version: "desc" }],
        select: { videoId: true, basis: true, statement: true, version: true },
      }),
    ]);
    const metadataByVideo = new Map(metadata.map((item) => [item.videoId, item]));
    const rightsByVideo = new Map<string, (typeof rights)[number]>();
    for (const declaration of rights) {
      if (!rightsByVideo.has(declaration.videoId)) rightsByVideo.set(declaration.videoId, declaration);
    }
    return new Map(
      videos.map((video) => {
        const item = metadataByVideo.get(video.id);
        const declaration = rightsByVideo.get(video.id);
        return [
          video.id,
          {
            contentType: video.contentType,
            tags: item?.tags ?? [],
            category: item?.category ?? null,
            primaryLanguage: item?.primaryLanguage ?? null,
            recordingDate: item?.recordingDate?.toISOString().slice(0, 10) ?? null,
            seriesTitle: item?.seriesTitle ?? null,
            seasonNumber: item?.seasonNumber ?? null,
            episodeNumber: item?.episodeNumber ?? null,
            maturityLevel: item?.maturityLevel ?? null,
            geoAvailabilityMode: item?.geoAvailabilityMode ?? null,
            geoCountries: item?.geoCountries ?? [],
            chapters: item?.chapters ?? [],
            adBreakPreference: item?.adBreakPreference ?? null,
            adBreakOffsetsSeconds: item?.adBreakOffsetsSeconds ?? [],
            rightsBasis: declaration?.basis ?? null,
            rightsNote: creatorRightsNote(declaration?.statement),
          },
        ] as const;
      }),
    );
  }

  private async apply(videoId: string, durationMs: number | null, input: VideoMetadataInput) {
    try {
      validateMetadataDuration(input, durationMs);
    } catch (error) {
      if (error instanceof Error && error.message === "CHAPTER_OUTSIDE_VIDEO") {
        throw new VideoMetadataError(
          "CHAPTER_OUTSIDE_VIDEO",
          "Every chapter must start before the video ends.",
        );
      }
      if (error instanceof Error && error.message === "AD_BREAK_OUTSIDE_VIDEO") {
        throw new VideoMetadataError(
          "AD_BREAK_OUTSIDE_VIDEO",
          "Every custom ad break must occur before the video ends.",
        );
      }
      throw error;
    }

    if (input.contentType === undefined && !hasCompanionMetadata(input)) {
      return this.readOne(videoId);
    }

    await this.database.client.$transaction(async (tx) => {
      if (input.contentType !== undefined) {
        await tx.video.update({ where: { id: videoId }, data: { contentType: input.contentType } });
      }
      if (hasCompanionMetadata(input)) {
        const data = metadataData(input);
        await tx.videoCreatorMetadata.upsert({
          where: { videoId },
          create: { videoId, ...data },
          update: data,
        });
      }
    });
    return this.readOne(videoId);
  }
}

function creatorRightsNote(statement: string | null | undefined): string | null {
  if (!statement) return null;
  const index = statement.indexOf(CREATOR_RIGHTS_NOTE_SEPARATOR);
  if (index < 0) return null;
  return statement.slice(index + CREATOR_RIGHTS_NOTE_SEPARATOR.length).trim() || null;
}

function withCreatorRightsNote(statement: string, note: string | null): string {
  const index = statement.indexOf(CREATOR_RIGHTS_NOTE_SEPARATOR);
  const attestation = (index < 0 ? statement : statement.slice(0, index)).trim();
  return note?.trim()
    ? `${attestation}${CREATOR_RIGHTS_NOTE_SEPARATOR}${note.trim()}`
    : attestation;
}
