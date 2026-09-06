import type { MetadataRoute } from "next";

import { absoluteUrl, AYIN_SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/studio/",
          "/account/",
          "/channel/",
          "/upload",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    host: AYIN_SITE_URL,
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
