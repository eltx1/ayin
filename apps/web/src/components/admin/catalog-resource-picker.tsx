"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import workspaceStyles from "./catalog-editor-workspace.module.css";
import { apiBaseUrl } from "@/lib/api";
import { readAdminApiError as readApiError } from "@/lib/admin-reauthentication";
import { catalogIdentityFailure, catalogResourceItems } from "@/lib/catalog-editor-contract";
import { useAdminAccess } from "./admin-access";
import { concealCatalogDom } from "./catalog-editor-workspace";
import { useCatalogCopy } from "./catalog-editor-copy";
import { ActionButton } from "@/components/ui/design-system";

type VideoItem = {
  id: string;
  label: string;
  title: string;
  slug: string;
  durationMs: number | null;
  channel: { name: string; handle: string };
};

type ArtworkItem = {
  id: string;
  label: string;
  r2ObjectKey: string;
  mimeType: string;
  kind: string;
  width: number | null;
  height: number | null;
  video: { title: string; slug: string } | null;
  channel: { name: string; handle: string } | null;
};

type PickerItem = VideoItem | ArtworkItem;

interface ResourcePickerProps {
  kind: "video" | "artwork";
  label: string;
  value: string | null;
  selectedLabel?: string | null;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  onChange: (id: string | null, label: string | null) => void;
}

export function CatalogResourcePicker({
  kind,
  label,
  value,
  selectedLabel,
  disabled = false,
  required = false,
  allowClear = true,
  onChange,
}: ResourcePickerProps) {
  const t = useCatalogCopy();
  const { getScopeLease, subscribeScopeInvalidation, invalidateScope } = useAdminAccess();
  const lease = typeof document === "undefined" ? null : getScopeLease();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(
    () =>
      subscribeScopeInvalidation(() => {
        if (root.current) concealCatalogDom(root.current);
        setItems([]);
        setQuery("");
        setError(null);
      }),
    [subscribeScopeInvalidation],
  );
  const endpoint = useMemo(
    () =>
      kind === "video"
        ? "/admin/operations/directory/catalog-videos"
        : "/admin/operations/directory/catalog-artwork",
    [kind],
  );

  useEffect(() => {
    if (disabled || !lease) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      void fetch(`${apiBaseUrl}${endpoint}${params.size ? `?${params.toString()}` : ""}`, {
        credentials: "include",
        headers: {
          "x-ayin-expected-account": lease.session.accountId,
          "x-ayin-expected-session": lease.session.sessionId,
        },
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) {
            const body: unknown = await response
              .clone()
              .json()
              .catch(() => null);
            if (getScopeLease() === lease && catalogIdentityFailure(response.status, body))
              invalidateScope();
            throw new Error(await readApiError(response));
          }
          return response.json() as Promise<unknown>;
        })
        .then((body) => {
          if (active && getScopeLease() === lease)
            setItems(catalogResourceItems<PickerItem>(body, kind));
        })
        .catch((caught) => {
          if (active && getScopeLease() === lease) {
            setItems([]);
            setError(caught instanceof Error ? t(caught.message) : t("Search failed."));
          }
        })
        .finally(() => {
          if (active && getScopeLease() === lease) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [disabled, endpoint, query, t, lease, getScopeLease, invalidateScope, kind]);

  return (
    <div
      ref={root}
      hidden={!lease}
      inert={!lease}
      className={`${styles.cardInset} ${workspaceStyles.privateRoot}`}
    >
      <div className={styles.cardHeader}>
        <div>
          <strong>{label}</strong>
          <p className={styles.muted}>
            {kind === "video"
              ? t("Only accessible published videos with validated playback are selectable.")
              : t("Only validated, non-removed image assets are selectable.")}
          </p>
        </div>
        {required ? <span className={styles.statusPill}>{t("Required to publish")}</span> : null}
      </div>

      {value ? (
        <div className={styles.searchResult}>
          <div className={workspaceStyles.selectionCopy}>
            <strong>{selectedLabel || t("Selected catalog resource")}</strong>
            <small className={styles.muted}>
              {t("Selection is stored internally; database IDs are hidden.")}
            </small>
          </div>
          {allowClear ? (
            <ActionButton
              className={styles.danger}
              disabled={disabled}
              onClick={() => {
                if (lease && getScopeLease() === lease) onChange(null, null);
              }}
              type="button"
            >
              {t("Clear")}
            </ActionButton>
          ) : (
            <span className={styles.statusPill}>{t("Required while published")}</span>
          )}
        </div>
      ) : null}

      <input
        aria-label={`${t("Search")} ${label}`}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={
          kind === "video"
            ? t("Search title, slug or channel…")
            : t("Search asset, video or channel…")
        }
        value={query}
      />
      {loading ? (
        <span role="status" className={styles.muted}>
          {t("Searching…")}
        </span>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !error && query.trim() && !items.length ? (
        <p role="status">{t("No matching resources.")}</p>
      ) : null}
      <div className={styles.searchResults}>
        {items.slice(0, 8).map((item) => (
          <ActionButton
            className={styles.searchResult}
            disabled={disabled}
            key={item.id}
            onClick={() => {
              if (!lease || getScopeLease() !== lease) return;
              onChange(item.id, item.label);
              setQuery("");
              setItems([]);
            }}
            type="button"
          >
            <span className={workspaceStyles.selectionCopy}>
              <strong>{item.label}</strong>
              {"channel" in item && item.channel ? (
                <small className={styles.muted}>@{item.channel.handle}</small>
              ) : null}
            </span>
            <span className={styles.statusPill}>{t("Select")}</span>
          </ActionButton>
        ))}
      </div>
    </div>
  );
}
