import type { ReactNode } from "react";

import { ViewerShell } from "@/components/viewer/viewer-shell";

export default function ViewerLayout({ children }: { children: ReactNode }) {
  return <ViewerShell>{children}</ViewerShell>;
}
