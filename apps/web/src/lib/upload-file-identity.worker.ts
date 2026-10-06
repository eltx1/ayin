import { hashUploadBlob } from "./upload-file-identity-source";

// One File and one operation per dedicated worker. The caller terminates this
// worker on cancellation, unmount, timeout, success or failure.
let started = false;
self.onmessage = (event: MessageEvent<unknown>) => {
  if (started) return;
  started = true;
  if (!(event.data instanceof Blob)) {
    self.postMessage({ kind: "error" });
    return;
  }
  void hashUploadBlob(event.data, new AbortController().signal, (bytes) =>
    self.postMessage({ kind: "progress", bytes }),
  ).then(
    (identity) => self.postMessage({ kind: "done", identity }),
    () => self.postMessage({ kind: "error" }),
  );
};
