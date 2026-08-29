"use client";

import { useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";

import { Hero } from "./hero";

interface ResolvedHero {
  entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST";
  entityId: string;
  title: string;
  description: string;
  href: string;
}

export function ManagedHero() {
  const [resolvedHero, setResolvedHero] = useState<ResolvedHero | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/product-controls`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { resolvedHero?: ResolvedHero | null };
        if (!controller.signal.aborted && body.resolvedHero) setResolvedHero(body.resolvedHero);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (resolvedHero) {
    return (
      <Hero
        description={resolvedHero.description}
        eyebrow={`Featured ${resolvedHero.entityType.replace("_", " ").toLowerCase()}`}
        primaryAction={{ href: resolvedHero.href, label: "Watch / explore" }}
        secondaryAction={{ href: "/search", label: "Search AYIN" }}
        title={resolvedHero.title}
      />
    );
  }

  return (
    <Hero
      description="A global entertainment network built for watching, discovering and creating without friction. Discovery is powered by real AYIN catalog and viewing data."
      eyebrow="Watch · Create · Tune in"
      primaryAction={{ href: "#discovery", label: "Start exploring" }}
      secondaryAction={{ href: "/search", label: "Search AYIN" }}
      title="Stories move differently here."
    />
  );
}
