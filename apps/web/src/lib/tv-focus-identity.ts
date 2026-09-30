export interface TvFocusIdentity {
  legacyId: string | null;
  navigationId: string;
  persistenceId: string | null;
}

function namedKey(rawId: string, occurrence: number) {
  return `named:${encodeURIComponent(rawId)}:occurrence:${occurrence}`;
}

export function buildTvFocusIdentities(
  rawIds: readonly (string | undefined)[],
): TvFocusIdentity[] {
  const totals = new Map<string, number>();
  for (const rawId of rawIds) {
    if (!rawId) continue;
    totals.set(rawId, (totals.get(rawId) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return rawIds.map((rawId, index) => {
    if (!rawId) {
      return {
        legacyId: null,
        navigationId: `auto:${index}`,
        persistenceId: null,
      };
    }

    const occurrence = (seen.get(rawId) ?? 0) + 1;
    seen.set(rawId, occurrence);
    return {
      legacyId: rawId,
      navigationId: namedKey(rawId, occurrence),
      persistenceId:
        (totals.get(rawId) ?? 0) > 1
          ? namedKey(rawId, occurrence)
          : `named:${encodeURIComponent(rawId)}`,
    };
  });
}

export function resolvePersistedTvFocusIndex(
  identities: readonly TvFocusIdentity[],
  saved: string,
): number {
  const exact = identities.findIndex((identity) => identity.persistenceId === saved);
  if (exact >= 0) return exact;

  // Compatibility with focus values written before duplicate identities were namespaced.
  return identities.findIndex((identity) => identity.legacyId === saved);
}
