import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AYIN",
    short_name: "AYIN",
    description: "Global streaming, creators and Creator TV in one web-first experience.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#05070d",
    theme_color: "#05070d",
    orientation: "any",
    categories: ["entertainment", "video"],
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
