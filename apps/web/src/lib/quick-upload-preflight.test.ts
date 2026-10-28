import { afterEach, describe, expect, it, vi } from "vitest";
import { getUploadCapabilities, verifyUploadIdentity } from "./quick-upload";
import { UploadProtocolError } from "./upload-session";
import {
  isRejectedUploadRequest,
  readUploadRequestError,
  uploadErrorMessage,
  UploadRequestError,
} from "./upload-error";
import { uploadText } from "./upload-copy";

const accountId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const limits = {
  actorAccountId: accountId,
  channelId,
  maxFileSizeBytes: 5 * 1024 ** 3,
  channelQuotaBytes: 50 * 1024 ** 3,
  usedStorageBytes: 1024,
  availableStorageBytes: 50 * 1024 ** 3 - 1024,
  multipartThresholdBytes: 32 * 1024 ** 2,
  partSizeBytes: 16 * 1024 ** 2,
  uploadSessionTtlSeconds: 86400,
  storageAvailable: true,
  durableRecovery: { supported: true, maxFileSizeBytes: 5 * 1024 ** 3 },
};
afterEach(() => vi.unstubAllGlobals());
function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("upload eligibility and account binding", () => {
  it("accepts durable recovery up to the authenticated 5 GiB upload limit", async () => {
    const fetch = respond(limits);
    expect(await getUploadCapabilities(accountId, channelId)).toMatchObject({
      maxFileSizeBytes: 5 * 1024 ** 3,
      availableStorageBytes: limits.availableStorageBytes,
      durableRecovery: { supported: true, maxFileSizeBytes: 5 * 1024 ** 3 },
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  });
  it.each([
    { channelId: accountId },
    { actorAccountId: channelId },
    { maxFileSizeBytes: -1 },
    { partSizeBytes: 0 },
    { availableStorageBytes: 1.5 },
    { storageAvailable: "true" },
    { durableRecovery: { supported: "true", maxFileSizeBytes: 5 * 1024 ** 3 } },
    { durableRecovery: { supported: true, maxFileSizeBytes: null } },
    { durableRecovery: { supported: true, maxFileSizeBytes: -1 } },
    { durableRecovery: { supported: false, maxFileSizeBytes: 1024 } },
  ])("rejects mismatched or malformed admission data %j", async (change) => {
    respond({ ...limits, ...change });
    await expect(getUploadCapabilities(accountId, channelId)).rejects.toBeInstanceOf(
      UploadProtocolError,
    );
  });
  it("requires the original account and channel after signing in again", async () => {
    respond({ account: { id: accountId }, channel: { id: channelId } });
    await expect(verifyUploadIdentity(accountId, channelId)).resolves.toBeUndefined();
    respond({ account: { id: channelId }, channel: { id: accountId } });
    await expect(verifyUploadIdentity(accountId, channelId)).rejects.toMatchObject({
      code: "UPLOAD_ACCOUNT_CHANGED",
      status: 401,
    });
  });
});
describe("actionable upload failures", () => {
  it("preserves server error codes without turning uncertain errors into safe rejections", async () => {
    const error = await readUploadRequestError(
      new Response(
        JSON.stringify({
          error: { code: "CHANNEL_UPLOAD_QUOTA_REACHED", message: "Quota reached" },
        }),
        { status: 409 },
      ),
    );
    expect(error).toMatchObject({ code: "CHANNEL_UPLOAD_QUOTA_REACHED", status: 409 });
    expect(isRejectedUploadRequest(error)).toBe(true);
    expect(isRejectedUploadRequest(new TypeError("Connection reset"))).toBe(false);
    expect(isRejectedUploadRequest(new UploadRequestError("Unknown commit", 503))).toBe(false);
  });
  it.each([
    ["INVALID_UPLOAD_SESSION", 401, "expired"],
    ["STEP_UP_REQUIRED", 401, "administrator"],
    ["STEP_UP_REQUIRED", 403, "administrator"],
    ["UPLOAD_ACCOUNT_CHANGED", 401, "account that started"],
    ["AUTHENTICATION_REQUIRED", 401, "new tab"],
    ["CHANNEL_UPLOAD_QUOTA_REACHED", 409, "storage"],
  ] as const)("gives specific, localized recovery for %s (%s)", (code, status, expected) => {
    const message = uploadErrorMessage(
      new UploadRequestError("Opaque backend error", status, code),
    )!;
    expect(message).toContain(expected);
    expect(uploadText(message, "ar")).toMatch(/[\u0600-\u06ff]/);
  });
});
