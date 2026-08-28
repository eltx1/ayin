"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import {
  parseNavigationFlags,
  type NavigationFlagState,
  visibleNavigationItems,
} from "@/lib/navigation";

import styles from "./viewer-shell.module.css";

interface ViewerShellProperties {
  children: ReactNode;
}

function NavigationLinks({ flags, surface }: { flags: NavigationFlagState; surface: string }) {
  return visibleNavigationItems(flags).map((item) => (
    <Link
      className={styles.navLink}
      data-tv-focus-id={`${surface}-${item.id}`}
      data-tv-focusable="true"
      href={item.href}
      key={item.id}
    >
      {item.label}
    </Link>
  ));
}

export function ViewerShell({ children }: ViewerShellProperties) {
  const [flags, setFlags] = useState<NavigationFlagState>({});
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);

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
            <span />
          </span>
          <span className={styles.brandWord}>AYIN</span>
        </Link>

        <nav aria-label="Primary navigation" className={styles.desktopNavigation}>
          <NavigationLinks flags={flags} surface="desktop" />
        </nav>

        <div className={styles.accountActions}>
          {identity ? (
            <Link
              className={styles.channelAction}
              data-tv-focus-id="my-channel"
              data-tv-focusable="true"
              href={`/c/${identity.channel.handle}`}
            >
              My channel
            </Link>
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

      <div className={styles.content}>{children}</div>

      <nav aria-label="Mobile navigation" className={styles.mobileNavigation}>
        <NavigationLinks flags={flags} surface="mobile" />
      </nav>
    </TvFocusScope>
  );
}
