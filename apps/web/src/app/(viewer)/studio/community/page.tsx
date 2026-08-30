"use client";
import { useEffect, useState } from "react";
import { apiBaseUrl } from "../../../../lib/api";
type Post = { id: string; type: string; status: string; body: string | null };
export default function StudioCommunityPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const load = () =>
    fetch(`${apiBaseUrl}/creator/community/posts`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setPosts)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  async function create() {
    const response = await fetch(`${apiBaseUrl}/creator/community/posts`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "TEXT", body }),
    });
    if (!response.ok) {
      setMessage("Could not create post.");
      return;
    }
    setBody("");
    setMessage("Draft created.");
    await load();
  }
  async function publish(id: string) {
    await fetch(`${apiBaseUrl}/creator/community/posts/${id}/publish`, {
      method: "POST",
      credentials: "include",
    });
    await load();
  }
  async function remove(id: string) {
    await fetch(`${apiBaseUrl}/creator/community/posts/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await load();
  }
  return (
    <main style={{ padding: "2rem var(--shell-gutter) 6rem", maxWidth: "52rem" }}>
      <h1>Community posts</h1>
      <p>
        Create text, image, poll or video-share posts through the creator API. This quick surface
        handles text posts; richer post fields use the same validated workflow.
      </p>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} />
      <br />
      <button type="button" disabled={!body.trim()} onClick={() => void create()}>
        Create text draft
      </button>
      {message ? <p>{message}</p> : null}
      <section>
        {posts.map((post) => (
          <article key={post.id}>
            <strong>
              {post.type} · {post.status}
            </strong>
            <p>{post.body}</p>
            {post.status !== "PUBLISHED" ? (
              <button type="button" onClick={() => void publish(post.id)}>
                Publish
              </button>
            ) : null}
            <button type="button" onClick={() => void remove(post.id)}>
              Delete
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
