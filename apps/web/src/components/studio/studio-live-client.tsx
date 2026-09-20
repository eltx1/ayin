"use client";

import { FormEvent, useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";

import styles from "@/app/studio/studio.module.css";

type LiveStream = {
  id: string;
  slug: string;
  title: string;
  status: string;
  providerKey: string;
  providerStreamId: string | null;
  scheduledStartAt: string | null;
  ingestEndpoint: string | null;
  playbackUrl: string | null;
};

type ProviderDiagnostics = {
  key: string;
  configured: boolean;
  productionEnabled: boolean;
  ingestProtocols: string[];
  playbackProtocols: string[];
};

type StudioResponse = {
  provider: ProviderDiagnostics;
  streams: LiveStream[];
};

type EncoderConfiguration = {
  rtmps: {
    serverUrl: string;
    streamKey: string;
  };
  srt?: {
    url: string;
  };
};

type OneTimeEncoder = {
  streamId: string;
  encoder: EncoderConfiguration;
};

export function StudioLiveClient() {
  const [data, setData] = useState<StudioResponse | null>(null);
  const [title, setTitle] = useState("");
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [oneTimeEncoder, setOneTimeEncoder] = useState<OneTimeEncoder | null>(null);
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

  async function credentials(stream: LiveStream, rotate: boolean) {
    setOneTimeEncoder(null);
    setMessage("");
    const action = rotate ? "rotate-key" : "provision";
    const response = await fetch(`${apiBaseUrl}/studio/live/${stream.id}/${action}`, {
      method: "POST",
      credentials: "include",
    });
    const payload = (await response.json()) as {
      encoder?: EncoderConfiguration;
      message?: string;
    };
    if (!response.ok || !payload.encoder) {
      setMessage(payload.message ?? "Live provider is unavailable.");
      return;
    }
    setOneTimeEncoder({ streamId: stream.id, encoder: payload.encoder });
    setMessage(
      "Encoder credentials are shown only for this provisioning or rotation response. Copy them now and keep them private.",
    );
    await refresh();
  }

  async function sync(stream: LiveStream) {
    setMessage("");
    const response = await fetch(`${apiBaseUrl}/studio/live/${stream.id}/sync`, {
      method: "POST",
      credentials: "include",
    });
    const payload = (await response.json()) as {
      evidence?: { state?: string; playable?: boolean };
      message?: string;
    };
    if (!response.ok) {
      setMessage(payload.message ?? "Could not synchronize provider status.");
      return;
    }
    setMessage(
      payload.evidence?.playable
        ? "Mux confirms that the live output is playable."
        : `Provider status: ${payload.evidence?.state ?? "unknown"}. AYIN will not mark this session LIVE until Mux confirms playable output.`,
    );
    await refresh();
  }

  return (
    <section>
      <p>
        <strong>Live streaming</strong>{" "}
        {data?.provider.configured
          ? `is enabled through ${data.provider.key}.`
          : "is not available yet for this channel."}
      </p>
      {data?.provider.configured ? (
        <p>
          Encoder ingest: {data.provider.ingestProtocols.join(" / ")}. Playback:{" "}
          {data.provider.playbackProtocols.join(" / ")}.
        </p>
      ) : (
        <p>
          Live session creation remains safe, but provider provisioning is disabled until the live
          provider production gates are configured.
        </p>
      )}

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

      {oneTimeEncoder ? (
        <aside className={styles.card} aria-label="One-time encoder configuration">
          <h2>OBS / encoder configuration</h2>
          <p>
            <strong>RTMPS server</strong>
          </p>
          <code>{oneTimeEncoder.encoder.rtmps.serverUrl}</code>
          <p>
            <strong>Stream key — shown once</strong>
          </p>
          <code>{oneTimeEncoder.encoder.rtmps.streamKey}</code>
          {oneTimeEncoder.encoder.srt ? (
            <>
              <p>
                <strong>SRT URL — shown once</strong>
              </p>
              <code>{oneTimeEncoder.encoder.srt.url}</code>
            </>
          ) : null}
          <p>Do not refresh or rotate credentials until you have copied the values you need.</p>
        </aside>
      ) : null}

      <div>
        {data?.streams.map((stream) => (
          <article className={styles.card} key={stream.id}>
            <h2>{stream.title}</h2>
            <p>Status: {stream.status}</p>
            <p>/live/{stream.slug}</p>
            {stream.providerStreamId ? <p>Provider resource: {stream.providerStreamId}</p> : null}
            {stream.ingestEndpoint ? <p>RTMPS server: {stream.ingestEndpoint}</p> : null}
            {stream.playbackUrl ? <p>HLS playback: {stream.playbackUrl}</p> : null}
            <button
              className={styles.secondary}
              type="button"
              disabled={!data.provider.configured || !data.provider.productionEnabled}
              onClick={() => void credentials(stream, Boolean(stream.providerStreamId))}
            >
              {stream.providerStreamId ? "Rotate encoder credentials" : "Provision encoder"}
            </button>{" "}
            <button
              className={styles.secondary}
              type="button"
              disabled={!data.provider.configured || !stream.providerStreamId}
              onClick={() => void sync(stream)}
            >
              Sync provider status
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
