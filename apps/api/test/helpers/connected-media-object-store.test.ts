import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import { R2MediaStorageAdapter } from "../../src/media/r2-media-storage.adapter.js";
import { R2SigV4 } from "../../src/media/r2-sigv4.js";
import type { MediaStorageConfig } from "../../src/media/media-storage.config.js";
import { ConnectedMediaObjectStore } from "./connected-media-object-store.js";

const fixture = new ConnectedMediaObjectStore();
const channelId = randomUUID();
const key = `channels/${channelId}/media/${randomUUID()}/source.mp4`;
let storage: R2MediaStorageAdapter;
let signer: R2SigV4;
let config: MediaStorageConfig;

beforeAll(async () => {
  config = {
    ...(await fixture.start()),
    appEnv: "test",
    mode: "r2",
    accountId: "fixture",
    region: "auto",
    partSizeBytes: 5 * 1024 * 1024,
    multipartThresholdBytes: 5 * 1024 * 1024,
    uploadUrlTtlSeconds: 60,
    uploadSessionSecret: "fixture-test-only-secret-longer-than32",
  };
  fixture.allowedChannels.add(channelId);
  storage = new R2MediaStorageAdapter(config);
  signer = new R2SigV4(config);
});
afterAll(async () => fixture.close());

it("accepts actual signed wire PUT/HEAD/GET/DELETE and returns exact public ranges", async () => {
  const bytes = Buffer.from("actual independent HTTP object bytes");
  const grant = await storage.authorizeSinglePut({
    key,
    contentType: "video/mp4",
    expiresInSeconds: 60,
  });
  const put = await fetch(grant.url, {
    method: "PUT",
    headers: { "content-type": "video/mp4" },
    body: bytes,
  });
  expect(put.status).toBe(200);
  expect(await storage.headObject(key)).toMatchObject({
    sizeBytes: bytes.length,
    contentType: "video/mp4",
  });
  const downloaded = await signer.request({ method: "GET", key });
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
  const range = await fetch(fixture.publicUrl(key), { headers: { range: "bytes=2-8" } });
  expect(range.status).toBe(206);
  expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(2, 9));
  await storage.deleteObject(key);
  expect((await fetch(fixture.publicUrl(key))).status).toBe(404);
  expect(fixture.objects.size).toBe(0);
});

it("rejects a changed signed Content-Type, signature, unregistered channel and unsigned provider read", async () => {
  const grant = await storage.authorizeSinglePut({
    key,
    contentType: "video/mp4",
    expiresInSeconds: 60,
  });
  expect(
    (
      await fetch(grant.url, {
        method: "PUT",
        headers: { "content-type": "video/quicktime" },
        body: "wrong mime",
      })
    ).status,
  ).toBe(403);
  const changed = new URL(grant.url);
  changed.searchParams.set("X-Amz-Signature", "0".repeat(64));
  expect(
    (
      await fetch(changed, {
        method: "PUT",
        headers: { "content-type": "video/mp4" },
        body: "wrong signature",
      })
    ).status,
  ).toBe(403);
  const unregistered = await storage.authorizeSinglePut({
    key: `channels/${randomUUID()}/media/source.mp4`,
    contentType: "video/mp4",
    expiresInSeconds: 60,
  });
  expect(
    (
      await fetch(unregistered.url, {
        method: "PUT",
        headers: { "content-type": "video/mp4" },
        body: "wrong namespace",
      })
    ).status,
  ).toBe(404);
  expect((await fetch(`${config.endpoint}/${config.bucket}/${key}`)).status).toBe(403);
  expect(fixture.objects.size).toBe(0);
});
