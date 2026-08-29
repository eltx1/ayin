"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiBaseUrl } from "@/lib/api";
import styles from "./social.module.css";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationFeed() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/social/notifications`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        if (!response.ok) throw new Error("Notifications could not be loaded.");
        setItems(((await response.json()) as { items: NotificationItem[] }).items);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Notifications could not be loaded.");
      });
    return () => controller.abort();
  }, [router]);
  async function markRead(id: string) {
    const response = await fetch(`${apiBaseUrl}/social/notifications/${id}/read`, {
      method: "PATCH",
      credentials: "include",
    });
    if (response.ok)
      setItems(
        (current) =>
          current?.map((item) =>
            item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
          ) ?? [],
      );
  }
  if (error) return <p role="alert">{error}</p>;
  if (!items) return <p>Loading notifications…</p>;
  if (items.length === 0)
    return <p className={styles.empty}>Meaningful creator and account updates will appear here.</p>;
  return (
    <ul className={styles.notifications}>
      {items.map((item) => (
        <li data-read={Boolean(item.readAt)} key={item.id}>
          <div>
            <small>{item.type}</small>
            <strong>{item.title}</strong>
            {item.body ? <p>{item.body}</p> : null}
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time>
          </div>
          {!item.readAt ? (
            <button onClick={() => void markRead(item.id)} type="button">
              Mark read
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
