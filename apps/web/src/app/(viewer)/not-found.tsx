import Link from "next/link";

import { EmptyState } from "@/components/viewer/view-states";

export default function NotFound() {
  return (
    <EmptyState
      action={
        <Link data-tv-focus-id="not-found-home" data-tv-focusable="true" href="/">
          Return home
        </Link>
      }
      description="That AYIN destination is not available."
      title="Nothing here yet"
    />
  );
}
