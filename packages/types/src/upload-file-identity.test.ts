import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hashUploadFileIdentity,
  UPLOAD_FILE_IDENTITY_ALGORITHM,
  UPLOAD_FILE_IDENTITY_VERSION,
  UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES,
  UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES,
} from "./upload-file-identity.js";

const chunkSize = 4194304;
function deterministic(size: number) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >>> 8) + 17) & 255;
  return bytes;
}
async function* source(bytes: Uint8Array, fragment = bytes.length) {
  for (let offset = 0; offset < bytes.length; offset += fragment)
    yield bytes.subarray(offset, offset + fragment);
}
function nodeOracle(bytes: Uint8Array) {
  const domain = Buffer.from("AYIN:source-file:sha256-chunks:v1\0");
  const header = Buffer.alloc(16);
  header.writeBigUInt64BE(BigInt(bytes.length));
  header.writeUInt32BE(chunkSize, 8);
  header.writeUInt32BE(Math.ceil(bytes.length / chunkSize), 12);
  const root = createHash("sha256").update(domain).update(header);
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    root.update(
      createHash("sha256")
        .update(bytes.subarray(offset, offset + chunkSize))
        .digest(),
    );
  return root.digest("hex");
}

describe("AYIN full-byte chunk-root identity v1", () => {
  it("names the versioned chunk-root rather than claiming SHA256(file)", () => {
    expect(UPLOAD_FILE_IDENTITY_ALGORITHM).toBe("AYIN_SHA256_CHUNKS_V1");
    expect(UPLOAD_FILE_IDENTITY_VERSION).toBe(1);
    expect(UPLOAD_FILE_IDENTITY_CHUNK_SIZE_BYTES).toBe(chunkSize);
    expect(UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES).toBe(50 * 1024 ** 3);
    expect(globalThis.crypto.subtle).toBeDefined();
    expect(webcrypto.subtle).toBeDefined();
  });

  it.each([
    [new Uint8Array([0]), "6c44ec7fa2adc2e586d90f8cb378e2cfe7c05c7ba4cf99a97467c909f467986c"],
    [
      new TextEncoder().encode("abc"),
      "59b99b9bc1f6f3bf3575ad578d98e147194ab16425a47f582dea43dc5db4b498",
    ],
  ] as const)("matches independent fixed small vector", async (bytes, rootSha256) => {
    expect(nodeOracle(bytes)).toBe(rootSha256);
    expect(await hashUploadFileIdentity(source(bytes), bytes.length)).toMatchObject({
      algorithm: UPLOAD_FILE_IDENTITY_ALGORITHM,
      version: 1,
      sizeBytes: bytes.length,
      chunkSizeBytes: chunkSize,
      leafCount: 1,
      rootSha256,
    });
    expect(createHash("sha256").update(bytes).digest("hex")).not.toBe(rootSha256);
  });

  it.each([
    [4194303, "685b4b33cd9414398cc28aa977fca7887c5e70fd307e2970ceb95ae4a2f2df70"],
    [4194304, "0be9826833824078f46fb4aa40cfa252c03b956e20d7415a5c41714f7b3ca7ad"],
    [4194305, "ac24a4c2d9449c94b3eac02f9267db0064e81f6c3a87ebd9c12ff94cf383f688"],
    [8388608, "e0fb3abbb1abdc5a7fc078a87cde4dc1c98393d8722bfa92b221a1a642c86f6c"],
    [8388745, "06ae86bc023892bbf7bb96b509ec4bf06c8116b57fe2711a3d9c3934d9267dcb"],
  ] as const)(
    "matches canonical vector for %i actual bytes independent of stream fragmentation",
    async (size, rootSha256) => {
      const bytes = deterministic(size);
      expect(nodeOracle(bytes)).toBe(rootSha256);
      expect((await hashUploadFileIdentity(source(bytes, 65537), size)).rootSha256).toBe(
        rootSha256,
      );
    },
  );

  it("distinguishes same-size replacements changed outside beginning/end samples", async () => {
    const bytes = deterministic(chunkSize * 2 + 137);
    const original = await hashUploadFileIdentity(source(bytes), bytes.length);
    bytes[chunkSize + 721]! ^= 1;
    const middle = await hashUploadFileIdentity(source(bytes), bytes.length);
    expect(middle.rootSha256).not.toBe(original.rootSha256);
    bytes[bytes.length - 1]! ^= 1;
    expect((await hashUploadFileIdentity(source(bytes), bytes.length)).rootSha256).not.toBe(
      middle.rootSha256,
    );
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 50 * 1024 ** 3 + 1])(
    "rejects invalid declared size %s before pulling bytes",
    async (size) => {
      let pulls = 0;
      const bytes = {
        async *[Symbol.asyncIterator]() {
          pulls++;
          yield new Uint8Array([1]);
        },
      };
      await expect(hashUploadFileIdentity(bytes, size)).rejects.toThrow();
      expect(pulls).toBe(0);
    },
  );

  it("requires exactly the declared bytes and checks exhaustion after the final leaf", async () => {
    await expect(hashUploadFileIdentity(source(new Uint8Array([1])), 2)).rejects.toThrow();
    await expect(hashUploadFileIdentity(source(new Uint8Array([1, 2])), 1)).rejects.toThrow();
    let pulls = 0;
    const extra = {
      async *[Symbol.asyncIterator]() {
        pulls++;
        yield new Uint8Array([1]);
        pulls++;
        yield new Uint8Array([2]);
        pulls++;
        yield new Uint8Array([3]);
      },
    };
    await expect(hashUploadFileIdentity(extra, 1)).rejects.toThrow();
    expect(pulls).toBe(2);
  });

  it("rejects non-byte and empty chunks instead of accepting metadata-only identity", async () => {
    async function* invalid() {
      yield "filename.mp4";
    }
    await expect(hashUploadFileIdentity(invalid() as never, 1)).rejects.toThrow();
    async function* empty() {
      yield new Uint8Array();
      yield new Uint8Array([1]);
    }
    await expect(hashUploadFileIdentity(empty(), 1)).rejects.toThrow();
  });

  it("aborts before reading and promptly while an iterator read is stalled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      hashUploadFileIdentity(source(new Uint8Array([1])), 1, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    const live = new AbortController();
    let returned = false;
    const stalled = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
          return: async () => {
            returned = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    const result = hashUploadFileIdentity(stalled, 1, { signal: live.signal });
    const rejected = expect(result).rejects.toThrow("stop stalled read");
    live.abort(new Error("stop stalled read"));
    await rejected;
    expect(returned).toBe(true);
  });

  it("never sends a whole large file to WebCrypto in one buffer", async () => {
    const bytes = deterministic(chunkSize * 2 + 137);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      expect(
        (await hashUploadFileIdentity(source(bytes, 3 * 1024 * 1024), bytes.length)).rootSha256,
      ).toBe(nodeOracle(bytes));
      expect(digest).toHaveBeenCalledTimes(4);
      expect(digest.mock.calls.map(([, input]) => input.byteLength).slice(0, 3)).toEqual([
        chunkSize,
        chunkSize,
        137,
      ]);
      expect(digest.mock.calls.at(-1)?.[1].byteLength).toBeLessThan(401 * 1024);
    } finally {
      digest.mockRestore();
    }
  });

  it("aborts a pending digest without pulling or hashing more content", async () => {
    const controller = new AbortController();
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementationOnce(() => new Promise<ArrayBuffer>(() => undefined));
    let pulls = 0;
    async function* bytes() {
      pulls++;
      yield new Uint8Array(chunkSize);
      pulls++;
      yield new Uint8Array([1]);
    }
    try {
      const pending = hashUploadFileIdentity(bytes(), chunkSize + 1, { signal: controller.signal });
      const rejected = expect(pending).rejects.toThrow("cancel digest");
      await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
      controller.abort(new Error("cancel digest"));
      await rejected;
      expect(pulls).toBe(1);
      expect(digest).toHaveBeenCalledOnce();
    } finally {
      digest.mockRestore();
    }
  });

  it("observes a digest rejection even when the signal aborts synchronously at digest creation", async () => {
    const controller = new AbortController();
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(() => {
      controller.abort(new Error("cancel immediately"));
      return Promise.reject(new Error("late digest failure"));
    });
    try {
      await expect(
        hashUploadFileIdentity(source(new Uint8Array([1])), 1, { signal: controller.signal }),
      ).rejects.toThrow("cancel immediately");
    } finally {
      digest.mockRestore();
    }
  });
});
