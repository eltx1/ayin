"use client";

import { ErrorState } from "@/components/viewer/view-states";

export default function ViewerError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      action={
        <button
          data-tv-focus-id="error-retry"
          data-tv-focusable="true"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      }
      description="The viewer surface could not finish loading. Your account and media have not been changed."
      title="AYIN hit a temporary problem"
    />
  );
}
