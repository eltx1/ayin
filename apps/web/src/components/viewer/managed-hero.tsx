"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";

import { Hero } from "./hero";
import { useViewerProduct } from "./viewer-product-context";

export function ManagedHero() {
  const { locale, href } = useI18n();
  const { controls, navigationStatus, retryNavigation } = useViewerProduct();
  const hero = navigationStatus === "ready" ? controls?.resolvedHero : null;
  const t = (key: Parameters<typeof translatePublicDiscovery>[1]) =>
    translatePublicDiscovery(locale, key);

  return (
    <Hero
      onFocusCapture={(event) => {
        // Native focus can consider a target visible while the fixed mobile
        // tabs cover it. Check the painted target after native focus settles.
        const target = event.target;
        // Run after the browser's own focus scroll; never move a newer focus.
        window.requestAnimationFrame(() => {
          if (target.isConnected && document.activeElement === target) {
            const bounds = target.getBoundingClientRect();
            const centerX = bounds.x + bounds.width / 2;
            const covered =
              !target.contains(document.elementFromPoint(centerX, bounds.top + 3)) ||
              !target.contains(document.elementFromPoint(centerX, bounds.bottom - 3));
            if (covered) {
              target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            }
          }
        });
      }}
      description={
        hero
          ? (hero.description ?? t(`hero.${hero.entityType}.description`))
          : t("hero.description")
      }
      eyebrow={hero ? t(`hero.${hero.entityType}.eyebrow`) : t("hero.eyebrow")}
      primaryAction={
        hero
          ? { href: href(hero.href), label: t(`hero.${hero.entityType}.action`) }
          : { href: "#discovery", label: t("hero.explore") }
      }
      secondaryAction={{ href: href("/search"), label: t("hero.search") }}
      title={hero?.title ?? t("hero.title")}
    >
      {navigationStatus !== "ready" ? (
        <StatusNotice announce="polite" tone={navigationStatus === "error" ? "warning" : "info"}>
          <p>{t(navigationStatus === "error" ? "hero.error" : "hero.loading")}</p>
          {navigationStatus === "error" ? (
            <ActionButton data-tv-focusable="true" onClick={retryNavigation} tone="secondary">
              {t("hero.retry")}
            </ActionButton>
          ) : null}
        </StatusNotice>
      ) : null}
    </Hero>
  );
}
