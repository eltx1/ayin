import { RECOVERY_STORAGE_KEY } from "./upload-recovery-storage";

/** Backgrounding conceals viewer facts, but does not revoke an explicit upload
 * intent. Its account/session-bound API checks remain authoritative. Only real
 * navigation or another document changing the saved upload suspends its bytes. */
export function watchUploadRecoveryLifecycle(input: {
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  isVisible: () => boolean;
  suspend: () => void;
  restore: () => void;
}) {
  const restore = () => {
    if (input.isVisible()) input.restore();
  };
  const changedStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === RECOVERY_STORAGE_KEY || key === null) {
      input.suspend();
      restore();
    }
  };
  input.target.addEventListener("pagehide", input.suspend);
  input.target.addEventListener("pageshow", restore);
  input.target.addEventListener("focus", restore);
  input.target.addEventListener("storage", changedStorage);
  return () => {
    input.target.removeEventListener("pagehide", input.suspend);
    input.target.removeEventListener("pageshow", restore);
    input.target.removeEventListener("focus", restore);
    input.target.removeEventListener("storage", changedStorage);
  };
}
