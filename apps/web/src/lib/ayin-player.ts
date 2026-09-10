export interface AyinCaptionTrack {
  id: string;
  src: string;
  label: string;
  language: string;
  kind: "CAPTIONS" | "SUBTITLES";
  default?: boolean | undefined;
}

export interface AyinPlayerChapter {
  id: string;
  title: string;
  startMs: number;
}

export interface AyinPlayerAdModeState {
  active: boolean;
  controlsLocked?: boolean | undefined;
  label?: string | undefined;
}

export interface AyinPlayerUpNext {
  title: string;
  detail?: string | undefined;
}

export interface AyinPlayerRenditionMetadata {
  label: string;
  height?: number | null | undefined;
  bitrateKbps?: number | null | undefined;
}

export type AyinPlayerAnalyticsEvent =
  | { type: "play"; videoId: string }
  | { type: "pause"; videoId: string; positionMs: number }
  | { type: "seek"; videoId: string; positionMs: number }
  | { type: "buffer"; videoId: string; positionMs: number }
  | { type: "progress_checkpoint"; videoId: string; positionMs: number }
  | { type: "complete"; videoId: string }
  | { type: "next"; videoId: string }
  | { type: "error"; videoId: string; message: string }
  | { type: "ad_mode"; videoId: string; active: boolean }
  | { type: "playback_protocol"; videoId: string; protocol: "HLS" | "MP4" }
  | {
      type: "quality_switch";
      videoId: string;
      selection: "AUTO" | "MANUAL";
      automatic: boolean;
      rendition: AyinPlayerRenditionMetadata | null;
    }
  | {
      type: "hls_fatal";
      videoId: string;
      reason: "NETWORK" | "MEDIA" | "MANIFEST" | "STARTUP" | "UNSUPPORTED" | "OTHER";
    }
  | {
      type: "fallback_mp4";
      videoId: string;
      reason: "NETWORK" | "MEDIA" | "MANIFEST" | "STARTUP" | "UNSUPPORTED" | "OTHER";
    };

export interface AyinPlayerAnalytics {
  emit(event: AyinPlayerAnalyticsEvent): void;
}

export const noopPlayerAnalytics: AyinPlayerAnalytics = { emit: () => undefined };

export interface PublicPlaybackResponse {
  video: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    durationMs: number | null;
    publishedAt: string | null;
    channel: { id: string; handle: string; name: string };
    source: { objectKey: string; mimeType: string };
    adaptiveSource: {
      objectKey: string;
      mimeType: "application/vnd.apple.mpegurl";
      renditions: Array<{
        id: string;
        label: string;
        width: number;
        height: number;
        bitrateKbps: number;
      }>;
    } | null;
    captions: Array<{
      id: string;
      objectKey: string;
      mimeType: string;
      label: string;
      language: string;
      kind: "CAPTIONS" | "SUBTITLES";
      default: boolean;
    }>;
    chapters: AyinPlayerChapter[];
  };
  detail: {
    contentType: "CREATOR_VIDEO";
    saveHook: { action: "WATCH_LATER"; available: boolean };
    commentsSlot: { reserved: boolean; enabled: boolean };
    externalAdPlacementKeys: string[];
    related: Array<{ id: string; title: string; href: string; durationMs: number | null }>;
  };
  playerPolicy: {
    progressSaveIntervalMs: number;
    completionThresholdPercent: number;
  };
}
