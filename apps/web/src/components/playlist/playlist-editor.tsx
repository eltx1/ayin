"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  addCreatorPlaylistItem,
  deleteCreatorPlaylist,
  getCreatorPlaylist,
  removeCreatorPlaylistItem,
  reorderCreatorPlaylistItems,
  type EditablePlaylistResponse,
  type PlaylistVisibility,
  updateCreatorPlaylist,
} from "@/lib/playlist";

import styles from "./playlist-management.module.css";

export function PlaylistEditor({ playlistId }: { playlistId: string }) {
  const [data, setData] = useState<EditablePlaylistResponse | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<PlaylistVisibility>("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let active = true;
    void getCreatorPlaylist(playlistId)
      .then((next) => {
        if (!active) return;
        applyPlaylist(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "This playlist could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [playlistId]);

  const itemIds = useMemo(() => data?.items.map((item) => item.id) ?? [], [data]);

  function applyPlaylist(next: EditablePlaylistResponse) {
    setData(next);
    setName(next.playlist.name);
    setDescription(next.playlist.description ?? "");
    setVisibility(next.playlist.visibility);
  }

  async function reload() {
    applyPlaylist(await getCreatorPlaylist(playlistId));
  }

  async function run(operation: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      await reload();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The playlist change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!data) return;
    const update: { name?: string; description?: string | null; visibility?: PlaylistVisibility } =
      {
        description: description.trim() || null,
      };
    if (data.playlist.capabilities.canRename) update.name = name.trim();
    if (data.playlist.capabilities.canChangeVisibility) update.visibility = visibility;
    await run(() => updateCreatorPlaylist(playlistId, update), "Playlist saved.");
  }

  async function removePlaylist() {
    if (!data?.playlist.capabilities.canDelete) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteCreatorPlaylist(playlistId);
      setDeleted(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The playlist could not be deleted.");
      setBusy(false);
    }
  }

  async function move(itemId: string, direction: -1 | 1) {
    const index = itemIds.indexOf(itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= itemIds.length) return;
    const reordered = [...itemIds];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    await run(() => reorderCreatorPlaylistItems(playlistId, reordered), "Playlist order updated.");
  }

  if (deleted) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyPanel}>
          <h1>Playlist deleted</h1>
          <p>The playlist was removed from your channel without affecting its videos.</p>
          <Link className={styles.primaryLink} href="/channel/playlists">
            Back to playlists
          </Link>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyPanel}>
          <h1>Playlist</h1>
          <p>{message || "Loading playlist…"}</p>
          <Link className={styles.secondaryAction} href="/channel/playlists">
            Back to playlists
          </Link>
        </section>
      </main>
    );
  }

  const system = data.playlist.systemKey === "UPLOADS";

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{system ? "System playlist" : "Creator playlist"}</p>
          <h1>{data.playlist.name}</h1>
          <p>
            {system
              ? "AYIN maintains Uploads automatically so every published upload remains present exactly once."
              : "Edit the collection without touching the videos themselves."}
          </p>
        </div>
        <Link className={styles.secondaryAction} href="/channel/playlists">
          All playlists
        </Link>
      </header>

      <section className={styles.editCard}>
        <div className={styles.formGrid}>
          <label>
            <span>Name</span>
            <input
              value={name}
              maxLength={160}
              disabled={!data.playlist.capabilities.canRename || busy}
              onChange={(event) => setName(event.target.value)}
            />
            {!data.playlist.capabilities.canRename ? (
              <small>The current AYIN policy keeps the Uploads name fixed.</small>
            ) : null}
          </label>
          <label>
            <span>Visibility</span>
            <select
              value={visibility}
              disabled={!data.playlist.capabilities.canChangeVisibility || busy}
              onChange={(event) => setVisibility(event.target.value as PlaylistVisibility)}
            >
              <option value="PUBLIC">Public</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
          <label className={styles.wideField}>
            <span>Description</span>
            <textarea
              rows={4}
              maxLength={5_000}
              value={description}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <div className={styles.toolbar}>
          <button disabled={busy || !name.trim()} type="button" onClick={save}>
            Save changes
          </button>
          {data.playlist.capabilities.canDelete ? (
            <button
              className={styles.dangerButton}
              disabled={busy}
              type="button"
              onClick={removePlaylist}
            >
              Delete playlist
            </button>
          ) : null}
        </div>
      </section>

      {message ? <p className={styles.message}>{message}</p> : null}

      <section className={styles.library} aria-labelledby="playlist-items-title">
        <div className={styles.sectionHeading}>
          <h2 id="playlist-items-title">Videos in this playlist</h2>
          <p>{data.items.length} items</p>
        </div>
        {data.items.length > 0 ? (
          <ol className={styles.itemList}>
            {data.items.map((item, index) => (
              <li key={item.id}>
                <div>
                  <strong>{item.video.title}</strong>
                  <span>
                    {item.video.visibility.toLowerCase()} · position {index + 1}
                  </span>
                </div>
                {data.playlist.capabilities.canEditItems ? (
                  <div className={styles.itemActions}>
                    <button
                      disabled={busy || index === 0}
                      type="button"
                      onClick={() => void move(item.id, -1)}
                    >
                      Up
                    </button>
                    <button
                      disabled={busy || index === data.items.length - 1}
                      type="button"
                      onClick={() => void move(item.id, 1)}
                    >
                      Down
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void run(
                          () => removeCreatorPlaylistItem(playlistId, item.id),
                          "Video removed from playlist.",
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>No videos are in this playlist yet.</p>
        )}
        {!data.playlist.capabilities.canEditItems ? (
          <p className={styles.systemNote}>
            Uploads is filled automatically at publish time. Manual remove/reorder controls are
            intentionally disabled.
          </p>
        ) : null}
      </section>

      {data.playlist.capabilities.canEditItems ? (
        <section className={styles.library} aria-labelledby="available-videos-title">
          <div className={styles.sectionHeading}>
            <h2 id="available-videos-title">Add published videos</h2>
            <p>{data.availableVideos.length} available</p>
          </div>
          {data.availableVideos.length > 0 ? (
            <div className={styles.availableGrid}>
              {data.availableVideos.map((video) => (
                <article className={styles.availableCard} key={video.id}>
                  <div>
                    <h3>{video.title}</h3>
                    <p>{video.visibility.toLowerCase()}</p>
                  </div>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void run(
                        () => addCreatorPlaylistItem(playlistId, video.id),
                        "Video added to playlist.",
                      )
                    }
                  >
                    Add
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>All currently published videos are already included.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
