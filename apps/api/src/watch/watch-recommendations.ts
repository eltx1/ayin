interface Candidate {
  id: string;
  contentType: string;
  channel: { id: string };
}

/** Input has already passed publication, playback, territory and viewer policy. */
export function selectWatchRecommendations<T extends Candidate>(
  candidates: readonly T[],
  current: Candidate,
): T[] {
  const seen = new Set([current.id]);
  const pending = candidates
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.contentType === current.contentType) -
        Number(a.contentType === current.contentType),
    );
  const counts = new Map<string, number>();
  const result: T[] = [];
  while (pending.length && result.length < 12) {
    // Keep relevance/recency order while giving other available creators room.
    const diverse = pending.findIndex((item) => (counts.get(item.channel.id) ?? 0) < 2);
    const [item] = pending.splice(diverse === -1 ? 0 : diverse, 1);
    if (!item) break;
    result.push(item);
    counts.set(item.channel.id, (counts.get(item.channel.id) ?? 0) + 1);
  }
  return result;
}
