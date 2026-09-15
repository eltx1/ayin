"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, type AyinIdentity } from "@/lib/api";

import styles from "./public-channel.module.css";

export function OwnerChannelActions({ handle }: { handle: string }) {
  const { href, t } = useI18n();
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const identity = (await response.json()) as AyinIdentity;
        setOwner(identity.channel.handle === handle);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [handle]);

  if (!owner) return null;

  return (
    <>
      <Link className={styles.editAction} href={href("/channel/tv")}>
        {t("channel.manageTv")}
      </Link>
      <Link className={styles.editAction} href={href("/channel/playlists")}>
        {t("channel.managePlaylists")}
      </Link>
      <Link className={styles.editAction} href={href("/channel/edit")}>
        {t("channel.edit")}
      </Link>
    </>
  );
}
