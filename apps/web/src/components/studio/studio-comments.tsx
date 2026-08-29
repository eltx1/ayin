"use client";

import { useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import { getStudioComments, type StudioComment } from "@/lib/studio";

export function StudioComments() {
  const [comments, setComments] = useState<StudioComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getStudioComments()
      .then((response) => {
        if (active) setComments(response.comments);
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : "Comments could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Comments</h1>
          <p className={styles.muted}>A compact view of recent conversation across your videos.</p>
        </div>
      </header>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.muted}>Loading comments…</p> : null}
      <section className={styles.commentGrid}>
        {!loading && comments.length === 0 ? (
          <p className={styles.muted}>No comments yet.</p>
        ) : null}
        {comments.map((comment) => (
          <article className={styles.card} key={comment.id}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{comment.authorProfile.name}</strong>
                <p className={styles.muted}>
                  on {comment.video.title} · {new Date(comment.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className={styles.muted}>{comment.status.toLowerCase()}</span>
            </div>
            <p>{comment.body}</p>
            <p className={styles.muted}>
              {comment._count.reactions} likes · {comment._count.replies} replies ·{" "}
              {comment._count.reports} reports
            </p>
          </article>
        ))}
      </section>
    </>
  );
}
