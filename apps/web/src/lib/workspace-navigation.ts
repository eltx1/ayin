import type { AdminRole } from "./admin-control";
import { stripLocalePrefix } from "./i18n/routing";
import type { TranslationKey } from "./i18n/translator";

export interface WorkspaceNavigationItem {
  label: TranslationKey;
  href: string;
  roles?: readonly AdminRole[] | "ALL";
}

export interface WorkspaceNavigationGroup {
  id: string;
  label: TranslationKey;
  items: readonly WorkspaceNavigationItem[];
}

export const studioNavigation: readonly WorkspaceNavigationGroup[] = [
  {
    id: "overview",
    label: "navigation.overview",
    items: [{ label: "studio.dashboard", href: "/studio" }],
  },
  {
    id: "content",
    label: "navigation.content",
    items: [
      { label: "studio.content", href: "/studio/content" },
      { label: "studio.playlists", href: "/studio/playlists" },
      { label: "studio.live", href: "/studio/live" },
      { label: "studio.tv", href: "/studio/tv" },
    ],
  },
  {
    id: "audience",
    label: "navigation.audience",
    items: [
      { label: "studio.analytics", href: "/studio/analytics" },
      { label: "studio.comments", href: "/studio/comments" },
      { label: "studio.community", href: "/studio/community" },
    ],
  },
  {
    id: "earnings",
    label: "navigation.earnings",
    items: [{ label: "studio.monetization", href: "/studio/monetization" }],
  },
  {
    id: "channel",
    label: "navigation.channel",
    items: [
      { label: "studio.channelSettings", href: "/studio/channel" },
      { label: "studio.trustSafety", href: "/studio/trust" },
      { label: "studio.support", href: "/studio/support" },
    ],
  },
];

const operations = ["OPERATIONS"] as const;
const moderation = ["OPERATIONS", "CONTENT_MODERATOR"] as const;
const advertising = ["AD_MANAGER"] as const;
const finance = ["FINANCE_MANAGER"] as const;

export const adminNavigation: readonly WorkspaceNavigationGroup[] = [
  {
    id: "overview",
    label: "navigation.overview",
    items: [{ label: "navigation.dashboard", href: "/admin", roles: "ALL" }],
  },
  {
    id: "content",
    label: "navigation.content",
    items: [
      { label: "navigation.library", href: "/admin/content", roles: moderation },
      { label: "navigation.videos", href: "/admin/videos", roles: moderation },
      { label: "navigation.movies", href: "/admin/movies", roles: operations },
      { label: "navigation.series", href: "/admin/series", roles: operations },
      { label: "navigation.kids", href: "/admin/kids", roles: moderation },
      { label: "navigation.localizations", href: "/admin/catalog-localizations", roles: operations },
      { label: "navigation.creatorTv", href: "/admin/tv", roles: operations },
    ],
  },
  {
    id: "people",
    label: "navigation.people",
    items: [
      { label: "navigation.users", href: "/admin/users", roles: operations },
      { label: "navigation.channels", href: "/admin/channels", roles: operations },
    ],
  },
  {
    id: "monetization",
    label: "navigation.monetization",
    items: [
      { label: "navigation.advertising", href: "/admin/advertising", roles: advertising },
      { label: "navigation.videoAds", href: "/admin/video-ads", roles: advertising },
      { label: "navigation.revenue", href: "/admin/revenue", roles: finance },
    ],
  },
  {
    id: "safety",
    label: "navigation.safety",
    items: [
      { label: "navigation.moderation", href: "/admin/moderation", roles: moderation },
      { label: "navigation.trust", href: "/admin/trust", roles: moderation },
    ],
  },
  {
    id: "product",
    label: "navigation.product",
    items: [
      { label: "navigation.productControls", href: "/admin/product-controls", roles: operations },
      { label: "navigation.featureFlags", href: "/admin/feature-flags", roles: operations },
    ],
  },
  {
    id: "operations",
    label: "navigation.operations",
    items: [{ label: "navigation.operationsAudit", href: "/admin/operations", roles: "ALL" }],
  },
  {
    id: "settings",
    label: "navigation.settings",
    items: [{ label: "navigation.settings", href: "/admin/settings", roles: operations }],
  },
];

// Navigation visibility only. API guards, ownership and MFA remain authoritative.
export function visibleAdminNavigation(roles: readonly AdminRole[]): WorkspaceNavigationGroup[] {
  const unrestricted = roles.includes("SUPERADMIN") || roles.includes("ADMIN");
  return adminNavigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (unrestricted) return true;
        if (item.roles === "ALL") return roles.length > 0;
        return item.roles?.some((role) => roles.includes(role)) ?? false;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function navigationPath(value: string): string {
  const pathname = value.split(/[?#]/)[0] || "/";
  return stripLocalePrefix(pathname).replace(/\/+$/, "") || "/";
}

export function isNavigationCurrent(pathname: string | null, target: string): boolean {
  if (!pathname || !target.startsWith("/") || target.startsWith("//")) return false;
  const current = navigationPath(pathname);
  const destination = navigationPath(target);
  if (["/", "/admin", "/studio"].includes(destination)) return current === destination;
  return current === destination || current.startsWith(`${destination}/`);
}

export function workspaceLocation(
  pathname: string | null,
  groups: readonly WorkspaceNavigationGroup[],
): { group: WorkspaceNavigationGroup; item: WorkspaceNavigationItem; detail: boolean } | null {
  const candidates = groups.flatMap((group) =>
    group.items
      .filter((item) => isNavigationCurrent(pathname, item.href))
      .map((item) => ({ group, item, detail: navigationPath(pathname ?? "/") !== item.href })),
  );
  return candidates.sort((a, b) => b.item.href.length - a.item.href.length)[0] ?? null;
}
