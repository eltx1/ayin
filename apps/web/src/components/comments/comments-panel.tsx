"use client";

import { useCallback, useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";
import styles from "./comments.module.css";

type CommentItem = {
  id: string;
  body: string;
  createdAt: string;
  authorProfileId: string;
  authorProfile: { name: string; slug: string };
  likeCount: number;
  creatorHearted?: boolean;
  pinned?: boolean;
  edited?: boolean;
  replies?: CommentItem[];
};

export function CommentsPanel({ videoId, enabled }: { videoId: string; enabled: boolean }) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/comments/videos/${encodeURIComponent(videoId)}`);
      if (!response.ok) throw new Error("Comments are unavailable.");
      const data = (await response.json()) as { items: CommentItem[] };
      setItems(data.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Comments are unavailable.");
    } finally {
      setLoading(false);
    }
  }, [enabled, videoId]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!body.trim()) return;
    setMessage("");
    const response = await fetch(`${apiBaseUrl}/comments/videos/${encodeURIComponent(videoId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMessage(payload?.error?.message ?? "Sign in to join the conversation.");
      return;
    }
    setBody("");
    await load();
  }

  return (
    <details className={styles.panel} open={false}>
      <summary data-tv-focusable="true">Comments {items.length ? `(${items.length})` : ""}</summary>
      {!enabled ? <p>Comments are disabled for this video.</p> : null}
      {enabled ? (
        <>
          <div className={styles.composer}>
            <label htmlFor={`comment-${videoId}`}>Join the conversation</label>
            <textarea id={`comment-${videoId}`} maxLength={3000} onChange={(event) => setBody(event.target.value)} value={body} />
            <button data-tv-focusable="true" disabled={!body.trim()} onClick={() => void submit()} type="button">Comment</button>
          </div>
          {message ? <p role="status">{message}</p> : null}
          {loading ? <p>Loading comments…</p> : null}
          <div className={styles.list}>
            {items.map((item) => <CommentView item={item} key={item.id} />)}
            {!loading && items.length === 0 ? <p>Be the first to comment.</p> : null}
          </div>
        </>
      ) : null}
    </details>
  );
}

function CommentView({ item }: { item: CommentItem }) {
  return (
    <article className={styles.comment}>
      <header><strong>{item.authorProfile.name}</strong>{item.pinned ? <span> · Pinned</span> : null}{item.creatorHearted ? <span> · ♥ Creator</span> : null}</header>
      <p>{item.body}</p>
      <small>{item.likeCount} likes{item.edited ? " · edited" : ""}</small>
      {item.replies?.length ? <div className={styles.replies}>{item.replies.map((reply) => <CommentView item={reply} key={reply.id} />)}</div> : null}
    </article>
  );
}
