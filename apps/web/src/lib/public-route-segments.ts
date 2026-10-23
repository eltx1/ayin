interface PublicPlaylistRouteSegments {
  handle: string;
  slug: string;
}

const handlePattern = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]{0,78}[\p{L}\p{N}])?$/u;
const playlistSlugPattern = /^[\p{L}\p{N}-]+$/u;

function decodeSegment(value: string, maxLength: number, pattern: RegExp): string | null {
  if (value.length > maxLength * 12) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= maxLength && pattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Next may provide decoded params, while a locale rewrite can retain percent escapes.
 * Decode once at this request boundary; percent signs are not valid stored identifiers,
 * so a still-encoded value is rejected instead of being recursively decoded.
 */
export function decodePublicPlaylistRouteSegments(
  segments: PublicPlaylistRouteSegments,
): PublicPlaylistRouteSegments | null {
  const handle = decodeSegment(segments.handle, 80, handlePattern);
  const slug = decodeSegment(segments.slug, 160, playlistSlugPattern);
  return handle === null || slug === null ? null : { handle, slug };
}
