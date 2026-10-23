"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import { revealCoveredFocus } from "@/lib/viewer-focus";

import { Hero } from "./hero";
import { useViewerProduct } from "./viewer-product-context";

export function ManagedHero({
  compactFallback = false,
  allowEditorial = true,
}: {
  compactFallback?: boolean;
  allowEditorial?: boolean;
}) {
  const { locale, href } = useI18n();
  const { controls, navigationStatus, retryNavigation } = useViewerProduct();
  const hero = allowEditorial && navigationStatus === "ready" ? controls?.resolvedHero : null;
  const t = (key: Parameters<typeof translatePublicDiscovery>[1]) =>
    translatePublicDiscovery(locale, key);

  return (
    <Hero
      compact={compactFallback && !hero}
      onFocusCapture={revealCoveredFocus}
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
      {allowEditorial && navigationStatus !== "ready" ? (
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
