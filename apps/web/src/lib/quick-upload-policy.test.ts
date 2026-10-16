import { afterEach, describe, expect, it, vi } from "vitest";
import { parseQuickUploadPolicy, readQuickUploadPolicy } from "./quick-upload-policy";
import { requestAccountScope } from "./account-scope";

const account = "11111111-1111-4111-8111-111111111111";
const policy = {
  maxFileSizeBytes: 1024,
  sessionLifetimeSeconds: 900,
  reloadResumeSupported: false,
};
afterEach(() => vi.unstubAllGlobals());

describe("server-authoritative standard upload policy", () => {
  it("accepts positive safe integers without inventing a separate upload cap", () => {
    expect(parseQuickUploadPolicy(policy)).toEqual(policy);
    expect(
      parseQuickUploadPolicy({ ...policy, maxFileSizeBytes: Number.MAX_SAFE_INTEGER }),
    ).toEqual({ ...policy, maxFileSizeBytes: Number.MAX_SAFE_INTEGER });
  });
  it.each([
    null,
    {},
    [],
    { ...policy, maxFileSizeBytes: 0 },
    { ...policy, maxFileSizeBytes: -1 },
    { ...policy, maxFileSizeBytes: 1.5 },
    { ...policy, maxFileSizeBytes: "1024" },
    { ...policy, maxFileSizeBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...policy, sessionLifetimeSeconds: 0 },
    { ...policy, sessionLifetimeSeconds: Infinity },
    { ...policy, reloadResumeSupported: true },
  ])("rejects a malformed or incompatible policy %j", (value) => {
    expect(() => parseQuickUploadPolicy(value)).toThrow();
  });
  it("checks the account before and after reading the private bounded policy", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/me")) return Response.json({ account: { id: account } });
      expect(url).toMatch(/\/media\/uploads\/policy$/);
      expect(init?.headers).toMatchObject({ "x-ayin-expected-account": account });
      expect(init?.cache).toBe("no-store");
      return Response.json(policy);
    });
    vi.stubGlobal("fetch", fetch);
    await expect(readQuickUploadPolicy(account, new AbortController().signal)).resolves.toEqual(
      policy,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects policy publication if the account changes during the read", async () => {
    let identities = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/auth/me"))
          return Response.json({
            account: { id: ++identities === 1 ? account : "22222222-2222-4222-8222-222222222222" },
          });
        return Response.json(policy);
      }),
    );
    await expect(
      readQuickUploadPolicy(account, new AbortController().signal),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
  });
  it("does not broaden account transport to media writes or other media reads", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      requestAccountScope("/media/uploads/policy", "POST", (value) => value),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      requestAccountScope("/media/uploads/sessions", "GET", (value) => value),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
