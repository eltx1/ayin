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

export function buildViewerNavigation(
  flags: NavigationFlagState,
  items: readonly ProductNavigationItem[] = fallbackProductNavigation,
): { primary: ProductNavigationItem[]; browse: ProductNavigationItem[] } {
  const seen = new Set<string>();
  const visible = items.flatMap((item) => {
    if (!item.enabled) return [];
    if (item.featureFlag && flags[item.featureFlag as keyof NavigationFlagState] !== true) {
      return [];
    }
    // Preserve the configured destination/query while normalizing legacy aliases.
    const [pathname, ...suffix] = item.href.split(/(?=[?#])/);
    const target = canonicalPublicPath(pathname ?? "/") + suffix.join("");
    if (seen.has(target)) return [];
    seen.add(target);
    return [{ ...item, href: target }];
  });
  const core = new Set(["home", "search", "tv", "my-ayin"]);
  const primary = visible.filter((item) => core.has(item.key));
  const browse = visible.filter((item) => !core.has(item.key));
  if (browse.length > 0) {
    const existing = visible.find((item) => item.href === "/browse");
    const hub = existing ?? {
      key: browseNavigationKey,
      label: "Browse",
      href: "/browse",
      enabled: true,
      featureFlag: null,
    };
    primary.splice(Math.max(0, primary.findIndex((item) => item.key === "home") + 1), 0, hub);
  }
  return { primary, browse: browse.filter((item) => item.href !== "/browse") };
}
