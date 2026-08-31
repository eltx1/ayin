import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { InstallUpdateController } from "@/components/pwa/install-update-controller";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { TvPlatformRuntime } from "@/components/platform/tv-platform-runtime";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "AYIN",
  description: "AYIN is a global web-first streaming and creator platform.",
  icons: {
    icon: "/brand/ayin-logo.png",
    apple: "/brand/ayin-logo.png",
  },
  manifest: "/manifest.webmanifest",
  title: {
    default: "AYIN",
    template: "%s · AYIN",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#03030a",
};

interface RootLayoutProperties {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProperties) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        <InstallUpdateController />
        <TvPlatformRuntime />
        {children}
      </body>
    </html>
  );
}
