"use client";

import { FormEvent, useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { getStudioContent, type StudioVideo } from "@/lib/studio";

type PostType = "TEXT" | "IMAGE" | "POLL" | "VIDEO_SHARE";
type CommunityPost = {
  id: string;
  type: PostType;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "HIDDEN";
  body: string | null;
  scheduledPublishAt: string | null;
  publishedAt: string | null;
  imageAsset: { status: string } | null;
  sharedVideo: { id: string; title: string } | null;
  pollOptions: Array<{ id: string; label: string }>;
};

type Editor = {
  type: PostType;
  body: string;
  pollOptions: string;
  sharedVideoId: string;
  scheduledPublishAt: string;
  imageFile: File | null;
};

const emptyEditor: Editor = {
  type: "TEXT",
  body: "",
  pollOptions: "",
  sharedVideoId: "",
  scheduledPublishAt: "",
  imageFile: null,
};

async function communityRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("The selected image could not be inspected."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadImage(postId: string, file: File) {
  const dimensions = await imageDimensions(file);
  const authorization = await communityRequest<{
    assetId: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
  }>(`/creator/community/posts/${postId}/image/authorize`, {
    method: "POST",
    body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
  });
  const upload = await fetch(authorization.upload.url, {
    method: authorization.upload.method,
    headers: authorization.upload.headers,
    body: file,
  });
  if (!upload.ok) throw new Error("The community image could not be uploaded.");
  await communityRequest(`/creator/community/posts/${postId}/image/complete`, {
    method: "POST",
    body: JSON.stringify({ assetId: authorization.assetId, ...dimensions }),
  });
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function StudioCommunityManager() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [videos, setVideos] = useState<StudioVideo[]>([]);
  const [editor, setEditor] = useState<Editor>(emptyEditor);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [nextPosts, content] = await Promise.all([
      communityRequest<CommunityPost[]>("/creator/community/posts"),
      getStudioContent({ status: "PUBLISHED" }),
    ]);
    setPosts(nextPosts);
    setVideos(content.videos);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      communityRequest<CommunityPost[]>("/creator/community/posts"),
      getStudioContent({ status: "PUBLISHED" }),
    ])
      .then(([nextPosts, content]) => {
        if (!active) return;
        setPosts(nextPosts);
        setVideos(content.videos);
        setError(null);
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : "Community posts could not load.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function resetEditor() {
    setEditor(emptyEditor);
    setEditingId(null);
  }

  function edit(post: CommunityPost) {
    setEditingId(post.id);
    setEditor({
      type: post.type,
      body: post.body ?? "",
      pollOptions: post.pollOptions.map((option) => option.label).join("\n"),
      sharedVideoId: post.sharedVideo?.id ?? "",
      scheduledPublishAt: localDateTime(post.scheduledPublishAt),
      imageFile: null,
    });
    setMessage(null);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const editingPost = editingId ? posts.find((post) => post.id === editingId) : null;
      if ((editor.type === "TEXT" || editor.type === "IMAGE") && !editor.body.trim())
        throw new Error("Add text to this post.");
      if (
        editor.type === "IMAGE" &&
        !editor.imageFile &&
        editingPost?.imageAsset?.status !== "VALIDATED"
      )
        throw new Error("Choose a JPG, PNG or WebP image.");
      const pollOptions = editor.pollOptions
        .split("\n")
        .map((option) => option.trim())
        .filter(Boolean);
      if (editor.type === "POLL" && pollOptions.length < 2)
        throw new Error("Add at least two poll options, one per line.");
      if (editor.type === "VIDEO_SHARE" && !editor.sharedVideoId)
        throw new Error("Choose a published video to share.");

      const payload = {
        type: editor.type,
        body: editor.body.trim() || null,
        sharedVideoId: editor.type === "VIDEO_SHARE" ? editor.sharedVideoId : null,
        ...(editor.type === "POLL" ? { pollOptions } : {}),
        scheduledPublishAt: editor.scheduledPublishAt
          ? new Date(editor.scheduledPublishAt).toISOString()
          : null,
      };
      const post = editingId
        ? await communityRequest<CommunityPost>(`/creator/community/posts/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await communityRequest<CommunityPost>("/creator/community/posts", {
            method: "POST",
            body: JSON.stringify(payload),
          });
      if (editor.type === "IMAGE" && editor.imageFile) await uploadImage(post.id, editor.imageFile);
      await refresh();
      setMessage(
        editor.scheduledPublishAt
          ? "Community post scheduled."
          : editingId
            ? "Community draft updated."
            : "Community draft created.",
      );
      resetEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The community post could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function act(post: CommunityPost, action: "publish" | "remove") {
    if (action === "remove" && !window.confirm("Remove this community post?")) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await communityRequest(
        `/creator/community/posts/${post.id}${action === "publish" ? "/publish" : ""}`,
        {
          method: action === "publish" ? "POST" : "DELETE",
        },
      );
      await refresh();
      if (editingId === post.id) resetEditor();
      setMessage(action === "publish" ? "Community post published." : "Community post removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The community action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Community</h1>
          <p className={styles.muted}>
            Publish channel updates, images, polls and video shares now or on a schedule.
          </p>
        </div>
      </header>

      <form className={styles.card} onSubmit={save}>
        <div className={styles.formGrid}>
          <label>
            Post type
            <select
              disabled={busy || Boolean(editingId)}
              onChange={(event) =>
                setEditor((current) => ({ ...current, type: event.target.value as PostType }))
              }
              value={editor.type}
            >
              <option value="TEXT">Text</option>
              <option value="IMAGE">Image</option>
              <option value="POLL">Poll</option>
              <option value="VIDEO_SHARE">Video share</option>
            </select>
          </label>
          <label>
            Publish time (optional)
            <input
              disabled={busy}
              onChange={(event) =>
                setEditor((current) => ({ ...current, scheduledPublishAt: event.target.value }))
              }
              type="datetime-local"
              value={editor.scheduledPublishAt}
            />
          </label>
          <label>
            Message {editor.type === "POLL" || editor.type === "VIDEO_SHARE" ? "(optional)" : ""}
            <textarea
              disabled={busy}
              maxLength={5000}
              onChange={(event) =>
                setEditor((current) => ({ ...current, body: event.target.value }))
              }
              value={editor.body}
            />
          </label>
          {editor.type === "POLL" ? (
            <label>
              Poll options (one per line)
              <textarea
                disabled={busy}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, pollOptions: event.target.value }))
                }
                value={editor.pollOptions}
              />
            </label>
          ) : null}
          {editor.type === "VIDEO_SHARE" ? (
            <label>
              Published video
              <select
                disabled={busy}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, sharedVideoId: event.target.value }))
                }
                value={editor.sharedVideoId}
              >
                <option value="">Choose a video</option>
                {videos.map((video) => (
                  <option key={video.id} value={video.id}>
                    {video.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {editor.type === "IMAGE" ? (
            <label>
              Image {editingId ? "(choose only to replace)" : ""}
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    imageFile: event.target.files?.[0] ?? null,
                  }))
                }
                type="file"
              />
            </label>
          ) : null}
        </div>
        <div className={styles.actions}>
          <button className={styles.primary} disabled={busy} type="submit">
            {busy ? "Saving…" : editingId ? "Save changes" : "Create post"}
          </button>
          {editingId ? (
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={resetEditor}
              type="button"
            >
              Cancel editing
            </button>
          ) : null}
        </div>
      </form>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.muted}>Loading community posts…</p> : null}

      <section className={styles.videoGrid} aria-label="Community posts">
        {!loading && posts.length === 0 ? (
          <p className={styles.muted}>No community posts yet.</p>
        ) : null}
        {posts.map((post) => (
          <article className={styles.card} key={post.id}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{post.type.replaceAll("_", " ")}</strong>
                <p className={styles.muted}>
                  {post.status.toLowerCase()}
                  {post.scheduledPublishAt
                    ? ` · ${new Date(post.scheduledPublishAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              {post.imageAsset ? <span>{post.imageAsset.status.toLowerCase()} image</span> : null}
            </div>
            {post.body ? <p>{post.body}</p> : null}
            {post.sharedVideo ? <p>Video: {post.sharedVideo.title}</p> : null}
            {post.pollOptions.length ? (
              <ul>
                {post.pollOptions.map((option) => (
                  <li key={option.id}>{option.label}</li>
                ))}
              </ul>
            ) : null}
            <div className={styles.actions}>
              {post.status !== "PUBLISHED" ? (
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => edit(post)}
                  type="button"
                >
                  Edit
                </button>
              ) : null}
              {post.status !== "PUBLISHED" ? (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void act(post, "publish")}
                  type="button"
                >
                  Publish now
                </button>
              ) : null}
              <button
                className={styles.danger}
                disabled={busy}
                onClick={() => void act(post, "remove")}
                type="button"
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
