import { hashUploadFileIdentity, UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES } from "@ayin/types";

/** Worker-only producer: never read the entire File into memory. */
export async function hashUploadBlob(
  file: Blob,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  async function* chunks() {
    for (let start = 0; start < file.size; start += UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES) {
      signal.throwIfAborted();
      const end = Math.min(file.size, start + UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES);
      const bytes = await file.slice(start, end).arrayBuffer();
      signal.throwIfAborted();
      yield new Uint8Array(bytes);
      progress(end);
    }
  }
  return hashUploadFileIdentity(chunks(), file.size, { signal });
}
