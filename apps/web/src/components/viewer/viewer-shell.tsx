"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import { NavigationDialog } from "@/components/ui/navigation-dialog";
import { NavigationIcon, type NavigationIconName } from "@/components/ui/navigation-icon";
import type { TranslationKey } from "@/lib/i18n/translator";
import {
  buildViewerNavigation,
  navigationLabelKeys,
  type ProductNavigationItem,
} from "@/lib/viewer-navigation";
import { isNavigationCurrent, navigationPath } from "@/lib/workspace-navigation";

import { useViewerProduct, ViewerProductProvider } from "./viewer-product-context";
import footerStyles from "./viewer-footer.module.css";
import styles from "./viewer-shell.module.css";

const legalNavigation = [
  { href: "/privacy", key: "shell.privacy" },
  { href: "/terms", key: "shell.terms" },
  { href: "/community-guidelines", key: "shell.communityGuidelines" },
  { href: "/copyright", key: "shell.copyright" },
  { href: "/creator-terms", key: "shell.creatorTerms" },
  { href: "/cookies", key: "shell.cookiesAdvertising" },
] as const satisfies readonly { href: string; key: TranslationKey }[];

const icons: Partial<Record<string, NavigationIconName>> = {
  home: "home",
  search: "search",
  tv: "tv",
  "my-ayin": "library",
};

function ProductLinks({
  items,
  browse,
  mobile = false,
  surface,
}: {
  items: readonly ProductNavigationItem[];
  browse: readonly ProductNavigationItem[];
  mobile?: boolean;
  surface: string;
}) {
  const { href, t } = useI18n();
  const pathname = usePathname();
  return items.map((item) => {
    const key = navigationLabelKeys[item.key];
    const label = key ? t(key) : item.label;
    const active =
      isNavigationCurrent(pathname, item.href) ||
      (navigationPath(item.href) === "/browse" &&
        browse.some((category) => isNavigationCurrent(pathname, category.href)));
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={mobile ? styles.mobileTab : styles.navLink}
        data-tv-focusable="true"
        data-tv-focus-id={`${surface}-${item.key}`}
        href={href(item.href)}
        key={item.key}
      >
        {mobile ? <NavigationIcon name={icons[item.key] ?? "browse"} /> : null}
        <span>{label}</span>
      </Link>
    );
  });
}

function ViewerChrome({ children }: { children: ReactNode }) {
  const { href, t } = useI18n();
  const { flags, identity, controls } = useViewerProduct();
  const model = useMemo(() => buildViewerNavigation(flags, controls?.navigation), [flags, controls]);
  const announcement = controls?.announcement;
  const createHref = identity ? "/upload" : "/register";
  const device = controls?.deviceVisibility;

  return (
    <TvFocusScope className={styles.shell}>
      <a className={styles.skipLink} href="#ayin-content">
        {t("navigation.skipContent")}
      </a>
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
        <nav
          aria-label={t("shell.primaryNavigation")}
          className={styles.desktopNavigation}
          data-web-visible={device?.web !== false}
          data-tv-visible={device?.tv !== false}
        >
          <ProductLinks items={model.primary} browse={model.browse} surface="desktop" />
        </nav>
        <div className={styles.accountActions}>
          <Link
            className={styles.joinAction}
            data-tv-focus-id={identity ? "create-upload" : "join-ayin"}
            data-tv-focusable="true"
            href={href(createHref)}
          >
            {identity ? t("shell.createUpload") : t("shell.join")}
          </Link>
          <NavigationDialog
            label={t("shell.openMenu")}
            title={identity ? identity.account.displayName : t("shell.explore")}
            triggerClassName={styles.menuButton}
            trigger={<NavigationIcon name="menu" />}
          >
            {identity ? (
              <>
                <h3 className={styles.menuHeading}>{t("navigation.yourAccount")}</h3>
                <nav aria-label={t("shell.accountNavigation")} className={styles.accountMenu}>
                  <Link data-tv-focusable="true" href={href("/account")}>
                    {t("shell.account")}
                  </Link>
                  <Link data-tv-focusable="true" href={href("/notifications")}>
                    {t("shell.notifications")}
                  </Link>
                  <Link data-tv-focusable="true" href={href(`/c/${identity.channel.handle}`)}>
                    {t("shell.myChannel")}
                  </Link>
                </nav>
                <h3 className={styles.menuHeading}>{t("navigation.createManage")}</h3>
                <nav aria-label={t("shell.accountCreatorNavigation")} className={styles.accountMenu}>
                  <Link data-tv-focusable="true" href={href("/upload")}>
                    {t("shell.createUpload")}
                  </Link>
                  <Link data-tv-focusable="true" href={href("/studio/content")}>
                    {t("shell.myVideos")}
                  </Link>
                  <Link data-tv-focusable="true" href={href("/studio")}>
                    {t("shell.creatorStudio")}
                  </Link>
                </nav>
              </>
            ) : (
              <nav aria-label={t("shell.accountNavigation")} className={styles.accountMenu}>
                <Link data-tv-focusable="true" href={href("/login")}>
                  {t("shell.signIn")}
                </Link>
                <Link data-tv-focusable="true" href={href("/register")}>
                  {t("shell.createAccount")}
                </Link>
              </nav>
            )}
            <nav
              aria-label={t("shell.browseAyin")}
              className={styles.drawerProductNavigation}
              data-web-visible={device?.web !== false}
              data-mobile-visible={device?.mobile !== false}
              data-tv-visible={device?.tv !== false}
            >
              <ProductLinks items={model.primary} browse={model.browse} surface="menu" />
            </nav>
          </NavigationDialog>
        </div>
      </header>
      {announcement?.enabled && announcement.text ? (
        <div className={styles.announcement} dir="auto" role="status">
          {announcement.href ? (
            <Link href={href(announcement.href)}>{announcement.text}</Link>
          ) : (
            announcement.text
          )}
        </div>
      ) : null}
      <div className={styles.content} id="ayin-content" tabIndex={-1}>
        {children}
      </div>
      <footer className={`${footerStyles.footer} ${styles.footer}`}>
        <div className={footerStyles.identity}>
          <strong>AYIN</strong>
          <span>{t("shell.productBy")}</span>
        </div>
        <nav aria-label={t("shell.legalPolicy")} className={footerStyles.links}>
          {legalNavigation.map((item) => (
            <Link data-tv-focusable="true" href={href(item.href)} key={item.href}>
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <p className={footerStyles.copyright}>
          © {new Date().getFullYear()} AYIN. {t("shell.allRightsReserved")}
        </p>
      </footer>
      <nav
        aria-label={t("shell.mobileNavigation")}
        className={styles.mobileNavigation}
        data-mobile-visible={device?.mobile !== false}
      >
        <ProductLinks items={model.primary} browse={model.browse} surface="mobile" mobile />
      </nav>
    </TvFocusScope>
  );
}

export function ViewerShell({ children }: { children: ReactNode }) {
  return (
    <ViewerProductProvider>
      <ViewerChrome>{children}</ViewerChrome>
    </ViewerProductProvider>
  );
}
