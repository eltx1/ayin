import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { InstallUpdateController } from "@/components/pwa/install-update-controller";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: "AYIN",
  description: "AYIN is a global web-first streaming and creator platform.",
  manifest: "/manifest.webmanifest",
  title: {
    default: "AYIN",
    template: "%s · AYIN",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#05070d",
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
        {children}
      </body>
    </html>
  );
}
