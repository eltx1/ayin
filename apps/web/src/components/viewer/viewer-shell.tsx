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

export function ViewerShell({ children }: ViewerShellProperties) {
  const pathname = usePathname();
  const [flags, setFlags] = useState<NavigationFlagState>({});
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [productControls, setProductControls] = useState<PublicProductControls | null>(null);

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

  const navigation = productControls?.navigation ?? fallbackNavigation;
  const announcement = productControls?.announcement;

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
            href={identity ? "/upload" : "/register"}
          >
            {identity ? "Create / Upload" : "Join AYIN"}
          </Link>
        </div>
      </header>

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
          <NavigationLinks flags={flags} items={navigation} pathname={pathname} surface="mobile" />
        </nav>
      ) : null}
    </TvFocusScope>
  );
}
