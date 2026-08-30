"use client";
import Link from "next/link";
import { apiBaseUrl } from "../../../../../lib/api";
type Item = {
  id: string;
  type: "TEXT" | "IMAGE" | "POLL" | "VIDEO_SHARE";
  body: string | null;
  channel: { handle: string; name: string };
  imageAsset: { r2ObjectKey: string } | null;
  sharedVideo: { slug: string; title: string } | null;
  pollOptions: Array<{ id: string; label: string; _count: { votes: number } }>;
  _count: { reactions: number; comments: number };
};
const media = (key: string) => {
  const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "";
  return base ? `${base}/${key}` : key;
};
async function mutate(path: string, method: "PUT" | "POST", body?: unknown) {
  return fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: "include",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}
export function CommunityFeed({ items }: { items: Item[] }) {
  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: "48rem" }}>
      {items.map((post) => (
        <article
          key={post.id}
          style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: "1rem",
            padding: "1rem",
          }}
        >
          <Link href={`/c/${post.channel.handle}`}>@{post.channel.handle}</Link>
          {post.body ? <p>{post.body}</p> : null}
          {post.imageAsset ? (
            <img
              src={media(post.imageAsset.r2ObjectKey)}
              alt="Community post"
              style={{ maxWidth: "100%", borderRadius: ".75rem" }}
            />
          ) : null}
          {post.sharedVideo ? (
            <p>
              <Link href={`/watch/${post.sharedVideo.slug}`}>▶ {post.sharedVideo.title}</Link>
            </p>
          ) : null}
          {post.pollOptions.length ? (
            <div>
              {post.pollOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    void mutate(`/community/posts/${post.id}/poll/${option.id}`, "PUT")
                  }
                >
                  {option.label} · {option._count.votes}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: ".75rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void mutate(`/community/posts/${post.id}/reaction`, "PUT")}
            >
              ♡ {post._count.reactions}
            </button>
            <Link href={`/c/${post.channel.handle}/community#${post.id}`}>
              Comments {post._count.comments}
            </Link>
            <button
              type="button"
              onClick={() =>
                void mutate(`/community/posts/${post.id}/reports`, "POST", {
                  reason: "OTHER",
                  details: "Reported from community feed",
                })
              }
            >
              Report
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
