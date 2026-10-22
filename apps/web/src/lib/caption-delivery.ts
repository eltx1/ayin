const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const captionKey = new RegExp(`^captions/videos/(${UUID})/(${UUID})/track\\.vtt$`);

export function captionObjectKey(videoId: string, assetId: string): string | null {
  const key = `captions/videos/${videoId}/${assetId}/track.vtt`;
  return captionKey.test(key) ? key : null;
}

// Native tracks require the document's origin unless video CORS is changed.
// Keep MP4/HLS and IMA loading untouched; only owned caption objects use this route.
export function captionTrackPath(objectKey: string): string | null {
  const match = captionKey.exec(objectKey);
  return match?.[0] === objectKey ? `/api/captions/${match[1]}/${match[2]}` : null;
}
