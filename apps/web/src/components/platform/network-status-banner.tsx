"use client";

import { useEffect, useState } from "react";

import styles from "./network-status-banner.module.css";

export function NetworkStatusBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;

  return (
    <div aria-live="assertive" className={styles.banner} role="status">
      Network connection lost. AYIN will retry when the connection returns.
    </div>
  );
}
