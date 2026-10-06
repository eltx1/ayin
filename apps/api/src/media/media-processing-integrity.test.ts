import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashUploadFileIdentity } from "@ayin/types";
import { afterEach, expect, it } from "vitest";
import {
  assertJobInputIntegrity,
  verifyJobInputFile,
  hasCurrentInputVerification,
} from "./media-processing-integrity.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "ayin-input-integrity-"));
  directories.push(directory);
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 17, 73);
  const identity = await hashUploadFileIdentity(
    (async function* () {
      yield bytes;
    })(),
    bytes.length,
  );
  const job = {
    inputIntegrityVersion: 1,
    inputIntegrityOwnerlessPlatform: false,
    inputIntegritySessionId: "session",
    inputIntegritySourceAssetId: "source",
    inputIntegrityAccountId: "account",
    inputIntegrityAlgorithm: identity.algorithm,
    inputIntegrityDigest: identity.rootSha256,
    inputIntegrityParentJobId: null,
    sourceSizeBytes: BigInt(bytes.length),
    inputR2ObjectKey: "source.mov",
    attempt: 2,
    inputVerifiedAt: null,
    inputVerifiedLeaseOwner: null,
    inputVerifiedAttempt: null,
  };
  const path = join(directory, "input.mov");
  await writeFile(path, bytes);
  return { bytes, identity, job, path };
}
it("hashes every downloaded byte using the shared chunk-root contract", async () => {
  const f = await fixture();
  expect(await verifyJobInputFile(f.job, f.path)).toEqual(f.identity);
});
for (const offset of [3 * 1024 * 1024, 4 * 1024 * 1024 + 16])
  it(`rejects same-size corruption at ${offset}`, async () => {
    const f = await fixture();
    f.bytes[offset] = f.bytes[offset]! ^ 1;
    await writeFile(f.path, f.bytes);
    await expect(verifyJobInputFile(f.job, f.path)).rejects.toThrow(/integrity/i);
  });
for (const delta of [-1, 1])
  it(`rejects incorrect source length ${delta}`, async () => {
    const f = await fixture();
    await writeFile(f.path, Buffer.alloc(f.bytes.length + delta));
    await expect(verifyJobInputFile(f.job, f.path)).rejects.toThrow();
  });
it("explicitly preserves legacy contracts and rejects missing required declaration or unknown version", async () => {
  const f = await fixture();
  expect(
    assertJobInputIntegrity({
      ...f.job,
      inputIntegrityVersion: 0,
      inputIntegrityOwnerlessPlatform: null,
      inputIntegrityDigest: null,
      inputIntegritySessionId: null,
      inputIntegritySourceAssetId: null,
      inputIntegrityAccountId: null,
      inputIntegrityAlgorithm: null,
    }),
  ).toBeNull();
  expect(() => assertJobInputIntegrity({ ...f.job, inputIntegrityDigest: null })).toThrow(
    /integrity/i,
  );
  expect(() => assertJobInputIntegrity({ ...f.job, inputIntegrityVersion: 9 })).toThrow(/version/i);
});
it("requires the current claim and attempt, not a previous verification", async () => {
  const f = await fixture();
  const verified = {
    ...f.job,
    inputVerifiedAt: new Date(),
    inputVerifiedLeaseOwner: "claim",
    inputVerifiedAttempt: 2,
  };
  expect(hasCurrentInputVerification(verified, "claim")).toBe(true);
  expect(hasCurrentInputVerification(verified, "other")).toBe(false);
  expect(hasCurrentInputVerification({ ...verified, attempt: 3 }, "claim")).toBe(false);
});
it("cancels byte verification", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort(new Error("lease lost"));
  await expect(verifyJobInputFile(f.job, f.path, controller.signal)).rejects.toThrow("lease lost");
});
