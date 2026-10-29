import {
  buildMetadataPayload,
  metadataDraftFromApi,
  type MetadataDraft,
} from "@/components/upload/video-metadata-fields";
import type { StudioVideo } from "./studio";
import type { ContentTranslationKey } from "./i18n/content-copy";
import type { QuickProcessingStatus } from "./quick-upload";

export function contentReadiness(result: QuickProcessingStatus) {
  if (result.ready) return "ready";
  if (result.processing?.status === "FAILED") return "failed";
  if (result.processing?.status === "CANCELLED") return "cancelled";
  if (
    result.videoStatus === "UPLOADING" &&
    (!result.processing || result.processing.status === "INGESTING")
  )
    return "incomplete";
  return "waiting";
}

export type ContentDraft = Pick<
  StudioVideo,
  "title" | "description" | "visibility" | "commentsEnabled" | "tvIncluded"
> & { metadata: MetadataDraft };

export function contentDraft(video: StudioVideo): ContentDraft {
  return {
    title: video.title,
    description: video.description,
    visibility: video.visibility,
    commentsEnabled: video.commentsEnabled,
    tvIncluded: video.tvIncluded,
    metadata: metadataDraftFromApi(video.metadata as Record<string, unknown> | null),
  };
}

export function contentPayload(draft: ContentDraft) {
  if (!draft.title.trim() || draft.title.trim().length > 200) throw new Error("INVALID_TITLE");
  const { metadata, ...basic } = draft;
  return {
    ...basic,
    title: basic.title.trim(),
    ...buildMetadataPayload(metadata, { includeEmpty: true, includeRights: false }),
  };
}

export const contentStatuses = {
  PUBLISHED: "content.published",
  DRAFT: "content.draft",
  UPLOADING: "content.uploading",
  VALIDATING: "content.validating",
  SCHEDULED: "content.scheduled",
  REMOVED: "content.removed",
} as const satisfies Record<StudioVideo["status"], ContentTranslationKey>;
export const contentVisibility = {
  PUBLIC: "content.public",
  UNLISTED: "content.unlisted",
  PRIVATE: "content.private",
} as const satisfies Record<StudioVideo["visibility"], ContentTranslationKey>;
