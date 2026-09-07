export const MEDIA_ARCHITECTURE_VERSION = 2 as const;

export const MEDIA_VIDEO_CODEC = "H264" as const;
export const MEDIA_AUDIO_CODEC = "AAC" as const;
export const MEDIA_PIXEL_FORMAT = "yuv420p" as const;

export const MEDIA_FALLBACK_PROFILE = {
  protocol: "PROGRESSIVE",
  container: "MP4",
  videoCodec: MEDIA_VIDEO_CODEC,
  audioCodec: MEDIA_AUDIO_CODEC,
  pixelFormat: MEDIA_PIXEL_FORMAT,
} as const;

export const MEDIA_HLS_PROFILE = {
  protocol: "HLS",
  container: "MPEG_TS",
  videoCodec: MEDIA_VIDEO_CODEC,
  audioCodec: MEDIA_AUDIO_CODEC,
  pixelFormat: MEDIA_PIXEL_FORMAT,
} as const;

export const MEDIA_RENDITION_LADDER = [
  {
    identity: "360p",
    targetHeight: 360,
    videoBitrateKbps: 800,
    audioBitrateKbps: 96,
  },
  {
    identity: "480p",
    targetHeight: 480,
    videoBitrateKbps: 1_400,
    audioBitrateKbps: 128,
  },
  {
    identity: "720p",
    targetHeight: 720,
    videoBitrateKbps: 2_800,
    audioBitrateKbps: 128,
  },
  {
    identity: "1080p",
    targetHeight: 1_080,
    videoBitrateKbps: 5_000,
    audioBitrateKbps: 160,
  },
] as const;

export type MediaRenditionIdentity = (typeof MEDIA_RENDITION_LADDER)[number]["identity"];
export type MediaPlaybackOutputStatus =
  | "PLANNED"
  | "PROCESSING"
  | "UPLOADING"
  | "VERIFYING"
  | "READY"
  | "FAILED"
  | "REMOVED";
export type MediaPlaybackGenerationStatus = "BUILDING" | "READY" | "FAILED" | "SUPERSEDED";

export interface MediaSourceDimensions {
  width: number;
  height: number;
}

export interface PlannedMediaRendition {
  identity: MediaRenditionIdentity;
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  videoCodec: typeof MEDIA_VIDEO_CODEC;
  audioCodec: typeof MEDIA_AUDIO_CODEC;
  pixelFormat: typeof MEDIA_PIXEL_FORMAT;
  protocol: typeof MEDIA_HLS_PROFILE.protocol;
  container: typeof MEDIA_HLS_PROFILE.container;
}

export interface MediaGenerationNamespace {
  channelId: string;
  videoId: string;
  generation: number;
}

export interface MediaPlaybackGenerationIdentity extends MediaGenerationNamespace {
  processingVersion: typeof MEDIA_ARCHITECTURE_VERSION;
  sourceMediaAssetId?: string | null | undefined;
}

export interface MediaPlaybackReadiness {
  fallbackStatus: MediaPlaybackOutputStatus;
  hlsMasterStatus: MediaPlaybackOutputStatus;
  renditions: ReadonlyArray<{ status: MediaPlaybackOutputStatus }>;
}

export function planAdaptiveRenditions(
  source: MediaSourceDimensions,
): readonly PlannedMediaRendition[] {
  assertSourceDimensions(source);

  return MEDIA_RENDITION_LADDER.filter((entry) => entry.targetHeight <= source.height).map(
    (entry) => ({
      identity: entry.identity,
      width: scaledEvenWidth(source, entry.targetHeight),
      height: entry.targetHeight,
      videoBitrateKbps: entry.videoBitrateKbps,
      audioBitrateKbps: entry.audioBitrateKbps,
      videoCodec: MEDIA_HLS_PROFILE.videoCodec,
      audioCodec: MEDIA_HLS_PROFILE.audioCodec,
      pixelFormat: MEDIA_HLS_PROFILE.pixelFormat,
      protocol: MEDIA_HLS_PROFILE.protocol,
      container: MEDIA_HLS_PROFILE.container,
    }),
  );
}

export function canonicalFallbackObjectKey(namespace: MediaGenerationNamespace): string {
  return `${generationBase(namespace)}.mp4`;
}

export function hlsMasterObjectKey(namespace: MediaGenerationNamespace): string {
  return `${generationBase(namespace)}/hls/master.m3u8`;
}

export function hlsRenditionPlaylistObjectKey(
  namespace: MediaGenerationNamespace,
  identity: MediaRenditionIdentity,
): string {
  return `${generationBase(namespace)}/hls/${identity}/index.m3u8`;
}

export function hlsRenditionSegmentPrefix(
  namespace: MediaGenerationNamespace,
  identity: MediaRenditionIdentity,
): string {
  return `${generationBase(namespace)}/hls/${identity}/segment-`;
}

export function hlsRenditionSegmentObjectKey(
  namespace: MediaGenerationNamespace,
  identity: MediaRenditionIdentity,
  sequence: number,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 999_999) {
    throw new Error("HLS segment sequence must be an integer between 0 and 999999.");
  }
  return `${hlsRenditionSegmentPrefix(namespace, identity)}${String(sequence).padStart(6, "0")}.ts`;
}

export function canMarkAdaptiveGenerationReady(readiness: MediaPlaybackReadiness): boolean {
  return (
    readiness.fallbackStatus === "READY" &&
    readiness.hlsMasterStatus === "READY" &&
    readiness.renditions.length > 0 &&
    readiness.renditions.every((rendition) => rendition.status === "READY")
  );
}

function generationBase(namespace: MediaGenerationNamespace): string {
  assertNamespaceSegment(namespace.channelId, "channelId");
  assertNamespaceSegment(namespace.videoId, "videoId");
  if (!Number.isSafeInteger(namespace.generation) || namespace.generation <= 0) {
    throw new Error("Media processing generation must be a positive integer.");
  }
  return `channels/${namespace.channelId}/videos/${namespace.videoId}/playback/g${namespace.generation}`;
}

function scaledEvenWidth(source: MediaSourceDimensions, targetHeight: number): number {
  const scaledWidth = Math.floor((source.width * targetHeight) / source.height);
  const evenWidth = scaledWidth - (scaledWidth % 2);
  return Math.max(2, evenWidth);
}

function assertSourceDimensions(source: MediaSourceDimensions): void {
  if (
    !Number.isSafeInteger(source.width) ||
    !Number.isSafeInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new Error("Media source width and height must be positive integers.");
  }
}

function assertNamespaceSegment(value: string, label: string): void {
  if (!value || value.includes("/") || value === "." || value === "..") {
    throw new Error(`${label} must be a non-empty R2 namespace segment.`);
  }
}
