"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl, type AyinIdentity, readApiError } from "@/lib/api";
import {
  getEditableChannel,
  mediaAssetUrl,
  type ChannelAppearance,
  type EditableChannelResponse,
  updateEditableChannel,
  uploadChannelAsset,
} from "@/lib/channel";

import styles from "./channel-editor.module.css";

export function ChannelEditor() {
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [channel, setChannel] = useState<EditableChannelResponse | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState("#63D1CC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setSignedOut(true);
          setMessage(await readApiError(response));
          return;
        }
        const nextIdentity = (await response.json()) as AyinIdentity;
        setIdentity(nextIdentity);
        const editable = await getEditableChannel(nextIdentity.channel.id);
        applyChannel(editable);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "Your channel could not be loaded.");
        }
      });
    return () => controller.abort();
  }, []);

  function applyChannel(next: EditableChannelResponse) {
    setChannel(next);
    setName(next.channel.name);
    setHandle(next.channel.handle);
    setDescription(next.channel.description ?? "");
    setAccentColor(next.appearance.accentColor ?? "#63D1CC");
  }

  async function save() {
    if (!identity || !channel) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await updateEditableChannel(identity.channel.id, {
        name,
        handle,
        description: description.trim() || null,
        accentColor,
      });
      applyChannel(updated);
      setIdentity({
        ...identity,
        channel: {
          ...identity.channel,
          name: updated.channel.name,
          handle: updated.channel.handle,
        },
      });
      setMessage(
        updated.previousHandle
          ? `Saved. Old links using @${updated.previousHandle} now redirect to @${updated.channel.handle}.`
          : "Channel changes saved.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The channel could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAsset(kind: "avatar" | "banner", file: File | null) {
    if (!file || !identity || !channel) return;
    setBusy(true);
    setMessage(null);
    try {
      const appearance = await uploadChannelAsset(identity.channel.id, kind, file);
      setChannel({ ...channel, appearance });
      setMessage(kind === "avatar" ? "Channel avatar updated." : "Channel banner updated.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The channel image could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (signedOut) {
    return (
      <main className={styles.page}>
        <section className={styles.notice}>
          <h1>Sign in to edit your channel</h1>
          <p>Your channel settings are available to the signed-in channel owner.</p>
          <Link href="/login">Sign in</Link>
        </section>
      </main>
    );
  }

  if (!identity || !channel) {
    return (
      <main className={styles.page}>
        <section className={styles.notice}>
          <p>{message ?? "Loading your channel…"}</p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Your channel</p>
          <h1>Keep it recognizable.</h1>
          <p>Edit the essentials here. You do not need a separate Studio workflow.</p>
        </div>
        <Link className={styles.viewAction} href={`/c/${channel.channel.handle}`}>
          View channel
        </Link>
      </header>

      <section className={styles.card} aria-labelledby="identity-settings">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="identity-settings">Identity</h2>
            <p>Name, handle and the short description viewers see on your channel.</p>
          </div>
        </div>

        <div className={styles.formGrid}>
          <label>
            <span>Channel name</span>
            <input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label>
            <span>Handle</span>
            <div className={styles.handleInput}>
              <strong>@</strong>
              <input
                maxLength={80}
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          </label>

          <label className={styles.full}>
            <span>About</span>
            <textarea
              maxLength={5_000}
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Tell viewers what your channel is about."
            />
          </label>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="appearance-settings">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="appearance-settings">Appearance</h2>
            <p>Use a simple avatar, banner and accent. You can change them again anytime.</p>
          </div>
        </div>

        <div className={styles.appearanceGrid}>
          <AssetControl
            kind="avatar"
            appearance={channel.appearance}
            name={channel.channel.name}
            busy={busy}
            onChange={(file) => void changeAsset("avatar", file)}
          />
          <AssetControl
            kind="banner"
            appearance={channel.appearance}
            name={channel.channel.name}
            busy={busy}
            onChange={(file) => void changeAsset("banner", file)}
          />

          <label className={styles.colorControl}>
            <span>Accent color</span>
            <div>
              <input
                type="color"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value.toUpperCase())}
              />
              <code>{accentColor}</code>
            </div>
          </label>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="publishing-defaults">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="publishing-defaults">Publishing defaults</h2>
            <p>
              AYIN keeps these defaults simple and applies them automatically during Quick Upload.
            </p>
          </div>
        </div>
        <dl className={styles.defaults}>
          <div>
            <dt>Visibility</dt>
            <dd>{friendlyVisibility(channel.settings?.defaultVideoVisibility)}</dd>
          </div>
          <div>
            <dt>Comments</dt>
            <dd>
              {channel.settings?.defaultCommentsEnabled === false
                ? "Off by default"
                : "On by default"}
            </dd>
          </div>
          <div>
            <dt>Creator TV</dt>
            <dd>
              {channel.settings?.autoAddPublishedToTv === false
                ? "Manual inclusion"
                : "Auto-add eligible uploads"}
            </dd>
          </div>
        </dl>
      </section>

      <footer className={styles.saveBar}>
        <p role="status">{message ?? "Changes apply to your public channel after saving."}</p>
        <button
          type="button"
          disabled={busy || !name.trim() || !handle.trim()}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save channel"}
        </button>
      </footer>
    </main>
  );
}

function AssetControl({
  kind,
  appearance,
  name,
  busy,
  onChange,
}: {
  kind: "avatar" | "banner";
  appearance: ChannelAppearance;
  name: string;
  busy: boolean;
  onChange: (file: File | null) => void;
}) {
  const asset = kind === "avatar" ? appearance.avatar : appearance.banner;
  const imageUrl = mediaAssetUrl(asset?.objectKey);
  return (
    <label className={`${styles.assetControl} ${kind === "banner" ? styles.bannerControl : ""}`}>
      <span>{kind === "avatar" ? "Avatar" : "Banner"}</span>
      <div
        className={`${styles.assetPreview} ${kind === "banner" ? styles.bannerPreview : styles.avatarPreview}`}
        style={imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined}
      >
        {!imageUrl && kind === "avatar" ? name.charAt(0).toUpperCase() : null}
      </div>
      <strong>{kind === "avatar" ? "Choose avatar" : "Choose banner"}</strong>
      <small>JPG, PNG or WebP.</small>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function friendlyVisibility(value: "PUBLIC" | "UNLISTED" | "PRIVATE" | undefined): string {
  if (value === "PRIVATE") return "Private";
  if (value === "UNLISTED") return "Unlisted";
  return "Public";
}
