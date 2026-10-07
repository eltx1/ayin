export interface ClipAsset {
  kind: "SOURCE_VIDEO" | "THUMBNAIL";
  r2ObjectKey: string;
}

export interface ClipItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMs: number | null;
  channel: { id: string; handle: string; name: string };
  mediaAssets: ClipAsset[];
  _count: { reactions: number };
}

export interface ClipsPage {
  viewer: { isKids: boolean };
  enabled: boolean;
  items: ClipItem[];
  nextCursor: string | null;
  autoplayEnabled: boolean;
  adPolicy: { enabled: boolean; minimumOrganicClips: number };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClipCursor(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  return value;
}

function parseItem(value: unknown): ClipItem {
  const item = record(value);
  const channel = record(item.channel);
  const counts = record(item._count);
  if (!isClipCursor(item.id) || !isClipCursor(channel.id)) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  if (item.description !== null && typeof item.description !== "string") {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  if (
    item.durationMs !== null &&
    (typeof item.durationMs !== "number" ||
      !Number.isInteger(item.durationMs) ||
      item.durationMs <= 0)
  ) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  if (!Array.isArray(item.mediaAssets) || item.mediaAssets.length > 16) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  const mediaAssets: ClipAsset[] = item.mediaAssets.map((assetValue) => {
    const asset = record(assetValue);
    const kind = asset.kind;
    if (kind !== "SOURCE_VIDEO" && kind !== "THUMBNAIL") {
      throw new Error("INVALID_CLIPS_RESPONSE");
    }
    return {
      kind,
      r2ObjectKey: nonEmptyString(asset.r2ObjectKey, 1_024),
    };
  });
  if (!mediaAssets.some((asset) => asset.kind === "SOURCE_VIDEO")) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  return {
    id: item.id,
    slug: nonEmptyString(item.slug, 160),
    title: nonEmptyString(item.title, 200),
    description: item.description,
    durationMs: item.durationMs,
    channel: {
      id: channel.id,
      handle: nonEmptyString(channel.handle, 80),
      name: nonEmptyString(channel.name, 120),
    },
    mediaAssets,
    _count: { reactions: count(counts.reactions) },
  };
}

export function parseClipsPage(value: unknown): ClipsPage {
  const page = record(value);
  const adPolicy = record(page.adPolicy);
  const viewer = record(page.viewer);
  if (
    typeof viewer.isKids !== "boolean" ||
    (viewer.isKids && adPolicy.enabled !== false) ||
    typeof page.enabled !== "boolean" ||
    typeof page.autoplayEnabled !== "boolean" ||
    !Array.isArray(page.items) ||
    page.items.length > 30
  ) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  if (page.nextCursor !== null && !isClipCursor(page.nextCursor)) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  const minimumOrganicClips = count(adPolicy.minimumOrganicClips);
  if (
    typeof adPolicy.enabled !== "boolean" ||
    minimumOrganicClips < 2 ||
    minimumOrganicClips > 1_000
  ) {
    throw new Error("INVALID_CLIPS_RESPONSE");
  }
  return {
    viewer: { isKids: viewer.isKids },
    enabled: page.enabled,
    items: page.items.map(parseItem),
    nextCursor: page.nextCursor,
    autoplayEnabled: page.autoplayEnabled,
    adPolicy: { enabled: adPolicy.enabled, minimumOrganicClips },
  };
}

export function mergeClipItems(
  current: readonly ClipItem[],
  incoming: readonly ClipItem[],
): ClipItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

// A paused offscreen element is ordinary feed behavior, not user intent. Keep
// the restored active Clip's pause until navigation selects another Clip, then
// let normal autoplay policy handle all subsequent activations (including Back).
export function createClipsAutoplayGate(restored?: {
  activeId: string | null;
  playback: Record<string, { paused: boolean }>;
}) {
  let pausedClipId =
    restored?.activeId && restored.playback[restored.activeId]?.paused ? restored.activeId : null;
  return (videoId: string, enabled: boolean, reducedMotion: boolean): boolean => {
    if (videoId !== pausedClipId) pausedClipId = null;
    return enabled && !reducedMotion && videoId !== pausedClipId;
  };
}

export interface ClipPlaybackPosition {
  positionMs: number | undefined;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
}

export type RegisterClipPositionAuthority = (
  videoId: string,
  isPositionAuthoritative: () => boolean,
) => () => void;

export function captureClipPlaybackPosition(
  media: Pick<
    HTMLVideoElement,
    "readyState" | "currentTime" | "paused" | "muted" | "volume" | "playbackRate"
  >,
  positionAuthoritative: boolean,
  previousPositionMs?: number,
): ClipPlaybackPosition {
  return {
    // Metadata at zero does not establish a viewing position while the saved
    // progress read is still pending. Its provenance comes from useWatchProgress.
    positionMs:
      positionAuthoritative && media.readyState >= 1 && Number.isFinite(media.currentTime)
        ? Math.max(0, Math.floor(media.currentTime * 1000))
        : previousPositionMs,
    paused: media.paused,
    muted: media.muted,
    volume: media.volume,
    playbackRate: media.playbackRate,
  };
}
