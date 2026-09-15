"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

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
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = useMemo(
    () =>
      kind === "video"
        ? "/admin/operations/directory/catalog-videos"
        : "/admin/operations/directory/catalog-artwork",
    [kind],
  );

  useEffect(() => {
    if (disabled) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      void fetch(`${apiBaseUrl}${endpoint}${params.size ? `?${params.toString()}` : ""}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readApiError(response));
          return response.json() as Promise<{ items: PickerItem[] }>;
        })
        .then((body) => {
          if (active) setItems(body.items);
        })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : "Search failed.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [disabled, endpoint, query]);

  return (
    <div className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{label}</strong>
          <p className={styles.muted}>
            {kind === "video"
              ? "Only accessible published videos with validated playback are selectable."
              : "Only validated, non-removed image assets are selectable."}
          </p>
        </div>
        {required ? <span className={styles.statusPill}>Required to publish</span> : null}
      </div>

      {value ? (
        <div className={styles.searchResult}>
          <div>
            <strong>{selectedLabel || "Selected catalog resource"}</strong>
            <small className={styles.muted}>Selection is stored internally; database IDs are hidden.</small>
          </div>
          {allowClear ? (
            <button
              className={styles.danger}
              disabled={disabled}
              onClick={() => onChange(null, null)}
              type="button"
            >
              Clear
            </button>
          ) : (
            <span className={styles.statusPill}>Required while published</span>
          )}
        </div>
      ) : null}

      <input
        aria-label={`Search ${label}`}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={kind === "video" ? "Search title, slug or channel…" : "Search asset, video or channel…"}
        value={query}
      />
      {loading ? <span className={styles.muted}>Searching…</span> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.searchResults}>
        {items.slice(0, 8).map((item) => (
          <button
            className={styles.searchResult}
            disabled={disabled}
            key={item.id}
            onClick={() => {
              onChange(item.id, item.label);
              setQuery("");
              setItems([]);
            }}
            type="button"
          >
            <span>
              <strong>{item.label}</strong>
              {"channel" in item && item.channel ? (
                <small className={styles.muted}>@{item.channel.handle}</small>
              ) : null}
            </span>
            <span className={styles.statusPill}>Select</span>
          </button>
        ))}
      </div>
    </div>
  );
}
