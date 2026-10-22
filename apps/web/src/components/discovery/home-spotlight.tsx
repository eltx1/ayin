"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { mediaAssetUrl } from "@/lib/channel";
import type { DiscoverySpotlight } from "@/lib/discovery";
import { formatMediaDuration } from "@/lib/home-presentation";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import { revealCoveredFocus } from "@/lib/viewer-focus";

import styles from "./home-spotlight.module.css";

function SpotlightImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      alt=""
      className={styles.image}
      data-home-artwork
      fill
      loading="eager"
      fetchPriority="high"
      onError={() => setFailed(true)}
      sizes="(max-width: 760px) 100vw, 56vw"
      src={src}
      unoptimized
    />
  );
}

export function HomeSpotlight({ item, hasMore }: { item: DiscoverySpotlight; hasMore: boolean }) {
  const { locale, href } = useI18n();
  const t = (key: Parameters<typeof translatePublicDiscovery>[1]) =>
    translatePublicDiscovery(locale, key);
  const artwork = mediaAssetUrl(item.artworkObjectKey);
  const duration = formatMediaDuration(item.durationMs);
  const paragraph = item.description?.split(/\n\s*\n/)[0]?.trim() ?? "";
  const description = paragraph.length > 420 ? `${paragraph.slice(0, 417).trimEnd()}…` : paragraph;

  return (
    <section
      aria-labelledby="ayin-hero-title"
      className={styles.spotlight}
      data-home-spotlight={item.id}
      onFocusCapture={revealCoveredFocus}
    >
      <div aria-hidden="true" className={styles.visual}>
        {artwork ? <SpotlightImage key={artwork} src={artwork} /> : null}
        <span className={styles.visualMark}>AYIN</span>
      </div>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>{t("home.spotlight")}</p>
        <h1 dir="auto" id="ayin-hero-title" title={item.title}>
          {item.title}
        </h1>
        {item.channelName || duration ? (
          <p className={styles.meta}>
            {item.channelName ? <span dir="auto">{item.channelName}</span> : null}
            {duration ? (
              <span className={styles.duration} dir="ltr">
                {duration}
              </span>
            ) : null}
          </p>
        ) : null}
        {description ? (
          <p className={styles.description} dir="auto">
            {description}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Link
            className={styles.watch}
            data-tv-focus-id="hero-primary"
            data-tv-focusable="true"
            href={href(item.href)}
            aria-label={`${t("home.watch")}: ${item.title}`}
          >
            <span aria-hidden="true">▶</span> {t("home.watch")}
          </Link>
          <Link
            className={styles.explore}
            data-tv-focus-id="hero-secondary"
            data-tv-focusable="true"
            href={hasMore ? "#discovery" : href("/search")}
          >
            {t(hasMore ? "home.browse" : "home.search")}
          </Link>
        </div>
      </div>
    </section>
  );
}
