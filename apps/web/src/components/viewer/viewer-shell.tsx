"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import { stripLocalePrefix } from "@/lib/i18n/routing";
import type { TranslationKey } from "@/lib/i18n/translator";
import {
  navigationItems,
  parseNavigationFlags,
  type NavigationFeatureFlag,
  type NavigationFlagState,
} from "@/lib/navigation";

import footerStyles from "./viewer-footer.module.css";
import styles from "./viewer-shell.module.css";

interface ViewerShellProperties {
  children: ReactNode;
}

interface ProductNavigationItem {
  key: string;
  label: string;
  href: string;
  enabled: boolean;
  featureFlag: string | null;
}

type MobileIconName = "home" | "search" | "create" | "videos" | "channel" | "bell" | "menu";

interface PublicProductControls {
  navigation: ProductNavigationItem[];
  announcement: { enabled: boolean; text: string; href: string | null };
  deviceVisibility: { web: boolean; mobile: boolean; tv: boolean };
}

const fallbackNavigation: ProductNavigationItem[] = navigationItems.map((item) => ({
  key: item.id,
  label: item.label,
  href: item.href,
  enabled: true,
  featureFlag: "featureFlag" in item ? item.featureFlag : null,
}));

const navigationKeys: Partial<Record<string, TranslationKey>> = {
  home: "nav.home",
  movies: "nav.movies",
  series: "nav.series",
  tv: "nav.tv",
  creators: "nav.creators",
  shorts: "nav.shorts",
  kids: "nav.kids",
  "my-ayin": "nav.myAyin",
  search: "nav.search",
};

const legalNavigation = [
  { href: "/privacy", key: "shell.privacy" },
  { href: "/terms", key: "shell.terms" },
  { href: "/community-guidelines", key: "shell.communityGuidelines" },
  { href: "/copyright", key: "shell.copyright" },
  { href: "/creator-terms", key: "shell.creatorTerms" },
  { href: "/cookies", key: "shell.cookiesAdvertising" },
] as const satisfies readonly { href: string; key: TranslationKey }[];

function itemIsActive(pathname: string | null, targetHref: string): boolean {
  if (!pathname) return false;
  const current = stripLocalePrefix(pathname);
  const target = stripLocalePrefix(targetHref);
  if (target === "/") return current === "/";
  return current === target || current.startsWith(`${target}/`);
}

function NavigationLinks({
  flags,
  items,
  pathname,
  surface,
}: {
  flags: NavigationFlagState;
  items: ProductNavigationItem[];
  pathname: string | null;
  surface: string;
}) {
  const { href, t } = useI18n();
  return items
    .filter(
      (item) =>
        item.enabled &&
        (!item.featureFlag || flags[item.featureFlag as NavigationFeatureFlag] === true),
    )
    .map((item) => {
      const active = itemIsActive(pathname, item.href);
      const translationKey = navigationKeys[item.key];
      const label = translationKey ? t(translationKey) : item.label;
      return (
        <Link
          aria-current={active ? "page" : undefined}
          className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
          data-tv-focus-id={`${surface}-${item.key}`}
          data-tv-focusable="true"
          href={href(item.href)}
          key={item.key}
        >
          {label}
        </Link>
      );
    });
}

function MobileIcon({ name }: { name: MobileIconName }) {
  if (name === "home") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3.5 10.6 12 3.8l8.5 6.8v8.7a.9.9 0 0 1-.9.9h-5.1v-6.1h-5v6.1H4.4a.9.9 0 0 1-.9-.9z" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="10.8" cy="10.8" r="6.2" />
        <path d="m15.5 15.5 4.8 4.8" />
      </svg>
    );
  }
  if (name === "create") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "videos") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
        <path d="m10 9 5 3-5 3z" />
      </svg>
    );
  }
  if (name === "channel") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.2 20c.6-4 3-6 6.8-6s6.2 2 6.8 6" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6.2 16.8h11.6l-1.3-2.1V10a4.5 4.5 0 0 0-9 0v4.7z" />
        <path d="M10 19.2a2.2 2.2 0 0 0 4 0" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function MobileTab({
  href: targetHref,
  icon,
  label,
  pathname,
  primary = false,
}: {
  href: string;
  icon: MobileIconName;
  label: string;
  pathname: string | null;
  primary?: boolean;
}) {
  const { href } = useI18n();
  const active = itemIsActive(pathname, targetHref);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={`${styles.mobileTab} ${active ? styles.mobileTabActive : ""} ${primary ? styles.mobileTabPrimary : ""}`}
      href={href(targetHref)}
    >
      <span className={styles.mobileTabIcon}>
        <MobileIcon name={icon} />
      </span>
      <span>{label}</span>
    </Link>
  );
}

export function ViewerShell({ children }: ViewerShellProperties) {
  const pathname = usePathname();
  const { href, t } = useI18n();
  const [flags, setFlags] = useState<NavigationFlagState>({});
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [productControls, setProductControls] = useState<PublicProductControls | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([
      fetch(`${apiBaseUrl}/platform/navigation`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          setFlags(parseNavigationFlags((await response.json()) as unknown));
        })
        .catch(() => undefined),
      fetch(`${apiBaseUrl}/product-controls`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          setProductControls((await response.json()) as PublicProductControls);
        })
        .catch(() => undefined),
      fetch(`${apiBaseUrl}/auth/me`, {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          setIdentity((await response.json()) as AyinIdentity);
        })
        .catch(() => undefined),
    ]);

    return () => controller.abort();
  }, []);

  const navigation = productControls?.navigation ?? fallbackNavigation;
  const announcement = productControls?.announcement;
  const createHref = identity ? "/upload" : "/register";
  const videosHref = identity ? "/studio/content" : "/login";
  const channelHref = identity ? `/c/${identity.channel.handle}` : "/login";

  return (
    <TvFocusScope className={styles.shell}>
      <header className={styles.topbar}>
        <Link
          aria-label={t("shell.homeAria")}
          className={styles.brand}
          data-tv-focus-id="brand-home"
          data-tv-focusable="true"
          href={href("/")}
        >
          <span aria-hidden="true" className={styles.brandMark}>
            <Image alt="" height={64} priority src="/brand/ayin-logo.png" width={64} />
          </span>
          <span className={styles.brandWord}>AYIN</span>
        </Link>

        {productControls?.deviceVisibility.web !== false ? (
          <nav aria-label={t("shell.primaryNavigation")} className={styles.desktopNavigation}>
            <NavigationLinks
              flags={flags}
              items={navigation}
              pathname={pathname}
              surface="desktop"
            />
          </nav>
        ) : (
          <span />
        )}

        <div className={styles.accountActions}>
          {identity ? (
            <>
              <Link
                className={styles.channelAction}
                data-tv-focus-id="notifications"
                data-tv-focusable="true"
                href={href("/notifications")}
              >
                {t("shell.notifications")}
              </Link>
              <Link
                className={styles.channelAction}
                data-tv-focus-id="account"
                data-tv-focusable="true"
                href={href("/account")}
              >
                {t("shell.account")}
              </Link>
              <Link
                className={styles.channelAction}
                data-tv-focus-id="my-channel"
                data-tv-focusable="true"
                href={href(`/c/${identity.channel.handle}`)}
              >
                {t("shell.myChannel")}
              </Link>
            </>
          ) : null}
          <Link
            className={styles.joinAction}
            data-tv-focus-id={identity ? "create-upload" : "join-ayin"}
            data-tv-focusable="true"
            href={href(createHref)}
          >
            {identity ? t("shell.createUpload") : t("shell.join")}
          </Link>
        </div>

        <div className={styles.mobileHeaderActions}>
          {identity ? (
            <Link
              className={styles.mobileIconButton}
              href={href("/notifications")}
              aria-label={t("shell.notifications")}
            >
              <MobileIcon name="bell" />
            </Link>
          ) : null}
          <button
            aria-controls="ayin-mobile-menu"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? t("shell.closeMenu") : t("shell.openMenu")}
            className={styles.mobileIconButton}
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <MobileIcon name="menu" />
          </button>
        </div>
      </header>

      {mobileMenuOpen ? (
        <aside
          className={styles.mobileMenuPanel}
          id="ayin-mobile-menu"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a"))
              setMobileMenuOpen(false);
          }}
        >
          <div className={styles.mobileMenuHeader}>
            <div>
              <strong dir="auto">
                {identity ? identity.account.displayName : t("shell.explore")}
              </strong>
              <span dir="auto">
                {identity ? `@${identity.channel.handle}` : t("shell.watchCreateDiscover")}
              </span>
            </div>
            <button type="button" onClick={() => setMobileMenuOpen(false)}>
              {t("shell.close")}
            </button>
          </div>

          {identity ? (
            <nav
              aria-label={t("shell.accountCreatorNavigation")}
              className={styles.mobileAccountGrid}
            >
              <Link href={href("/account")}>{t("shell.account")}</Link>
              <Link href={href("/my-ayin")}>{t("nav.myAyin")}</Link>
              <Link href={href("/studio")}>{t("shell.creatorStudio")}</Link>
              <Link href={href("/studio/content")}>{t("shell.myVideos")}</Link>
              <Link href={href(`/c/${identity.channel.handle}`)}>{t("shell.myChannel")}</Link>
              <Link href={href("/studio/analytics")}>{t("shell.analytics")}</Link>
              <Link href={href("/studio/monetization")}>{t("shell.earnings")}</Link>
              <Link href={href("/channel/playlists")}>{t("shell.playlists")}</Link>
              <Link href={href("/channel/tv")}>{t("shell.creatorTv")}</Link>
              <Link href={href("/notifications")}>{t("shell.notifications")}</Link>
              <Link href={href("/channel/edit")}>{t("shell.channelSettings")}</Link>
            </nav>
          ) : (
            <nav aria-label={t("shell.accountNavigation")} className={styles.mobileAccountGrid}>
              <Link href={href("/login")}>{t("shell.signIn")}</Link>
              <Link href={href("/register")}>{t("shell.createAccount")}</Link>
            </nav>
          )}

          <div className={styles.mobileMenuDivider} />
          <nav aria-label={t("shell.browseAyin")} className={styles.mobileProductNavigation}>
            <NavigationLinks
              flags={flags}
              items={navigation}
              pathname={pathname}
              surface="mobile-menu"
            />
          </nav>
        </aside>
      ) : null}

      {announcement?.enabled && announcement.text ? (
        <div className={styles.announcement} dir="auto" role="status">
          {announcement.href ? (
            <Link href={href(announcement.href)}>{announcement.text}</Link>
          ) : (
            announcement.text
          )}
        </div>
      ) : null}

      <div className={styles.content}>{children}</div>

      <footer className={footerStyles.footer}>
        <div className={footerStyles.identity}>
          <strong>AYIN</strong>
          <span>{t("shell.productBy")}</span>
        </div>
        <nav aria-label={t("shell.legalPolicy")} className={footerStyles.links}>
          {legalNavigation.map((item) => (
            <Link href={href(item.href)} key={item.href}>
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <p className={footerStyles.copyright}>
          © {new Date().getFullYear()} AYIN. {t("shell.allRightsReserved")}
        </p>
      </footer>

      {productControls?.deviceVisibility.mobile !== false ? (
        <nav aria-label={t("shell.mobileNavigation")} className={styles.mobileNavigation}>
          <MobileTab href="/" icon="home" label={t("nav.home")} pathname={pathname} />
          <MobileTab href="/search" icon="search" label={t("nav.search")} pathname={pathname} />
          <MobileTab
            href={createHref}
            icon="create"
            label={t("shell.create")}
            pathname={pathname}
            primary
          />
          <MobileTab
            href={videosHref}
            icon="videos"
            label={t("shell.videos")}
            pathname={pathname}
          />
          <MobileTab
            href={channelHref}
            icon="channel"
            label={t("shell.channel")}
            pathname={pathname}
          />
        </nav>
      ) : null}
    </TvFocusScope>
  );
}
