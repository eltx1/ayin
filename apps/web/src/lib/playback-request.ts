import { apiBaseUrl } from "./api";
import { readBoundedAccountJson } from "./account-scope";
import type { PublicPlaybackResponse } from "./ayin-player";
import type { SearchAudience } from "./search-request";

export class PlaybackReadError extends Error {
  constructor(
    readonly status: number,
    readonly identityInvalid = false,
  ) {
    super("Playback could not be verified for the current viewer.");
  }
}

export async function readPlayback(
  params: { slug: string; locale: "en" | "ar"; explicitKids: boolean },
  audience: SearchAudience,
  signal: AbortSignal,
): Promise<PublicPlaybackResponse> {
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!audience.isCurrent()) throw new PlaybackReadError(409);
  };
  assertCurrent();
  const query = new URLSearchParams({ locale: params.locale });
  if (params.explicitKids) query.set("kids", "1");
  if (audience.identity) query.set("expectedProfileId", audience.identity.profile.id);
  const response = await fetch(
    `${apiBaseUrl}/public/videos/${encodeURIComponent(params.slug)}/playback?${query}`,
    {
      cache: "no-store",
      credentials: "include",
      redirect: "error",
      signal,
      headers: audience.identity ? { "x-ayin-expected-account": audience.identity.account.id } : {},
    },
  );
  assertCurrent();
  if (!response.ok) {
    // Status 409 also represents ordinary unavailable media. Only the server's
    // exact account/profile conflict codes revoke a still-current Viewer lease;
    // local contract errors never receive this classification.
    let identityInvalid = response.status === 401;
    if (response.status === 409) {
      try {
        const failure = await readBoundedAccountJson(response, signal, 16 * 1024);
        assertCurrent();
        const code = object(object(failure).error).code;
        identityInvalid = code === "ACCOUNT_CHANGED" || code === "PLAYBACK_VIEWER_CHANGED";
      } catch {
        // Preserve the HTTP failure for malformed/oversized error bodies, but
        // never swallow cancellation or an audience revoked during body reads.
        assertCurrent();
      }
    }
    throw new PlaybackReadError(response.status, identityInvalid);
  }
  const body = await readBoundedAccountJson(response, signal, 512 * 1024);
  assertCurrent();
  const result = object(body);
  const viewer = object(result.viewer);
  const video = object(result.video);
  const detail = object(result.detail);
  const policy = object(result.playerPolicy);
  if (
    typeof viewer.isKids !== "boolean" ||
    (params.explicitKids && !viewer.isKids) ||
    video.slug !== params.slug ||
    !text(video.id) ||
    !text(video.title) ||
    !text(object(video.source).objectKey) ||
    !text(object(video.channel).name) ||
    !text(object(video.channel).handle) ||
    !Array.isArray(video.captions) ||
    !Array.isArray(video.chapters) ||
    !Array.isArray(detail.related) ||
    !["CREATOR_VIDEO", "SERIES_EPISODE"].includes(String(detail.contentType)) ||
    typeof object(detail.commentsSlot).enabled !== "boolean" ||
    !Number.isFinite(policy.progressSaveIntervalMs) ||
    !Number.isFinite(policy.completionThresholdPercent)
  )
    throw new PlaybackReadError(0);
  for (const raw of video.captions) {
    const track = object(raw);
    if (
      !text(track.id) ||
      !text(track.objectKey) ||
      !text(track.label) ||
      !text(track.language) ||
      !["CAPTIONS", "SUBTITLES"].includes(String(track.kind))
    )
      throw new PlaybackReadError(0);
  }
  for (const raw of video.chapters) {
    const chapter = object(raw);
    if (!text(chapter.id) || !text(chapter.title) || !Number.isFinite(chapter.startMs))
      throw new PlaybackReadError(0);
  }
  for (const raw of detail.related) {
    const item = object(raw);
    if (
      !text(item.id) ||
      !text(item.title) ||
      typeof item.href !== "string" ||
      !/^\/watch\/[^/?#\\\s%]+(?:\?kids=1)?$/.test(item.href) ||
      (viewer.isKids && !item.href.endsWith("?kids=1"))
    )
      throw new PlaybackReadError(0);
  }
  if (video.adaptiveSource !== null && !text(object(video.adaptiveSource).objectKey))
    throw new PlaybackReadError(0);
  if (detail.contentType === "SERIES_EPISODE" && !viewer.isKids) {
    const series = object(detail.seriesContext);
    const catalog = object(series.series);
    const season = object(series.season);
    const episode = object(series.episode);
    if (
      !text(catalog.slug) ||
      !text(catalog.title) ||
      !Number.isFinite(season.seasonNumber) ||
      !text(episode.title) ||
      !Number.isFinite(episode.episodeNumber)
    )
      throw new PlaybackReadError(0);
    if (series.nextEpisode !== null) {
      const next = object(series.nextEpisode);
      if (
        !text(next.title) ||
        !text(object(next.video).slug) ||
        !Number.isFinite(next.seasonNumber) ||
        !Number.isFinite(next.episodeNumber)
      )
        throw new PlaybackReadError(0);
    }
  }
  return body as PublicPlaybackResponse;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlaybackReadError(0);
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
