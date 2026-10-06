export const UPLOAD_FILE_IDENTITY_ALGORITHM = "AYIN_SHA256_CHUNKS_V1" as const;
export const UPLOAD_FILE_IDENTITY_VERSION = 1 as const;
export const UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;
export const UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES = 50 * 1024 ** 3;

export interface UploadFileIdentity {
  algorithm: typeof UPLOAD_FILE_IDENTITY_ALGORITHM;
  version: typeof UPLOAD_FILE_IDENTITY_VERSION;
  sizeBytes: number;
  chunkSizeBytes: number;
  leafCount: number;
  rootSha256: string;
}

function cancellable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    void operation.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener("abort", cancel);
      reject(signal.reason);
    };
    signal.addEventListener("abort", cancel, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}

/**
 * Hash every source byte with a fixed, versioned chunk-root construction.
 * This is deliberately not SHA256(file), an ETag, or a sampled fingerprint.
 *
 * Canonical root input: UTF-8 "AYIN:source-file:sha256-chunks:v1\0", then
 * BE uint64 total bytes, BE uint32 chunk bytes, BE uint32 leaf count, followed
 * by each ordered 32-byte SHA-256 leaf digest. A final short leaf hashes only
 * its actual bytes. Input fragmentation cannot alter these fixed boundaries.
 *
 * The implementation owns one 4 MiB leaf buffer and a <401 KiB manifest.
 * Producers own their buffering and must keep yielded views stable until the
 * next pull. Future File/worker adapters must cancel their underlying reader
 * on the same signal; iterator.return() is best-effort and never delays abort.
 */
export async function hashUploadFileIdentity(
  source: AsyncIterable<Uint8Array>,
  sizeBytes: number,
  options: { signal?: AbortSignal } = {},
): Promise<UploadFileIdentity> {
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    sizeBytes > UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES
  )
    throw new Error("File identity requires a positive, bounded exact byte count.");
  const { signal } = options;
  signal?.throwIfAborted();
  if (!source || typeof source[Symbol.asyncIterator] !== "function")
    throw new Error("File identity requires an asynchronous byte source.");
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this environment.");

  const chunkSizeBytes = UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES;
  const leafCount = Math.ceil(sizeBytes / chunkSizeBytes);
  const domain = new TextEncoder().encode("AYIN:source-file:sha256-chunks:v1\0");
  const manifest = new Uint8Array(domain.byteLength + 16 + leafCount * 32);
  manifest.set(domain);
  const header = new DataView(manifest.buffer, domain.byteLength, 16);
  header.setBigUint64(0, BigInt(sizeBytes), false);
  header.setUint32(8, chunkSizeBytes, false);
  header.setUint32(12, leafCount, false);
  const leaf = new Uint8Array(chunkSizeBytes);
  let buffered = 0,
    observed = 0,
    hashedLeaves = 0,
    exhausted = false;
  const iterator = source[Symbol.asyncIterator]();
  const hashLeaf = async () => {
    signal?.throwIfAborted();
    const digest = await cancellable(
      globalThis.crypto.subtle.digest("SHA-256", leaf.subarray(0, buffered)),
      signal,
    );
    signal?.throwIfAborted();
    manifest.set(new Uint8Array(digest), domain.byteLength + 16 + hashedLeaves * 32);
    hashedLeaves++;
    buffered = 0;
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await cancellable(Promise.resolve(iterator.next()), signal);
      signal?.throwIfAborted();
      if (next.done) {
        exhausted = true;
        break;
      }
      const bytes = next.value;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
        throw new Error("File identity received an invalid byte chunk.");
      if (observed + bytes.byteLength > sizeBytes)
        throw new Error("The source contains more bytes than declared.");
      observed += bytes.byteLength;
      for (let offset = 0; offset < bytes.byteLength;) {
        const take = Math.min(chunkSizeBytes - buffered, bytes.byteLength - offset);
        leaf.set(bytes.subarray(offset, offset + take), buffered);
        buffered += take;
        offset += take;
        if (buffered === chunkSizeBytes) await hashLeaf();
      }
    }
    if (observed !== sizeBytes) throw new Error("The source contains fewer bytes than declared.");
    if (buffered) await hashLeaf();
    if (hashedLeaves !== leafCount) throw new Error("The source identity is incomplete.");
    const root = await cancellable(globalThis.crypto.subtle.digest("SHA-256", manifest), signal);
    signal?.throwIfAborted();
    return {
      algorithm: UPLOAD_FILE_IDENTITY_ALGORITHM,
      version: UPLOAD_FILE_IDENTITY_VERSION,
      sizeBytes,
      chunkSizeBytes,
      leafCount,
      rootSha256: Array.from(new Uint8Array(root), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    };
  } finally {
    if (!exhausted && iterator.return) {
      try {
        void Promise.resolve(iterator.return()).catch(() => undefined);
      } catch {
        /* Best-effort source cancellation. */
      }
    }
  }
}
