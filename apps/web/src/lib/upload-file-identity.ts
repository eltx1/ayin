import type { UploadFileIdentity } from "@ayin/types";
import { parseFileIdentity } from "./upload-recovery-contract";

export function identifyUploadFile(
  file: File,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<UploadFileIdentity> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./upload-file-identity.worker.ts", import.meta.url), {
      type: "module",
      name: "ayin-upload-file-identity",
    });
    let settled = false;
    let lastBytes = 0;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = (error?: unknown, identity?: UploadFileIdentity) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (identity) resolve(identity);
      else reject(error ?? new Error("The file could not be checked."));
    };
    const cancel = () => finish(signal.reason);
    const extend = () => {
      clearTimeout(deadline);
      deadline = setTimeout(() => finish(new Error("The file check stopped responding.")), 60_000);
    };
    worker.onerror = () => finish();
    worker.onmessageerror = () => finish();
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return;
      try {
        const value = event.data as { kind?: unknown; bytes?: unknown; identity?: unknown };
        if (value?.kind === "progress") {
          const bytes = value.bytes;
          if (
            typeof bytes !== "number" ||
            !Number.isSafeInteger(bytes) ||
            bytes <= lastBytes ||
            bytes > file.size
          )
            throw new Error("Invalid file check progress.");
          lastBytes = bytes;
          onProgress(Math.floor((bytes / file.size) * 100));
          extend();
        } else if (value?.kind === "done") {
          if (lastBytes !== file.size) throw new Error("Incomplete file check.");
          finish(undefined, parseFileIdentity(value.identity, file.size));
        } else finish();
      } catch (error) {
        finish(error);
      }
    };
    signal.addEventListener("abort", cancel, { once: true });
    extend();
    if (signal.aborted) cancel();
    else {
      try {
        worker.postMessage(file);
      } catch (error) {
        finish(error);
      }
    }
  });
}
