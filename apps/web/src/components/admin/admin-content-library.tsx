"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { type UploadSession, uploadPreparedVideoDirectly } from "@/lib/direct-video-upload";

type Channel = {
  id: string;
  handle: string;
  name: string;
  status: string;
  isPlatformOwned: boolean;
};

type SeedItem = {
  id: string;
  status: string;
  rightsBasis: string;
  sourceNotes: string;
  video: { id: string; slug: string; title: string; contentType: string; status: string };
};

type SeedBatch = {
  id: string;
  sourceLabel: string;
  status: string;
  createdAt: string;
  channel: { id: string; handle: string; name: string; isPlatformOwned: boolean };
  items: SeedItem[];
};

type BatchResponse = { batch: { id: string }; items: SeedItem[] };

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function AdminContentLibrary({ requestedChannelId = "" }: { requestedChannelId?: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [batches, setBatches] = useState<SeedBatch[]>([]);
  const [channelId, setChannelId] = useState(requestedChannelId);
  const [sourceLabel, setSourceLabel] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contentType, setContentType] = useState("CREATOR_VIDEO");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [rightsBasis, setRightsBasis] = useState("PUBLIC_DOMAIN");
  const [sourceNotes, setSourceNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [channelPayload, batchPayload] = await Promise.all([
      adminApi<{ items: Channel[] }>("/admin/content-seeding/channels"),
      adminApi<SeedBatch[]>("/admin/content-seeding/batches?take=50"),
    ]);
    setChannels(channelPayload.items);
    setBatches(batchPayload);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((caught) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Content library could not be loaded.",
          );
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!requestedChannelId) return;
    const timer = window.setTimeout(() => setChannelId(requestedChannelId), 0);
    return () => window.clearTimeout(timer);
  }, [requestedChannelId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const selectedChannel = channels.find((channel) => channel.id === channelId);
    if (!selectedChannel) {
      setError("Choose an AYIN-owned catalog channel.");
      return;
    }
    if (!file) {
      setError("Choose an MP4 file to upload.");
      return;
    }
    if (file.type && file.type !== "video/mp4") {
      setError("AYIN V1 accepts playback-ready MP4 video only.");
      return;
    }

    setBusy(true);
    setProgress(0);
    try {
      const created = await adminApi<BatchResponse>("/admin/content-seeding/batches", {
        method: "POST",
        body: JSON.stringify({
          channelId: selectedChannel.id,
          sourceLabel: sourceLabel.trim(),
          items: [
            {
              title: title.trim(),
              description: description.trim() || null,
              contentType,
              visibility,
              rightsBasis,
              sourceNotes: sourceNotes.trim(),
            },
          ],
        }),
      });
      const item = created.items[0];
      if (!item) throw new Error("AYIN did not create the seed item.");

      const session = await adminApi<UploadSession>(
        `/admin/content-seeding/items/${encodeURIComponent(item.id)}/upload-session`,
        {
          method: "POST",
          body: JSON.stringify({ sizeBytes: file.size, mimeType: "video/mp4" }),
        },
      );
      await uploadPreparedVideoDirectly({ session, file, onProgress: setProgress });
      await adminApi(`/admin/content-seeding/items/${encodeURIComponent(item.id)}/confirm-upload`, {
        method: "POST",
      });
      if (publishImmediately) {
        await adminApi(`/admin/content-seeding/items/${encodeURIComponent(item.id)}/publish`, {
          method: "POST",
        });
      }

      setMessage(
        publishImmediately
          ? `Published “${title.trim()}” to @${selectedChannel.handle}.`
          : `Uploaded and verified “${title.trim()}”. It is ready for review.`,
      );
      setTitle("");
      setDescription("");
      setSourceLabel("");
      setSourceNotes("");
      setFile(null);
      setProgress(100);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Content seeding failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publish(item: SeedItem) {
    setBusyItem(item.id);
    setError(null);
    try {
      await adminApi(`/admin/content-seeding/items/${encodeURIComponent(item.id)}/publish`, {
        method: "POST",
      });
      setMessage(`Published “${item.video.title}”.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be published.");
    } finally {
      setBusyItem(null);
    }
  }

  async function rollback(batch: SeedBatch) {
    if (
      !window.confirm(
        `Roll back unpublished batch “${batch.sourceLabel}”? Its uploaded R2 objects will be removed.`,
      )
    )
      return;
    setBusyItem(batch.id);
    setError(null);
    try {
      await adminApi(`/admin/content-seeding/batches/${encodeURIComponent(batch.id)}/rollback`, {
        method: "POST",
      });
      setMessage(`Rolled back batch “${batch.sourceLabel}”.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The batch could not be rolled back.");
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Content Operations</span>
          <h1>AYIN Content Library</h1>
          <p className={styles.muted}>
            Rights-tracked catalog ingestion with direct R2 upload, verification, publishing and
            safe rollback.
          </p>
        </div>
      </header>

      <section className={styles.card} style={{ marginBottom: "1rem" }}>
        <strong>Rights gate</strong>
        <p className={styles.muted}>
          Online availability is not permission. Save the exact source URL, rights statement,
          license, authorization or ownership evidence for every item. Prefer AYIN-owned, public
          domain, CC0 or explicitly licensed material.
        </p>
      </section>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.card} style={{ marginBottom: "1.5rem" }}>
        <h2>Add catalog content</h2>
        {channels.length === 0 ? (
          <p className={styles.muted}>
            No AYIN-owned catalog channels are available. An Operations administrator must mark an
            appropriate channel as platform-owned first.
          </p>
        ) : null}
        <form className={styles.form} onSubmit={submit}>
          <label>
            <span>AYIN-owned channel</span>
            <select
              required
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
            >
              <option value="">Choose channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} (@{channel.handle})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Source / batch label</span>
            <input
              required
              maxLength={200}
              placeholder="e.g. Library of Congress public-domain item"
              value={sourceLabel}
              onChange={(event) => setSourceLabel(event.target.value)}
            />
          </label>
          <label>
            <span>Title</span>
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              maxLength={20000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            <span>Content type</span>
            <select value={contentType} onChange={(event) => setContentType(event.target.value)}>
              <option value="CREATOR_VIDEO">Creator video</option>
              <option value="MOVIE">Movie</option>
              <option value="DOCUMENTARY">Documentary</option>
            </select>
          </label>
          <label>
            <span>Visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="PUBLIC">Public</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
          <label>
            <span>Rights basis</span>
            <select value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value)}>
              <option value="OWNED">Owned by AYIN / rights holder</option>
              <option value="LICENSED">Licensed</option>
              <option value="AUTHORIZED">Explicitly authorized</option>
              <option value="PUBLIC_DOMAIN">Public domain</option>
              <option value="OTHER">Other documented basis</option>
            </select>
          </label>
          <label>
            <span>Rights evidence / source notes</span>
            <textarea
              required
              minLength={3}
              maxLength={10000}
              placeholder="Exact source URL + rights statement/license + required attribution."
              value={sourceNotes}
              onChange={(event) => setSourceNotes(event.target.value)}
            />
          </label>
          <label>
            <span>Playback-ready MP4</span>
            <input
              required
              accept="video/mp4,.mp4"
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label style={{ display: "flex", gap: "0.55rem", alignItems: "center" }}>
            <input
              checked={publishImmediately}
              type="checkbox"
              onChange={(event) => setPublishImmediately(event.target.checked)}
            />
            <span>Publish immediately after upload verification</span>
          </label>
          {busy || progress > 0 ? (
            <div>
              <progress max={100} value={progress} style={{ width: "100%" }} />
              <span className={styles.muted}>{progress}%</span>
            </div>
          ) : null}
          <button className={styles.button} disabled={busy || channels.length === 0} type="submit">
            {busy
              ? "Uploading…"
              : publishImmediately
                ? "Upload, verify & publish"
                : "Upload & verify"}
          </button>
        </form>
      </section>

      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Audit trail</span>
          <h2>Recent seed batches</h2>
        </div>
      </header>
      <section className={styles.grid}>
        {batches.map((batch) => {
          const containsPublished = batch.items.some(
            (item) => item.status === "PUBLISHED" || item.video.status === "PUBLISHED",
          );
          return (
            <article className={styles.card} key={batch.id}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>{batch.sourceLabel}</strong>
                  <p className={styles.muted}>
                    @{batch.channel.handle} · {new Date(batch.createdAt).toLocaleString()} ·{" "}
                    {batch.status}
                  </p>
                </div>
              </div>
              {batch.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,.08)",
                    paddingTop: ".8rem",
                    marginTop: ".8rem",
                  }}
                >
                  <strong>{item.video.title}</strong>
                  <p className={styles.muted}>
                    {item.video.contentType} · {item.status} · rights: {item.rightsBasis}
                  </p>
                  <details>
                    <summary>Rights evidence</summary>
                    <p style={{ whiteSpace: "pre-wrap" }}>{item.sourceNotes}</p>
                  </details>
                  {item.status === "READY" && item.video.status !== "PUBLISHED" ? (
                    <button
                      className={styles.button}
                      disabled={busyItem === item.id}
                      type="button"
                      onClick={() => void publish(item)}
                    >
                      Publish
                    </button>
                  ) : null}
                </div>
              ))}
              {!containsPublished && batch.status !== "ROLLED_BACK" ? (
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    disabled={busyItem === batch.id}
                    type="button"
                    onClick={() => void rollback(batch)}
                  >
                    Roll back unpublished batch
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
        {batches.length === 0 ? <p className={styles.muted}>No seed batches yet.</p> : null}
      </section>
    </>
  );
}
