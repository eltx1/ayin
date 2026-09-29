import type { TranslationKey } from "./i18n/translator";
import { navigationItems, type NavigationFlagState } from "./navigation";
import { canonicalPublicPath } from "./public-route-aliases";

export interface ProductNavigationItem {
  key: string;
  label: string;
  href: string;
  enabled: boolean;
  featureFlag: string | null;
}

export const browseNavigationKey = "ayin-browse-hub";

export const fallbackProductNavigation: ProductNavigationItem[] = navigationItems.map((item) => ({
  key: item.id,
  label: item.label,
  href: item.href,
  enabled: true,
  featureFlag: "featureFlag" in item ? item.featureFlag : null,
}));

export const navigationLabelKeys: Partial<Record<string, TranslationKey>> = {
  home: "nav.home",
  movies: "nav.movies",
  series: "nav.series",
  tv: "nav.tv",
  creators: "nav.creators",
  shorts: "nav.shorts",
  kids: "nav.kids",
  "my-ayin": "nav.myAyin",
  search: "nav.search",
  [browseNavigationKey]: "nav.browse",
};

export const browseDescriptionKeys: Partial<Record<string, TranslationKey>> = {
  movies: "browse.movies",
  series: "browse.series",
  creators: "browse.creators",
  shorts: "browse.clips",
  kids: "browse.kids",
};

export function isProductNavigationItem(value: unknown): value is ProductNavigationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.key === "string" &&
    item.key.length > 0 &&
    typeof item.label === "string" &&
    typeof item.href === "string" &&
    typeof item.enabled === "boolean" &&
    (item.featureFlag === null || typeof item.featureFlag === "string")
  );
}

function isInternalDestination(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return false;
  return !Array.from(href).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function buildViewerNavigation(
  flags: NavigationFlagState,
  items: readonly ProductNavigationItem[] = fallbackProductNavigation,
): { primary: ProductNavigationItem[]; browse: ProductNavigationItem[] } {
  const seenTargets = new Set<string>();
  const seenKeys = new Set<string>();
  const visible = items.flatMap((item) => {
    if (!isProductNavigationItem(item) || !item.enabled) return [];
    if (item.featureFlag && flags[item.featureFlag as keyof NavigationFlagState] !== true) {
      return [];
    }
    // Product controls describe internal routes, never protocol-relative destinations.
    if (!isInternalDestination(item.href)) return [];
    const [pathname, ...suffix] = item.href.split(/(?=[?#])/);
    const target = canonicalPublicPath(pathname ?? "/") + suffix.join("");
    if (seenTargets.has(target) || seenKeys.has(item.key)) return [];
    seenTargets.add(target);
    seenKeys.add(item.key);
    return [{ ...item, href: target }];
  });
  const core = new Set(["home", "search", "tv", "my-ayin"]);
  const primary = visible.filter((item) => core.has(item.key));
  const browse = visible.filter((item) => !core.has(item.key) && item.href !== "/browse");
  if (browse.length > 0) {
    const existing = visible.find((item) => item.href === "/browse");
    const hub = existing ?? {
      key: browseNavigationKey,
      label: "Browse",
      href: "/browse",
      enabled: true,
      featureFlag: null,
    };
    const insertion = Math.max(0, primary.findIndex((item) => item.key === "home") + 1);
    if (!primary.some((item) => item.href === "/browse")) primary.splice(insertion, 0, hub);
  }
  return { primary, browse };
}
