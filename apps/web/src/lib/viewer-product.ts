export interface ResolvedHero {
  entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST";
  entityId: string;
  title: string;
  description: string | null;
  href: string;
}

const heroPaths: Record<ResolvedHero["entityType"], RegExp> = {
  VIDEO: /^\/watch\/[^/?#\\\s]+(?:\?kids=1)?$/,
  CREATOR_TV: /^\/c\/[^/?#\\\s]+\/tv$/,
  CHANNEL: /^\/c\/[^/?#\\\s]+$/,
  PLAYLIST: /^\/c\/[^/?#\\\s]+\/playlists\/[^/?#\\\s]+$/,
};

// The server owns content eligibility. This only checks the public presentation
// contract and prevents malformed destinations from becoming actionable links.
export function parseResolvedHero(value: unknown): ResolvedHero | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new Error("Invalid featured content");
  const hero = value as Record<string, unknown>;
  if (
    typeof hero.entityType !== "string" ||
    !Object.hasOwn(heroPaths, hero.entityType) ||
    typeof hero.entityId !== "string" ||
    !hero.entityId ||
    typeof hero.title !== "string" ||
    !hero.title.trim() ||
    !(hero.description === null || typeof hero.description === "string") ||
    typeof hero.href !== "string" ||
    !heroPaths[hero.entityType as ResolvedHero["entityType"]].test(hero.href)
  )
    throw new Error("Invalid featured content");
  return hero as unknown as ResolvedHero;
}
