import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoverableUploadSession, UploadFileIdentity } from "@ayin/types";
import { UploadRecoveryClient, type RecoveryView } from "./upload-recovery";
import {
  parseRecoveryInspection,
  parseRecoveryResponse,
  parseRecoverySession,
  type RecoveryScope,
  type SavedRecovery,
} from "./upload-recovery-contract";
import { RECOVERY_STORAGE_KEY, loadSavedRecovery, saveRecovery } from "./upload-recovery-storage";

const scope: RecoveryScope = {
  accountId: randomUUID(),
  profileId: randomUUID(),
  channelId: randomUUID(),
};
const session: RecoverableUploadSession = {
  protocolVersion: 1,
  actorAccountId: scope.accountId,
  channelId: scope.channelId,
  sessionId: randomUUID(),
  assetId: randomUUID(),
  videoId: randomUUID(),
  state: "OPEN",
  revision: 1,
  mode: "SINGLE",
  sizeBytes: 3,
  mimeType: "video/mp4",
  partSizeBytes: 5 * 1024 * 1024,
  partCount: 1,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};
const fileIdentity: UploadFileIdentity = {
  algorithm: "AYIN_SHA256_CHUNKS_V1",
  version: 1,
  sizeBytes: 3,
  chunkSizeBytes: 4 * 1024 * 1024,
  leafCount: 1,
  rootSha256: "59b99b9bc1f6f3bf3575ad578d98e147194ab16425a47f582dea43dc5db4b498",
};
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function envelope(requestId: string, extra: Record<string, unknown> = {}) {
  return { session, operation: { requestId, status: "SUCCEEDED", replayed: false }, ...extra };
}
function saved(extra: Partial<SavedRecovery> = {}): SavedRecovery {
  return { version: 1, scope, creationRequestId: randomUUID(), session, pending: null, ...extra };
}

describe("recovery boundary and persistence", () => {
  it("persists an allowlist, never grant URLs, file identity, bytes, credentials or provider IDs", () => {
    const storage = new MemoryStorage();
    const dirty = {
      ...saved(),
      grant: { url: "https://private.invalid/signed" },
      fileIdentity,
      file: new File(["abc"], "secret.mp4"),
      providerUploadId: "provider-secret",
      credentials: "token",
      session: { ...session, objectKey: "private-key" },
    };
    saveRecovery(storage, dirty);
    const value = storage.getItem(RECOVERY_STORAGE_KEY)!;
    for (const forbidden of [
      "private.invalid",
      "fileIdentity",
      "rootSha256",
      "secret.mp4",
      "provider-secret",
      "token",
      "objectKey",
      "private-key",
    ])
      expect(value).not.toContain(forbidden);
    expect(loadSavedRecovery(storage, scope)?.session).toEqual(session);
  });
  it.each(["accountId", "profileId", "channelId"] as const)(
    "clears a descriptor from another %s",
    (field) => {
      const storage = new MemoryStorage();
      saveRecovery(storage, saved());
      expect(loadSavedRecovery(storage, { ...scope, [field]: randomUUID() })).toBeNull();
      expect(storage.length).toBe(0);
    },
  );
  it.each(["not-json", "x".repeat(9000), JSON.stringify({ version: 2 })])(
    "discards corrupted or unsupported saved state",
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem(RECOVERY_STORAGE_KEY, raw);
      expect(loadSavedRecovery(storage, scope)).toBeNull();
      expect(storage.length).toBe(0);
    },
  );
  it("rejects mismatched actor, regressed revision, changed expiration and invalid part geometry", () => {
    for (const mutation of [
      { actorAccountId: randomUUID() },
      { revision: 0 },
      { expiresAt: new Date(Date.now() + 99_000).toISOString() },
      { partCount: 2 },
      { protocolVersion: 2 },
      { sizeBytes: NaN },
    ])
      expect(() => parseRecoverySession({ ...session, ...mutation }, scope, session)).toThrow();
  });
  it("rejects grants on a replay/outcome read and provider credential headers", () => {
    const requestId = randomUUID(),
      grant = {
        url: "https://provider.invalid/signed",
        method: "PUT",
        headers: {},
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        partNumber: 1,
      };
    expect(() =>
      parseRecoveryResponse(envelope(requestId, { grant }), scope, requestId, session),
    ).toThrow();
    expect(() =>
      parseRecoveryResponse(
        envelope(requestId, {
          grant,
          operation: { requestId, status: "SUCCEEDED", replayed: true },
        }),
        scope,
        requestId,
        session,
        1,
      ),
    ).toThrow();
    expect(() =>
      parseRecoveryResponse(
        envelope(requestId, { grant: { ...grant, headers: { authorization: "secret" } } }),
        scope,
        requestId,
        session,
        1,
      ),
    ).toThrow();
    expect(
      parseRecoveryResponse(envelope(requestId, { grant }), scope, requestId, session, 1).grant
        ?.url,
    ).toBe(grant.url);
  });
  it("rejects duplicate/oversized/wrong-size provider observations", () => {
    const multipart = {
      ...session,
      mode: "MULTIPART" as const,
      sizeBytes: 11,
      partSizeBytes: 5,
      partCount: 3,
    };
    for (const parts of [
      [
        { partNumber: 1, sizeBytes: 5 },
        { partNumber: 1, sizeBytes: 5 },
      ],
      [{ partNumber: 3, sizeBytes: 5 }],
      [{ partNumber: 4, sizeBytes: 1 }],
    ])
      expect(() =>
        parseRecoveryInspection(
          { ...multipart, observation: { kind: "PARTS_OBSERVED", parts, uploadedBytes: 10 } },
          scope,
          multipart,
        ),
      ).toThrow();
  });
});

describe("explicit recoverable upload controller", () => {
  let storage: MemoryStorage, view: RecoveryView, fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let state: RecoverableUploadSession, identityScope: RecoveryScope;
  let observation: Record<string, unknown>;
  beforeEach(() => {
    storage = new MemoryStorage();
    state = { ...session };
    identityScope = { ...scope };
    observation = { kind: "UNAVAILABLE", reason: "NOT_FOUND" };
    fetcher = vi.fn(async (input, init) => {
      const path = String(input),
        payload = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (path.endsWith("/auth/me"))
        return response({
          account: { id: identityScope.accountId },
          channel: { id: identityScope.channelId },
          profile: { id: identityScope.profileId },
        });
      if (path.endsWith("/capability"))
        return response({ protocolVersion: 1, supported: true, reason: null });
      if (path.endsWith("/auth/sessions"))
        return response({ sessions: [{ id: scope.profileId, current: true }] });
      if (path.endsWith("/inspection")) return response({ ...state, observation });
      if (path.includes("/operations/") || (!payload && path.includes("/recoverable-drafts/")))
        return response(
          envelope(path.split("/").at(-1)!, {
            session: state,
            operation: { requestId: path.split("/").at(-1), status: "SUCCEEDED", replayed: true },
          }),
        );
      if (path.endsWith("/authorize"))
        return response(
          envelope(payload.requestId, {
            session: state,
            grant: {
              url: "https://provider.invalid/signed-once",
              method: "PUT",
              headers: { "content-type": "video/mp4" },
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              partNumber: 1,
            },
          }),
          201,
        );
      if (path.startsWith("https://provider.invalid")) {
        observation = { kind: "STORED_UNVERIFIED", sizeBytes: 3 };
        return new Response(null, { status: 200 });
      }
      if (path.endsWith("/complete")) state = { ...state, state: "COMPLETED", revision: 3 };
      if (path.endsWith("/cancel"))
        state = { ...state, state: "ABORTED", revision: state.revision + 1 };
      if (payload)
        return response(
          envelope(payload.requestId, {
            session: state,
            ...(state.state === "ABORTED"
              ? { cleanup: { authorityRevoked: true, settlement: "PENDING" } }
              : {}),
          }),
          201,
        );
      throw Error(`Unexpected URL ${path}`);
    });
  });
  function client(identify = vi.fn(async () => fileIdentity)) {
    return new UploadRecoveryClient({
      storage,
      fetch: fetcher,
      identify,
      changed: (next) => {
        view = next;
      },
    });
  }
  const file = () => new File(["abc"], "camera.mp4", { type: "video/mp4", lastModified: 123 });
  const writes = () =>
    fetcher.mock.calls.filter(([, init]) => ["POST", "PUT"].includes(init?.method ?? ""));
  async function ready(value: UploadRecoveryClient) {
    await value.open();
    await value.choose(file());
    await value.create();
    await value.inspect();
  }
  async function multipartFixture(
    options: {
      observe?: boolean;
      unknown?: boolean;
      put?: (signal: AbortSignal, partNumber: number) => Promise<void>;
    } = {},
  ) {
    state = { ...session, mode: "MULTIPART", sizeBytes: 11, partSizeBytes: 5, partCount: 3 };
    saveRecovery(storage, saved({ session: state }));
    observation = { kind: "PARTS_OBSERVED", parts: [], uploadedBytes: 0 };
    const normal = fetcher.getMockImplementation()!,
      parts = new Map<number, number>(),
      bodies: string[] = [];
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/authorize")) {
        const body = JSON.parse(String(init?.body));
        expect(new Headers(init?.headers).get("x-ayin-expected-account")).toBe(scope.accountId);
        expect(new Headers(init?.headers).get("x-ayin-expected-session")).toBe(scope.profileId);
        if (options.unknown) {
          state = { ...state, state: "UNRESOLVED", revision: 2 };
          return response(
            envelope(body.requestId, {
              session: state,
              operation: { requestId: body.requestId, status: "UNKNOWN", replayed: false },
            }),
            201,
          );
        }
        return response(
          envelope(body.requestId, {
            session: state,
            grant: {
              url: `https://provider.invalid/part/${body.partNumber}`,
              method: "PUT",
              headers: {},
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              partNumber: body.partNumber,
            },
          }),
          201,
        );
      }
      if (String(url).startsWith("https://provider.invalid/part/")) {
        const partNumber = Number(String(url).split("/").at(-1));
        const body = init?.body as Blob;
        bodies.push(await body.text());
        await options.put?.(init!.signal!, partNumber);
        if (options.observe !== false) {
          parts.set(partNumber, body.size);
          observation = {
            kind: "PARTS_OBSERVED",
            parts: [...parts].map(([partNumber, sizeBytes]) => ({ partNumber, sizeBytes })),
            uploadedBytes: [...parts.values()].reduce((sum, size) => sum + size, 0),
          };
        }
        return new Response(null, { status: 200 });
      }
      return normal(url, init);
    });
    const value = client(vi.fn(async () => ({ ...fileIdentity, sizeBytes: 11 })));
    await value.open();
    await value.choose(new File(["0123456789a"], "whole.mp4", { type: "video/mp4" }));
    return { value, bodies };
  }
  it("one Continue intent verifies the file and sends all missing parts with distinct grants, progress and no implicit completion", async () => {
    const { value, bodies } = await multipartFixture();
    await value.continueUpload();
    expect(bodies).toEqual(["01234", "56789", "a"]);
    const authorizations = writes().filter(([url]) => String(url).endsWith("/authorize"));
    expect(authorizations).toHaveLength(3);
    expect(
      new Set(authorizations.map(([, init]) => JSON.parse(String(init?.body)).requestId)).size,
    ).toBe(3);
    expect(view.uploadProgress).toBe(100);
    expect(view.message).toBe("READY_COMPLETE");
    expect(value.canComplete()).toBe(true);
    expect(writes().some(([url]) => String(url).endsWith("/complete"))).toBe(false);
  });
  it("duplicate Continue clicks share one operation latch across the entire transfer", async () => {
    let release!: () => void,
      entered = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { value, bodies } = await multipartFixture({
      put: async (_signal, part) => {
        if (part === 1) {
          entered = true;
          await held;
        }
      },
    });
    const first = value.continueUpload();
    await vi.waitFor(() => expect(entered).toBe(true));
    await value.continueUpload();
    expect(bodies).toHaveLength(1);
    release();
    await first;
    expect(bodies).toEqual(["01234", "56789", "a"]);
  });
  it("an acknowledged PUT with no observed forward progress stops instead of authorizing the same part again", async () => {
    const { value, bodies } = await multipartFixture({ observe: false });
    await value.continueUpload();
    expect(bodies).toEqual(["01234"]);
    expect(writes().filter(([url]) => String(url).endsWith("/authorize"))).toHaveLength(1);
    expect(view.message).toBe("TRANSFER_UNCERTAIN");
    expect(value.canComplete()).toBe(false);
  });
  it("UNKNOWN authorization halts the Continue intent before bytes or another part", async () => {
    const { value, bodies } = await multipartFixture({ unknown: true });
    await value.continueUpload();
    expect(bodies).toHaveLength(0);
    expect(writes().filter(([url]) => String(url).endsWith("/authorize"))).toHaveLength(1);
    expect(view.saved?.pending?.kind).toBe("AUTHORIZE");
    expect(view.message).toBe("UNCERTAIN");
  });
  it("Stop aborts the active part, retains its uncertain marker and dispatches no remaining parts", async () => {
    let entered = false;
    const { value, bodies } = await multipartFixture({
      put: (signal) =>
        new Promise<void>((_resolve, reject) => {
          entered = true;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });
    const transfer = value.continueUpload();
    await vi.waitFor(() => expect(entered).toBe(true));
    value.stop();
    await transfer;
    expect(bodies).toEqual(["01234"]);
    expect(view.saved?.pending?.kind).toBe("AUTHORIZE");
    expect(view.message).toBe("STOPPED");
  });
  it("a changed viewer after a part prevents any subsequent grant in that Continue intent", async () => {
    const { value, bodies } = await multipartFixture({
      put: async () => {
        identityScope.profileId = randomUUID();
      },
    });
    await value.continueUpload();
    expect(bodies).toEqual(["01234"]);
    expect(view.scope).toBeNull();
    expect(storage.length).toBe(0);
  });
  it("an unverifiable current identity conceals facts while retaining the safe marker for later verification", async () => {
    const value = client();
    await ready(value);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).endsWith("/auth/me")
        ? Promise.resolve(response({ error: { code: "TEMPORARILY_UNAVAILABLE" } }, 503))
        : normal(url, init),
    );
    const before = writes().length;
    await value.continueUpload();
    expect(view.scope).toBeNull();
    expect(view.fileName).toBeNull();
    expect(view.saved).toBeNull();
    expect(storage.length).toBe(1);
    expect(writes()).toHaveLength(before);
    expect(view.message).toBe("AUTHORITY_UNVERIFIED");
  });
  it("Check saved upload inspects the descriptor while preserving a currently selected file", async () => {
    const value = client();
    await ready(value);
    await value.check();
    expect(view.fileName).toBe("camera.mp4");
    expect(view.inspection).not.toBeNull();
    expect(writes()).toHaveLength(1);
  });
  it("uses only explicit writes; a provider send requires fresh inspection before completion", async () => {
    const value = client();
    await value.open();
    expect(writes()).toHaveLength(0);
    await value.choose(file());
    expect(writes()).toHaveLength(0);
    await value.create();
    expect(writes()).toHaveLength(1);
    await value.inspect();
    await value.uploadNext();
    expect(writes().map(([url]) => String(url).split("/").at(-1))).toEqual([
      "recoverable-drafts",
      "authorize",
      "signed-once",
    ]);
    expect(value.canComplete()).toBe(false);
    await value.inspect();
    expect(value.canComplete()).toBe(true);
    await value.complete();
    expect(view.message).toBe("COMPLETED");
    expect(storage.getItem(RECOVERY_STORAGE_KEY)).not.toContain("signed-once");
  });
  it("binds the native browser fetch receiver instead of invoking it as a controller method", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown, input, init) {
      expect(this).toBe(globalThis);
      return fetcher(input, init);
    };
    try {
      const value = new UploadRecoveryClient({
        storage,
        changed: (next) => {
          view = next;
        },
      });
      await value.open();
      expect(view.scope).toEqual(scope);
    } finally {
      globalThis.fetch = original;
    }
  });
  it("fences initial held account A read before the session endpoint can observe rotated account B", async () => {
    saveRecovery(storage, saved());
    const localReads = vi.spyOn(storage, "getItem");
    localReads.mockClear();
    const published: RecoveryView[] = [];
    const value = new UploadRecoveryClient({
      storage,
      fetch: fetcher,
      changed: (next) => {
        view = next;
        published.push(next);
      },
    });
    const normal = fetcher.getMockImplementation()!;
    let release!: () => void,
      captured = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/auth/me") && !captured) {
        captured = true;
        const original = response({
          account: { id: scope.accountId },
          channel: { id: scope.channelId },
          profile: { id: scope.profileId },
        });
        await held;
        return original;
      }
      if (String(url).endsWith("/auth/sessions")) {
        expect(new Headers(init?.headers).get("x-ayin-expected-account")).toBe(scope.accountId);
        return response({ error: { code: "ACCOUNT_CHANGED" } }, 409);
      }
      return normal(url, init);
    });
    const opening = value.open();
    await vi.waitFor(() => expect(captured).toBe(true));
    identityScope = { accountId: randomUUID(), profileId: randomUUID(), channelId: randomUUID() };
    release();
    await opening;
    expect(localReads).not.toHaveBeenCalled();
    expect(published.every((entry) => entry.scope === null && entry.saved === null)).toBe(true);
    expect(view.message).toBe("AUTHORITY_CHANGED");
    expect(storage.length).toBe(0);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/capability"))).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  it("the final initial-identity read rejects a same-account profile change before loading saved facts", async () => {
    saveRecovery(storage, saved());
    const localReads = vi.spyOn(storage, "getItem");
    localReads.mockClear();
    const value = client(),
      normal = fetcher.getMockImplementation()!;
    let me = 0;
    fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith("/auth/me") && ++me === 2) identityScope.profileId = randomUUID();
      if (me > 0 && !String(url).endsWith("/auth/me"))
        expect(new Headers(init?.headers).get("x-ayin-expected-account")).toBe(scope.accountId);
      return normal(url, init);
    });
    await value.open();
    expect(localReads).not.toHaveBeenCalled();
    expect(view.scope).toBeNull();
    expect(view.saved).toBeNull();
    expect(storage.length).toBe(0);
  });
  it.each(["accountId", "profileId"] as const)(
    "verified viewer %s invalidation aborts work and discards another scope's marker without restoring facts",
    async (field) => {
      const value = client();
      await ready(value);
      const before = fetcher.mock.calls.length;
      value.suspend({ ...scope, [field]: randomUUID() });
      expect(view.scope).toBeNull();
      expect(view.saved).toBeNull();
      expect(view.fileName).toBeNull();
      expect(storage.length).toBe(0);
      expect(fetcher.mock.calls).toHaveLength(before);
    },
  );
  it("reload requires full file reselection and server identity verification before a grant", async () => {
    const first = client();
    await ready(first);
    first.suspend();
    const second = client();
    await second.open();
    await second.inspect();
    expect(view.fileName).toBeNull();
    expect(view.fileMatched).toBe(false);
    const before = writes().length;
    await second.uploadNext();
    expect(writes()).toHaveLength(before);
    await second.choose(file());
    await second.inspect();
    await second.resume();
    expect(view.fileMatched).toBe(true);
    expect(JSON.parse(String(writes().at(-1)?.[1]?.body)).fileIdentity).toEqual(fileIdentity);
  });
  it("looks up lost CREATE after reload, never resubmits it or uses V1", async () => {
    const value = client();
    await value.open();
    await value.choose(file());
    fetcher
      .mockImplementationOnce(async () =>
        response({
          account: { id: scope.accountId },
          channel: { id: scope.channelId },
          profile: { id: scope.profileId },
        }),
      )
      .mockImplementationOnce(async () => {
        throw Error("Lost create response");
      });
    await value.create();
    expect(view.saved?.pending?.kind).toBe("CREATE");
    const before = writes().length;
    value.suspend();
    const reopened = client();
    await reopened.open();
    await reopened.inspect();
    expect(view.saved?.session?.sessionId).toBe(session.sessionId);
    expect(writes()).toHaveLength(before);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/creator/videos/drafts"))).toBe(
      false,
    );
  });
  it("UNKNOWN authorize never retries signing or reuses a grant; cancellation stays explicit", async () => {
    const value = client();
    await ready(value);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/authorize") || String(url).includes("/operations/")) {
        const requestId = init?.body
          ? JSON.parse(String(init.body)).requestId
          : String(url).split("/").at(-1);
        state = { ...state, state: "UNRESOLVED", revision: 2 };
        return response(
          envelope(requestId, {
            session: state,
            operation: { requestId, status: "UNKNOWN", replayed: init?.method === "GET" },
          }),
        );
      }
      return normal(url, init);
    });
    await value.uploadNext();
    const before = writes().length;
    await value.inspect();
    await value.uploadNext();
    expect(writes()).toHaveLength(before);
    expect(view.saved?.pending?.kind).toBe("AUTHORIZE");
    await value.cancel();
    expect(view.message).toBe("CANCELLED_PENDING");
  });
  it("404 outcome stays uncertain and never authorizes new creation", async () => {
    saveRecovery(
      storage,
      saved({ session: null, pending: { kind: "CREATE", requestId: randomUUID() } }),
    );
    const value = client();
    await value.open();
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).includes("/recoverable-drafts/")
        ? Promise.resolve(response({ error: { code: "UPLOAD_RECOVERY_NOT_FOUND" } }, 404))
        : normal(url, init),
    );
    await value.inspect();
    await value.choose(file());
    await value.create();
    expect(writes()).toHaveLength(0);
    expect(view.saved?.pending?.kind).toBe("CREATE");
  });
  it("storage failure prevents dispatch", async () => {
    const value = client();
    await value.open();
    await value.choose(file());
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });
    await value.create();
    expect(writes()).toHaveLength(0);
  });
  it("wrong original bytes are a definitive rejection, allowing another reselection without replay", async () => {
    saveRecovery(storage, saved());
    const value = client();
    await value.open();
    await value.choose(file());
    await value.inspect();
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).endsWith("/resume")
        ? Promise.resolve(response({ error: { code: "UPLOAD_FILE_CHANGED" } }, 409))
        : normal(url, init),
    );
    await value.resume();
    expect(view.fileMatched).toBe(false);
    expect(view.saved?.pending).toBeNull();
    expect(view.message).toBe("UPLOAD_FILE_CHANGED");
    expect(writes()).toHaveLength(1);
  });
  it.each(["accountId", "profileId", "channelId"] as const)(
    "invalidates all local authority on a %s transition",
    async (field) => {
      const value = client();
      await ready(value);
      identityScope[field] = randomUUID();
      const before = writes().length;
      await value.uploadNext();
      expect(writes()).toHaveLength(before);
      expect(view.scope).toBeNull();
      expect(view.fileName).toBeNull();
      expect(storage.length).toBe(0);
    },
  );
  it("stale hashing completion after suspension cannot restore file or authority", async () => {
    let finish!: (identity: UploadFileIdentity) => void;
    const identify = vi.fn(
      () =>
        new Promise<UploadFileIdentity>((resolve) => {
          finish = resolve;
        }),
    );
    const value = client(identify);
    await value.open();
    const choosing = value.choose(file());
    await vi.waitFor(() => expect(identify).toHaveBeenCalledOnce());
    value.suspend();
    finish(fileIdentity);
    await choosing;
    expect(view.scope).toBeNull();
    expect(view.fileName).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  it("serializes repeated clicks and disables unavailable admission without V1 fallback", async () => {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).endsWith("/capability")
        ? Promise.resolve(response({ protocolVersion: 1, supported: false, reason: "UNSUPPORTED" }))
        : normal(url, init),
    );
    const value = client();
    await Promise.all([value.open(), value.open()]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/capability"))).toHaveLength(
      1,
    );
    await value.choose(file());
    await value.create();
    expect(view.supported).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  it("same-account session switch clears the descriptor and binds requests to the original login", async () => {
    const value = client();
    await ready(value);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => {
      expect(new Headers(init?.headers).get("x-ayin-expected-session")).toBe(scope.profileId);
      return String(url).endsWith("/auth/me")
        ? Promise.resolve(response({ error: { code: "SESSION_CHANGED" } }, 409))
        : normal(url, init);
    });
    const before = writes().length;
    await value.uploadNext();
    expect(writes()).toHaveLength(before);
    expect(storage.length).toBe(0);
    expect(view.message).toBe("AUTHORITY_CHANGED");
  });
  it("never trusts persisted terminal state without a fresh server outcome", async () => {
    saveRecovery(storage, saved({ session: { ...session, state: "COMPLETED" } }));
    const value = client();
    await value.open();
    expect(view.message).toBe("SAVED");
    value.forgetFinished();
    expect(storage.length).toBe(1);
    await value.inspect();
    expect(view.saved?.session?.state).toBe("OPEN");
    expect(view.message).toBe("INSPECTED");
  });
  it("a duplicate authorization success without a grant never sends provider bytes", async () => {
    const value = client();
    await ready(value);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith("/authorize")) {
        const requestId = JSON.parse(String(init?.body)).requestId;
        return Promise.resolve(
          response(
            envelope(requestId, { operation: { requestId, status: "SUCCEEDED", replayed: true } }),
            201,
          ),
        );
      }
      return normal(url, init);
    });
    await value.uploadNext();
    expect(writes().filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    expect(view.saved?.pending?.kind).toBe("AUTHORIZE");
    expect(view.message).toBe("UNCERTAIN");
  });
  it.each(["CHANNEL_UPLOAD_QUOTA_REACHED", "UPLOAD_PART_LIMIT", "UPLOAD_RATE_LIMITED"])(
    "clears a known pre-admission CREATE rejection %s without trapping a missing request",
    async (code) => {
      const value = client();
      await value.open();
      await value.choose(file());
      const normal = fetcher.getMockImplementation()!;
      fetcher.mockImplementation((url, init) =>
        String(url).endsWith("/recoverable-drafts")
          ? Promise.resolve(response({ error: { code } }, 429))
          : normal(url, init),
      );
      await value.create();
      expect(view.saved).toBeNull();
      expect(storage.length).toBe(0);
      expect(writes()).toHaveLength(1);
    },
  );
  it("local cleanup of a verified finished descriptor never deletes server data", async () => {
    const value = client();
    await ready(value);
    await value.cancel();
    const before = fetcher.mock.calls.length;
    value.forgetFinished();
    expect(storage.length).toBe(0);
    expect(view.saved).toBeNull();
    expect(fetcher.mock.calls).toHaveLength(before);
  });
  it.each(["UPLOAD_RECOVERY_CHANGED", "UPLOAD_RECOVERY_EXPIRED", "UPLOAD_RECOVERY_UNSUPPORTED"])(
    "retains a CREATE marker when %s can follow provider allocation",
    async (code) => {
      const value = client();
      await value.open();
      await value.choose(file());
      const normal = fetcher.getMockImplementation()!;
      fetcher.mockImplementation((url, init) =>
        String(url).endsWith("/recoverable-drafts")
          ? Promise.resolve(
              response({ error: { code } }, code === "UPLOAD_RECOVERY_UNSUPPORTED" ? 503 : 409),
            )
          : normal(url, init),
      );
      await value.create();
      expect(view.saved?.pending?.kind).toBe("CREATE");
      const before = writes().length;
      await value.create();
      expect(writes()).toHaveLength(before);
      expect(loadSavedRecovery(storage, scope)?.pending?.kind).toBe("CREATE");
    },
  );
  it.each(["UPLOAD_RECOVERY_CHANGED", "UPLOAD_RECOVERY_EXPIRED", "UPLOAD_RECOVERY_UNSUPPORTED"])(
    "retains an AUTHORIZE marker when %s can follow signing",
    async (code) => {
      const value = client();
      await ready(value);
      const normal = fetcher.getMockImplementation()!;
      fetcher.mockImplementation((url, init) =>
        String(url).endsWith("/authorize")
          ? Promise.resolve(
              response({ error: { code } }, code === "UPLOAD_RECOVERY_UNSUPPORTED" ? 503 : 409),
            )
          : normal(url, init),
      );
      await value.uploadNext();
      expect(view.saved?.pending?.kind).toBe("AUTHORIZE");
      expect(writes().filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
      const requestId = view.saved?.pending?.requestId;
      fetcher.mockImplementation((url, init) =>
        String(url).endsWith("/cancel")
          ? Promise.resolve(response({ error: { code: "UPLOAD_RECOVERY_CHANGED" } }, 409))
          : normal(url, init),
      );
      await value.cancel();
      expect(view.saved?.pending).toEqual({ kind: "AUTHORIZE", requestId });
    },
  );
});
