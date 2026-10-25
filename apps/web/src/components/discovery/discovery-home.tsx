"use client";

import { useEffect, useState, type ReactNode } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { MediaCardSkeleton } from "@/components/viewer/media-card";
import { ManagedHero } from "@/components/viewer/managed-hero";
import { EmptyState } from "@/components/viewer/view-states";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { ActionButton, ActionLink } from "@/components/ui/design-system";
import type { AyinIdentity } from "@/lib/api";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import { discoveryRowTitle, homeSectionAnchor } from "@/lib/home-presentation";
import { sameViewerIdentity, withViewerReadDeadline } from "@/lib/viewer-bootstrap";
import {
  fetchDiscoveryHome,
  fetchKidsDiscoveryHome,
  getIdentity,
  type DiscoveryHomeResponse,
} from "@/lib/discovery";

import { DiscoveryRow } from "./discovery-row";
import { HomeSpotlight } from "./home-spotlight";
import styles from "./discovery.module.css";

export function DiscoveryHome({
  kidsMode = false,
  showHero = false,
  afterHero,
}: {
  kidsMode?: boolean;
  showHero?: boolean;
  afterHero?: ReactNode;
}) {
  const { locale, href } = useI18n();
  const copy = (key: Parameters<typeof translatePublicDiscovery>[1]) =>
    translatePublicDiscovery(locale, key);
  const {
    bootstrapRevision,
    bootstrapSuspended,
    audienceStatus,
    identity,
    identityRevision,
    isAudienceCurrent,
    retryNavigation,
    controls,
    navigationStatus,
  } = useViewerProduct();
  const [read, setRead] = useState<{
    revision: number;
    kidsMode: boolean;
    identity: AyinIdentity | null;
    home: DiscoveryHomeResponse | null;
    status: "ready" | "error";
  } | null>(null);

  useEffect(() => {
    if (bootstrapSuspended) return;
    const controller = new AbortController();
    void withViewerReadDeadline(async (readSignal) => {
      const viewer = kidsMode ? null : await getIdentity(readSignal);
      readSignal.throwIfAborted();
      const home = kidsMode
        ? await fetchKidsDiscoveryHome(readSignal)
        : await fetchDiscoveryHome(Boolean(viewer), readSignal);
      if (!Array.isArray(home.rows)) throw new Error("Discovery unavailable");
      return { identity: viewer, home };
    }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setRead({ ...result, revision: bootstrapRevision, kidsMode, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setRead({
            revision: bootstrapRevision,
            kidsMode,
            identity: null,
            home: null,
            status: "error",
          });
      });
    return () => controller.abort();
  }, [bootstrapRevision, bootstrapSuspended, kidsMode]);

  const currentRead =
    !bootstrapSuspended && read?.revision === bootstrapRevision && read.kidsMode === kidsMode
      ? read
      : null;
  const unavailable =
    !bootstrapSuspended &&
    (currentRead?.status === "error" ||
      (!kidsMode &&
        (audienceStatus === "error" ||
          (currentRead?.status === "ready" &&
            audienceStatus === "ready" &&
            !sameViewerIdentity(currentRead.identity, identity)))));
  const home =
    !unavailable &&
    currentRead?.home &&
    (kidsMode || (audienceStatus === "ready" && isAudienceCurrent()))
      ? currentRead.home
      : null;
  const visibleRows = home?.rows.filter((row) => row.items.length > 0) ?? [];
  const spotlight = home?.mode === "AUTO" ? home.spotlight : null;
  const managedHero =
    home?.mode === "MANAGED" && navigationStatus === "ready" && controls?.resolvedHero;
  const stateKey = `${bootstrapRevision}:${identityRevision}:${kidsMode}`;
  let content: ReactNode;
  if (unavailable) {
    content = (
      <section className={styles.authState} role="alert">
        <p>{copy("home.error")}</p>
        <ActionButton
          data-tv-focus-id="home-discovery-retry"
          data-tv-focusable="true"
          onClick={retryNavigation}
          tone="secondary"
          type="button"
        >
          {copy("home.retry")}
        </ActionButton>
        <ActionLink href={href(kidsMode ? "/search?kids=1" : "/search")} tone="quiet">
          {copy("home.search")}
        </ActionLink>
      </section>
    );
  } else if (!home) {
    content = <DiscoverySkeleton />;
  } else if (!visibleRows.length && !spotlight) {
    content = (
      <div className={styles.homeState}>
        <EmptyState
          title={copy(
            home.status === "DISABLED" || managedHero ? "home.disabledTitle" : "home.emptyTitle",
          )}
          description={copy(
            home.status === "DISABLED" || managedHero
              ? "home.disabledDescription"
              : "home.emptyDescription",
          )}
          action={
            <ActionLink
              data-tv-focusable="true"
              href={href(kidsMode ? "/search?kids=1" : "/search")}
            >
              {copy("home.search")}
            </ActionLink>
          }
        />
      </div>
    );
  } else {
    content = (
      <div className={styles.rows} data-private-viewer-state key={stateKey}>
        {showHero ? (
          <header className={styles.collectionHeader}>
            <div>
              <p>AYIN / {copy("home.browse")}</p>
              <h2>{copy("home.collection")}</h2>
            </div>
            <p>{copy("home.collectionDescription")}</p>
          </header>
        ) : null}
        {visibleRows.length > 1 && showHero ? (
          <nav aria-label={copy("home.sections")} className={styles.sectionLinks}>
            {visibleRows.map((row) => (
              <a data-tv-focusable="true" href={`#${homeSectionAnchor(row.key)}`} key={row.key}>
                {discoveryRowTitle(locale, row, kidsMode, home.mode === "AUTO")}
              </a>
            ))}
          </nav>
        ) : null}
        {visibleRows.map((row) => (
          <DiscoveryRow
            authenticated={Boolean(currentRead?.identity)}
            automatic={home.mode === "AUTO"}
            kidsMode={kidsMode}
            key={row.key}
            row={row}
          />
        ))}
        {showHero ? (
          <section className={styles.exploreMore}>
            <div>
              <h2>{copy("home.moreTitle")}</h2>
              <p>{copy("home.moreDescription")}</p>
            </div>
            <ActionLink data-tv-focusable="true" href={href("/search")} tone="secondary">
              {copy("home.search")}
            </ActionLink>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {showHero ? (
        spotlight ? (
          <div data-private-viewer-state key={`spotlight:${stateKey}`}>
            <HomeSpotlight item={spotlight} hasMore={visibleRows.length > 0} />
          </div>
        ) : (
          <ManagedHero allowEditorial={home?.mode === "MANAGED"} compactFallback />
        )
      ) : null}
      {afterHero}
      <section
        id={showHero ? "discovery" : undefined}
        className={showHero ? styles.homeDiscovery : undefined}
      >
        {content}
      </section>
    </>
  );
}

export function DiscoverySkeleton() {
  const { t } = useI18n();
  return (
    <div aria-label={t("home.loadingAria")} className={styles.skeletonRows} role="status">
      {Array.from({ length: 3 }, (_, rowIndex) => (
        <div className={styles.skeletonRow} key={`discovery-skeleton-${rowIndex}`}>
          <span className={styles.skeletonTitle} />
          <div className={styles.skeletonCards}>
            {Array.from({ length: 5 }, (_, cardIndex) => (
              <MediaCardSkeleton key={`card-${rowIndex}-${cardIndex}`} variant="poster" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
