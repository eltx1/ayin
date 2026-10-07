import { apiBaseUrl } from "./api";
import { readBoundedAccountJson } from "./account-scope";
import { isClipCursor, parseClipsPage, type ClipsPage } from "./clips";
import type { SearchAudience } from "./search-request";

export const clipsPageSize = 20;
export class ClipsReadError extends Error {
  constructor(readonly status: number) {
    super("Clips could not be verified for the current viewer.");
  }
}

export async function readClips(
  cursor: string | undefined,
  audience: SearchAudience,
  signal: AbortSignal,
): Promise<ClipsPage> {
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!audience.isCurrent()) throw new ClipsReadError(409);
  };
  assertCurrent();
  if (cursor !== undefined && !isClipCursor(cursor)) throw new ClipsReadError(400);
  const query = new URLSearchParams({ take: String(clipsPageSize) });
  if (cursor) query.set("cursor", cursor);
  if (audience.identity) query.set("expectedProfileId", audience.identity.profile.id);
  const response = await fetch(`${apiBaseUrl}/public/clips?${query}`, {
    credentials: "include",
    cache: "no-store",
    redirect: "error",
    signal,
    headers: audience.identity ? { "x-ayin-expected-account": audience.identity.account.id } : {},
  });
  assertCurrent();
  if (!response.ok) throw new ClipsReadError(response.status);
  const body = await readBoundedAccountJson(response, signal, 512 * 1024);
  assertCurrent();
  return parseClipsPage(body);
}
