export const navigationItems = [
  { id: "home", label: "Home", href: "/" },
  {
    id: "movies",
    label: "Movies",
    href: "/movies",
    featureFlag: "navigation.movies",
  },
  {
    id: "series",
    label: "Series",
    href: "/series",
    featureFlag: "navigation.series",
  },
  { id: "tv", label: "TV", href: "/tv", featureFlag: "navigation.tv" },
  {
    id: "creators",
    label: "Creators",
    href: "/creators",
    featureFlag: "navigation.creators",
  },
  {
    id: "shorts",
    label: "Shorts / Clips",
    href: "/shorts",
    featureFlag: "navigation.shorts",
  },
  { id: "kids", label: "Kids", href: "/kids", featureFlag: "navigation.kids" },
  {
    id: "my-ayin",
    label: "My AYIN",
    href: "/my-ayin",
    featureFlag: "navigation.my-ayin",
  },
  { id: "search", label: "Search", href: "/search" },
] as const;

export type NavigationItem = (typeof navigationItems)[number];
export type NavigationFeatureFlag = Exclude<NavigationItem["featureFlag"], undefined>;
export type NavigationFlagState = Partial<Record<NavigationFeatureFlag, boolean>>;

export function visibleNavigationItems(flags: NavigationFlagState): readonly NavigationItem[] {
  return navigationItems.filter(
    (item) => !("featureFlag" in item) || flags[item.featureFlag] === true,
  );
}

export function parseNavigationFlags(input: unknown): NavigationFlagState {
  if (!input || typeof input !== "object") {
    return {};
  }

  const candidate = "flags" in input ? (input as { flags?: unknown }).flags : input;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const result: NavigationFlagState = {};
  for (const item of navigationItems) {
    if (!("featureFlag" in item)) {
      continue;
    }
    const value = (candidate as Record<string, unknown>)[item.featureFlag];
    if (typeof value === "boolean") {
      result[item.featureFlag] = value;
    }
  }
  return result;
}
