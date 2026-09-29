"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./media-card.module.css";

function ArtworkRequest({ src, sizes }: { src: string; sizes: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      alt=""
      className={styles.artwork}
      fill
      loading="lazy"
      sizes={sizes}
      src={src}
      unoptimized
      onError={() => setFailed(true)}
      data-media-artwork="true"
    />
  );
}

// Source-keyed state resets after a genuine image change; a failed URL is never retried in a loop.
export function MediaArtwork({ src, sizes }: { src: string; sizes: string }) {
  return <ArtworkRequest key={src} src={src} sizes={sizes} />;
}
