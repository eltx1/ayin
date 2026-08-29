"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl, type AyinIdentity, readApiError } from "@/lib/api";
import {
  createCreatorPlaylist,
  listCreatorPlaylists,
  type CreatorPlaylistSummary,
  type PlaylistVisibility,
} from "@/lib/playlist";

import styles from "./playlist-management.module.css";

export function PlaylistManager() {
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [playlists, setPlaylists] = useState<CreatorPlaylistSummary[]>([]);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<PlaylistVisibility>("PUBLIC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setMessage(await readApiError(response));
          return;
        }
        const current = (await response.json()) as AyinIdentity;
        setIdentity(current);
        const rows = await listCreatorPlaylists(current.channel.id);
        setPlaylists(rows);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "Playlists could not be loaded.");
        }
      });
    return () => controller.abort();
  }, []);

  async function createPlaylist() {
    if (!identity || !name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await createCreatorPlaylist(identity.channel.id, { name: name.trim(), visibility });
      setName("");
      setPlaylists(await listCreatorPlaylists(identity.channel.id));
      setMessage("Playlist created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The playlist could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Creator playlists</p>
          <h1>Keep collections simple.</h1>
          <p>
            Uploads stays automatic. Create extra playlists only when you want to organize published
            videos for viewers.
          </p>
        </div>
        {identity ? (
          <Link
            className={styles.secondaryAction}
            href={`/c/${identity.channel.handle}?tab=playlists`}
          >
            View channel playlists
          </Link>
        ) : null}
      </header>

      <section className={styles.createCard} aria-labelledby="new-playlist-title">
        <div>
          <h2 id="new-playlist-title">New playlist</h2>
          <p>Give it a name and choose who can discover it.</p>
        </div>
        <div className={styles.createControls}>
          <label>
            <span>Name</span>
            <input
              value={name}
              maxLength={160}
              placeholder="Favorites, documentaries, behind the scenes…"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Visibility</span>
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as PlaylistVisibility)}
            >
              <option value="PUBLIC">Public</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="PRIVATE">Private</option>
            </select>
          </label>
          <button
            disabled={!identity || !name.trim() || busy}
            type="button"
            onClick={createPlaylist}
          >
            Create playlist
          </button>
        </div>
      </section>

      {message ? <p className={styles.message}>{message}</p> : null}

      <section className={styles.library} aria-labelledby="playlist-library-title">
        <div className={styles.sectionHeading}>
          <h2 id="playlist-library-title">Your playlists</h2>
          <p>{playlists.length === 0 ? "No playlists yet" : `${playlists.length} total`}</p>
        </div>
        {playlists.length > 0 ? (
          <div className={styles.grid}>
            {playlists.map((playlist) => (
              <article className={styles.card} key={playlist.id}>
                <div className={styles.badges}>
                  {playlist.systemKey === "UPLOADS" ? <span>System</span> : null}
                  <span>{visibilityLabel(playlist.visibility)}</span>
                </div>
                <h3>{playlist.name}</h3>
                <p>{playlist.description || defaultDescription(playlist)}</p>
                <p className={styles.meta}>
                  {playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}
                </p>
                <div className={styles.cardActions}>
                  <Link href={`/channel/playlists/${playlist.id}`}>Manage</Link>
                  {identity && playlist.visibility !== "PRIVATE" ? (
                    <Link href={`/c/${identity.channel.handle}/playlists/${playlist.slug}`}>
                      Preview
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>Your automatic Uploads playlist will appear here.</p>
        )}
      </section>
    </main>
  );
}

function visibilityLabel(value: PlaylistVisibility): string {
  if (value === "PUBLIC") return "Public";
  if (value === "UNLISTED") return "Unlisted";
  return "Private";
}

function defaultDescription(playlist: CreatorPlaylistSummary): string {
  return playlist.systemKey === "UPLOADS"
    ? "AYIN automatically keeps every published upload here exactly once."
    : "A creator playlist on AYIN.";
}
