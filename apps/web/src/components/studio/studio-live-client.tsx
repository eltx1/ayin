"use client";

import { FormEvent, useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";

import styles from "@/app/studio/studio.module.css";

type LiveStream = {
  id: string;
  slug: string;
  title: string;
  status: string;
  scheduledStartAt: string | null;
  ingestEndpoint: string | null;
  playbackUrl: string | null;
};

type StudioResponse = {
  provider: { key: string; configured: boolean };
  streams: LiveStream[];
};

export function StudioLiveClient() {
  const [data, setData] = useState<StudioResponse | null>(null);
  const [title, setTitle] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch(`${apiBaseUrl}/studio/live`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      setMessage("Sign in with an active creator channel to manage live sessions.");
      return;
    }
    setData((await response.json()) as StudioResponse);
  }

  useEffect(() => {
    let active = true;
    void fetch(`${apiBaseUrl}/studio/live`, { credentials: "include", cache: "no-store" }).then(
      async (response) => {
        if (!active) return;
        if (!response.ok) {
          setMessage("Sign in with an active creator channel to manage live sessions.");
          return;
        }
        const next = (await response.json()) as StudioResponse;
        if (active) setData(next);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const body: { title: string; scheduledStartAt?: string } = { title };
    if (scheduledStartAt) body.scheduledStartAt = new Date(scheduledStartAt).toISOString();
    const response = await fetch(`${apiBaseUrl}/studio/live`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    setTitle("");
    setScheduledStartAt("");
    await refresh();
  }

  async function provision(id: string) {
    setOneTimeKey(null);
    const response = await fetch(`${apiBaseUrl}/studio/live/${id}/provision`, {
      method: "POST",
      credentials: "include",
    });
    const payload = (await response.json()) as { streamKey?: string; message?: string };
    if (!response.ok) {
      setMessage(payload.message ?? "Live provider is unavailable.");
      return;
    }
    setOneTimeKey(payload.streamKey ?? null);
    setMessage("Copy the stream key now. AYIN stores only its hash.");
    await refresh();
  }

  return (
    <section>
      <p>
        Provider: <strong>{data?.provider.key ?? "checking"}</strong> —{" "}
        {data?.provider.configured ? "configured" : "not configured"}
      </p>
      {!data?.provider.configured ? (
        <p>
          R2 is VOD storage and is not used as a live transcoder. Provisioning stays disabled until
          a real provider is configured.
        </p>
      ) : null}
      <form className={styles.card} onSubmit={create}>
        <label>
          Title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Scheduled start
          <input
            type="datetime-local"
            value={scheduledStartAt}
            onChange={(event) => setScheduledStartAt(event.target.value)}
          />
        </label>
        <button className={styles.primary} type="submit">
          Create live session
        </button>
      </form>
      {message ? <p aria-live="polite">{message}</p> : null}
      {oneTimeKey ? <code>{oneTimeKey}</code> : null}
      <div>
        {data?.streams.map((stream) => (
          <article className={styles.card} key={stream.id}>
            <h2>{stream.title}</h2>
            <p>{stream.status}</p>
            <p>/live/{stream.slug}</p>
            {stream.ingestEndpoint ? <p>Ingest: {stream.ingestEndpoint}</p> : null}
            <button
              className={styles.secondary}
              type="button"
              disabled={!data.provider.configured}
              onClick={() => void provision(stream.id)}
            >
              Provision / rotate credentials
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
