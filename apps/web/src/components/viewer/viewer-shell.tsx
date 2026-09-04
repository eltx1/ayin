"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
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

const legalNavigation = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/community-guidelines", label: "Community Guidelines" },
  { href: "/copyright", label: "Copyright & Takedown" },
  { href: "/creator-terms", label: "Creator Terms" },
  { href: "/cookies", label: "Cookies & Advertising" },
] as const;

function itemIsActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
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
  return items
    .filter(
      (item) =>
        item.enabled &&
        (!item.featureFlag || flags[item.featureFlag as NavigationFeatureFlag] === true),
    )
    .map((item) => {
      const active = itemIsActive(pathname, item.href);
      return (
        <Link
          aria-current={active ? "page" : undefined}
          className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
          data-tv-focus-id={`${surface}-${item.key}`}
          data-tv-focusable="true"
          href={item.href}
          key={item.key}
        >
          {item.label}
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
  href,
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
  const active = itemIsActive(pathname, href);
  return (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={`${styles.mobileTab} ${active ? styles.mobileTabActive : ""} ${primary ? styles.mobileTabPrimary : ""}`}
      href={href}
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
          const body = (await response.json()) as PublicProductControls;
          setProductControls(body);
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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const navigation = productControls?.navigation ?? fallbackNavigation;
  const announcement = productControls?.announcement;
  const createHref = identity ? "/upload" : "/register";
  const videosHref = identity ? "/studio/content" : "/login";
  const channelHref = identity ? `/c/${identity.channel.handle}` : "/login";

  return (
    <TvFocusScope className={styles.shell}>
      <header className={styles.topbar}>
        <Link
          aria-label="AYIN home"
          className={styles.brand}
          data-tv-focus-id="brand-home"
          data-tv-focusable="true"
          href="/"
        >
          <span aria-hidden="true" className={styles.brandMark}>
            <Image alt="" height={64} priority src="/brand/ayin-logo.png" width={64} />
          </span>
          <span className={styles.brandWord}>AYIN</span>
        </Link>

        {productControls?.deviceVisibility.web !== false ? (
          <nav aria-label="Primary navigation" className={styles.desktopNavigation}>
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
                href="/notifications"
              >
                Notifications
              </Link>
              <Link
                className={styles.channelAction}
                data-tv-focus-id="account"
                data-tv-focusable="true"
                href="/account"
              >
                Account
              </Link>
              <Link
                className={styles.channelAction}
                data-tv-focus-id="my-channel"
                data-tv-focusable="true"
                href={`/c/${identity.channel.handle}`}
              >
                My channel
              </Link>
            </>
          ) : null}
          <Link
            className={styles.joinAction}
            data-tv-focus-id={identity ? "create-upload" : "join-ayin"}
            data-tv-focusable="true"
            href={createHref}
          >
            {identity ? "Create / Upload" : "Join AYIN"}
          </Link>
        </div>

        <div className={styles.mobileHeaderActions}>
          {identity ? (
            <Link className={styles.mobileIconButton} href="/notifications" aria-label="Notifications">
              <MobileIcon name="bell" />
            </Link>
          ) : null}
          <button
            aria-controls="ayin-mobile-menu"
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className={styles.mobileIconButton}
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <MobileIcon name="menu" />
          </button>
        </div>
      </header>

      {mobileMenuOpen ? (
        <aside className={styles.mobileMenuPanel} id="ayin-mobile-menu">
          <div className={styles.mobileMenuHeader}>
            <div>
              <strong>{identity ? identity.account.displayName : "Explore AYIN"}</strong>
              <span>{identity ? `@${identity.channel.handle}` : "Watch, create and discover"}</span>
            </div>
            <button type="button" onClick={() => setMobileMenuOpen(false)}>
              Close
            </button>
          </div>

          {identity ? (
            <nav aria-label="Account and creator navigation" className={styles.mobileAccountGrid}>
              <Link href="/account">Account</Link>
              <Link href="/my-ayin">My AYIN</Link>
              <Link href="/studio">Creator Studio</Link>
              <Link href="/studio/content">My videos</Link>
              <Link href={`/c/${identity.channel.handle}`}>My channel</Link>
              <Link href="/studio/analytics">Analytics</Link>
              <Link href="/studio/monetization">Earnings & payouts</Link>
              <Link href="/channel/playlists">Playlists</Link>
              <Link href="/channel/tv">Creator TV</Link>
              <Link href="/notifications">Notifications</Link>
              <Link href="/channel/edit">Channel settings</Link>
            </nav>
          ) : (
            <nav aria-label="Account navigation" className={styles.mobileAccountGrid}>
              <Link href="/login">Sign in</Link>
              <Link href="/register">Create account</Link>
            </nav>
          )}

          <div className={styles.mobileMenuDivider} />
          <nav aria-label="Browse AYIN" className={styles.mobileProductNavigation}>
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
        <div className={styles.announcement} role="status">
          {announcement.href ? (
            <Link href={announcement.href}>{announcement.text}</Link>
          ) : (
            announcement.text
          )}
        </div>
      ) : null}

      <div className={styles.content}>{children}</div>

      <footer className={footerStyles.footer}>
        <div className={footerStyles.identity}>
          <strong>AYIN</strong>
          <span>A Horus Media product</span>
        </div>
        <nav aria-label="Legal and policy" className={footerStyles.links}>
          {legalNavigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <p className={footerStyles.copyright}>
          © {new Date().getFullYear()} AYIN. All rights reserved.
        </p>
      </footer>

      {productControls?.deviceVisibility.mobile !== false ? (
        <nav aria-label="Mobile navigation" className={styles.mobileNavigation}>
          <MobileTab href="/" icon="home" label="Home" pathname={pathname} />
          <MobileTab href="/search" icon="search" label="Search" pathname={pathname} />
          <MobileTab href={createHref} icon="create" label="Create" pathname={pathname} primary />
          <MobileTab href={videosHref} icon="videos" label="Videos" pathname={pathname} />
          <MobileTab href={channelHref} icon="channel" label="Channel" pathname={pathname} />
        </nav>
      ) : null}
    </TvFocusScope>
  );
}
