import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AYIN",
    short_name: "AYIN",
    description: "Global streaming, creators and Creator TV in one web-first experience.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    background_color: "#05070d",
    theme_color: "#05070d",
    orientation: "any",
    categories: ["entertainment", "video", "social"],
    shortcuts: [
      {
        name: "Uploads",
        short_name: "Uploads",
        url: "/uploads",
        icons: [{ src: "/icons/ayin-192.svg", sizes: "192x192", type: "image/svg+xml" }],
      },
      {
        name: "Creator TV",
        short_name: "TV",
        url: "/tv",
        icons: [{ src: "/icons/ayin-192.svg", sizes: "192x192", type: "image/svg+xml" }],
      },
    ],
    icons: [
      {
        src: "/icons/ayin-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/ayin-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
