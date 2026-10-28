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
import { watchUploadRecoveryLifecycle } from "./upload-recovery-lifecycle";
import { UploadBlobError } from "./direct-video-upload";

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
  it("accepts only complete session-bound SINGLE metadata headers and never persists them", () => {
    const requestId = randomUUID();
    const headers = {
      "content-type": session.mimeType,
      "x-amz-meta-ayin-upload-session": session.sessionId,
      "x-amz-meta-ayin-source-asset": session.assetId,
      "x-amz-meta-ayin-identity-root": fileIdentity.rootSha256,
    };
    const grant = {
      url: "https://provider.invalid/signed",
      method: "PUT",
      headers,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      partNumber: 1,
    };
    expect(
      parseRecoveryResponse(envelope(requestId, { grant }), scope, requestId, session, 1).grant
        ?.headers,
    ).toEqual(headers);
    const storage = new MemoryStorage();
    saveRecovery(storage, { ...saved(), ...envelope(requestId, { grant }) });
    expect(storage.getItem(RECOVERY_STORAGE_KEY)).not.toContain("x-amz");
    expect(storage.getItem(RECOVERY_STORAGE_KEY)).not.toContain(fileIdentity.rootSha256);
    for (const changed of [
      { ...headers, "x-amz-meta-ayin-upload-session": randomUUID() },
      { ...headers, "x-amz-meta-ayin-source-asset": randomUUID() },
      { ...headers, "x-amz-meta-ayin-identity-root": "A".repeat(64) },
      { ...headers, "x-amz-meta-ayin-identity-root": "a".repeat(63) },
      { ...headers, "x-amz-meta-ayin-identity-root": "a".repeat(65) },
      { ...headers, "x-amz-meta-ayin-identity-root": `${"a".repeat(64)}\r\nsecret` },
      { ...headers, "x-amz-meta-ayin-identity-root": 123 },
      { ...headers, "x-amz-security-token": "token" },
      { ...headers, "x-amz-meta-other": "metadata" },
      { ...headers, authorization: "credential" },
      { ...headers, "content-type": "text/plain" },
      { ...headers, "Content-Type": session.mimeType },
      { ...headers, "X-Amz-Meta-Ayin-Upload-Session": session.sessionId },
      { "x-amz-meta-ayin-upload-session": session.sessionId },
      {
        "x-amz-meta-ayin-upload-session": session.sessionId,
        "x-amz-meta-ayin-source-asset": session.assetId,
      },
    ])
      expect(() =>
        parseRecoveryResponse(
          envelope(requestId, { grant: { ...grant, headers: changed } }),
          scope,
          requestId,
          session,
          1,
        ),
      ).toThrow();
    const multipart = { ...session, mode: "MULTIPART" as const };
    expect(() =>
      parseRecoveryResponse(
        { ...envelope(requestId, { grant }), session: multipart },
        scope,
        requestId,
        multipart,
        1,
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
      if (path.includes("/capability"))
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
  function client(
    identify: (
      file: File,
      signal: AbortSignal,
      progress: (percent: number) => void,
    ) => Promise<UploadFileIdentity> = vi.fn(async () => fileIdentity),
  ) {
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
  it("rejects a file above the server's rollout limit before hashing or creating a draft", async () => {
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).includes("/capability")
        ? Promise.resolve(
            response({ protocolVersion: 1, supported: true, reason: null, maxSourceBytes: 2 }),
          )
        : normal(url, init),
    );
    const identify = vi.fn(async () => fileIdentity);
    const value = client(identify);
    await value.open();
    await value.choose(file());
    expect(view.maxSourceBytes).toBe(2);
    expect(view.message).toBe("VIDEO_TOO_LARGE");
    expect(identify).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });
  async function pendingCompletion(
    responseStatus: "SUCCEEDED" | "PENDING" | "UNKNOWN" = "SUCCEEDED",
  ) {
    state = { ...state, state: "UNRESOLVED", revision: 3 };
    const requestId = randomUUID();
    saveRecovery(storage, saved({ session: state, pending: { kind: "COMPLETE", requestId } }));
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith(`/operations/${requestId}/reconcile`)) {
        state = {
          ...state,
          state: responseStatus === "SUCCEEDED" ? "COMPLETED" : "UNRESOLVED",
          revision: state.revision + 1,
        };
        return response(
          envelope(requestId, {
            session: state,
            operation: { requestId, status: responseStatus, replayed: true },
          }),
          201,
        );
      }
      if (String(url).endsWith(`/operations/${requestId}`))
        return response(
          envelope(requestId, {
            session: state,
            operation: {
              requestId,
              status: state.state === "COMPLETED" ? "SUCCEEDED" : "UNKNOWN",
              replayed: true,
            },
          }),
        );
      return normal(url, init);
    });
    const value = client();
    await value.open();
    return { value, requestId };
  }
  it("only explicit completion verification posts the original request ID and exact revision without file bytes or another UUID", async () => {
    const { value, requestId } = await pendingCompletion();
    await value.check();
    await value.inspect();
    expect(writes()).toHaveLength(0);
    expect(view.saved?.pending).toEqual({ kind: "COMPLETE", requestId });
    const before = fetcher.mock.calls.length;
    const id = vi.spyOn(crypto, "randomUUID");
    try {
      await value.reconcileCompletion();
      expect(id).not.toHaveBeenCalled();
    } finally {
      id.mockRestore();
    }
    expect(writes()).toHaveLength(1);
    const [url, init] = writes()[0]!;
    expect(
      String(url).endsWith(
        `/media/uploads/sessions/${session.sessionId}/operations/${requestId}/reconcile`,
      ),
    ).toBe(true);
    expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 3 });
    expect(new Headers(init?.headers).get("x-ayin-expected-account")).toBe(scope.accountId);
    expect(new Headers(init?.headers).get("x-ayin-expected-session")).toBe(scope.profileId);
    expect(init).toMatchObject({ method: "POST", credentials: "include", cache: "no-store" });
    expect(fetcher.mock.calls.slice(before).map(([url]) => String(url).split("/").at(-1))).toEqual([
      "me",
      "reconcile",
      "me",
    ]);
    expect(view.message).toBe("COMPLETED");
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(view.saved?.pending).toBeNull();
    expect(loadSavedRecovery(storage, scope)?.pending).toBeNull();
    await value.reconcileCompletion();
    expect(writes()).toHaveLength(1);
  });
  it.each(["PENDING", "UNKNOWN"] as const)(
    "%s verification preserves the original COMPLETE marker and accepts only the fresh revision",
    async (status) => {
      const { value, requestId } = await pendingCompletion(status);
      await value.reconcileCompletion();
      expect(view.message).toBe("UNCERTAIN");
      expect(view.saved?.pending).toEqual({ kind: "COMPLETE", requestId });
      expect(view.saved?.session?.revision).toBe(4);
      await value.check();
      expect(writes()).toHaveLength(1);
      await value.reconcileCompletion();
      expect(writes()).toHaveLength(2);
      expect(JSON.parse(String(writes()[1]![1]?.body))).toEqual({ expectedRevision: 4 });
      expect(String(writes()[1]![0]).endsWith(`/operations/${requestId}/reconcile`)).toBe(true);
      expect(loadSavedRecovery(storage, scope)?.pending).toEqual({ kind: "COMPLETE", requestId });
    },
  );
  it.each([
    "wrong-request",
    "not-replayed",
    "success-not-completed",
    "unknown-completed",
    "grant",
    "cleanup",
    "stale-revision",
    "changed-session",
    "changed-asset",
    "changed-account",
    "wrong-http-status",
  ])(
    "rejects %s verification responses without erasing the original COMPLETE marker",
    async (bad) => {
      const { value, requestId } = await pendingCompletion();
      const normal = fetcher.getMockImplementation()!;
      fetcher.mockImplementation((url, init) => {
        if (!String(url).endsWith("/reconcile")) return normal(url, init);
        const result = envelope(requestId, {
          session: {
            ...state,
            state: bad === "success-not-completed" ? "UNRESOLVED" : "COMPLETED",
            revision: bad === "stale-revision" ? 2 : 4,
            ...(bad === "changed-session" ? { sessionId: randomUUID() } : {}),
            ...(bad === "changed-asset" ? { assetId: randomUUID() } : {}),
            ...(bad === "changed-account" ? { actorAccountId: randomUUID() } : {}),
          },
          operation: {
            requestId: bad === "wrong-request" ? randomUUID() : requestId,
            status: bad === "unknown-completed" ? "UNKNOWN" : "SUCCEEDED",
            replayed: bad !== "not-replayed",
          },
          ...(bad === "grant" ? { grant: {} } : {}),
          ...(bad === "cleanup"
            ? { cleanup: { authorityRevoked: true, settlement: "PENDING" } }
            : {}),
        });
        return Promise.resolve(response(result, bad === "wrong-http-status" ? 200 : 201));
      });
      await value.reconcileCompletion();
      expect(view.message).toBe("INVALID_RESPONSE");
      expect(view.saved?.session?.revision).toBe(3);
      expect(view.saved?.pending).toEqual({ kind: "COMPLETE", requestId });
      expect(loadSavedRecovery(storage, scope)?.pending).toEqual({ kind: "COMPLETE", requestId });
      expect(writes()).toHaveLength(1);
    },
  );
  it.each(["lost", "not-found", "changed", "unsupported"])(
    "%s reconciliation retains the original pending marker without automatic retries",
    async (failure) => {
      const { value, requestId } = await pendingCompletion();
      const normal = fetcher.getMockImplementation()!;
      fetcher.mockImplementation(async (url, init) => {
        if (!String(url).endsWith("/reconcile")) return normal(url, init);
        if (failure === "lost") throw Error("Synthetic lost response");
        return response(
          {
            error: {
              code:
                failure === "unsupported"
                  ? "UPLOAD_RECOVERY_UNSUPPORTED"
                  : failure === "changed"
                    ? "UPLOAD_STATE_CHANGED"
                    : "UPLOAD_RECOVERY_NOT_FOUND",
            },
          },
          failure === "unsupported" ? 503 : failure === "changed" ? 409 : 404,
        );
      });
      await value.reconcileCompletion();
      expect(view.saved?.pending).toEqual({ kind: "COMPLETE", requestId });
      expect(writes()).toHaveLength(1);
      expect(view.message).not.toBe("COMPLETED");
      if (failure === "unsupported") {
        expect(view.supported).toBe(false);
        await value.reconcileCompletion();
        // Another explicit read-only reconciliation remains available for an
        // admitted upload while new issuance is disabled. Never replay COMPLETE.
        expect(writes()).toHaveLength(2);
        expect(writes().every(([url]) => String(url).endsWith("/reconcile"))).toBe(true);
      }
    },
  );
  it.each([
    "OPEN",
    "PREPARING",
    "COMPLETED",
    "ABORTED",
    "REVOKED",
    "EXPIRED",
    "CANCELLING",
  ] as const)("never verifies a COMPLETE marker in %s", async (sessionState) => {
    const { value } = await pendingCompletion();
    saveRecovery(storage, { ...view.saved!, session: { ...state, state: sessionState } });
    await value.open();
    await value.reconcileCompletion();
    expect(writes()).toHaveLength(0);
  });
  it.each(["CREATE", "RESUME", "AUTHORIZE", "CANCEL", null] as const)(
    "never verifies a %s marker",
    async (kind) => {
      const { value, requestId } = await pendingCompletion();
      saveRecovery(storage, { ...view.saved!, pending: kind ? { kind, requestId } : null });
      await value.open();
      await value.reconcileCompletion();
      expect(writes()).toHaveLength(0);
    },
  );
  it("blocks expired or unsupported completion verification before dispatch", async () => {
    const { value } = await pendingCompletion();
    saveRecovery(storage, {
      ...view.saved!,
      session: { ...state, expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    await value.open();
    await value.reconcileCompletion();
    expect(view.message).toBe("EXPIRED");
    expect(writes()).toHaveLength(0);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).includes("/capability")
        ? Promise.resolve(response({ protocolVersion: 1, supported: false, reason: "UNSUPPORTED" }))
        : normal(url, init),
    );
    await value.open();
    await value.reconcileCompletion();
    expect(view.supported).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  it("serializes repeated verification clicks and retains the COMPLETE marker after Stop", async () => {
    const { value, requestId } = await pendingCompletion();
    const normal = fetcher.getMockImplementation()!;
    let entered = false;
    fetcher.mockImplementation((url, init) => {
      if (!String(url).endsWith("/reconcile")) return normal(url, init);
      entered = true;
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      });
    });
    const verification = value.reconcileCompletion();
    await vi.waitFor(() => expect(entered).toBe(true));
    await value.reconcileCompletion();
    expect(writes()).toHaveLength(1);
    value.stop();
    await verification;
    expect(view.busy).toBe(false);
    expect(view.message).toBe("STOPPED");
    expect(loadSavedRecovery(storage, scope)?.pending).toEqual({ kind: "COMPLETE", requestId });
  });
  it("bounds verification to 15 seconds while keeping the original COMPLETE recoverable", async () => {
    const { value, requestId } = await pendingCompletion();
    const normal = fetcher.getMockImplementation()!;
    let entered = false;
    fetcher.mockImplementation((url, init) => {
      if (!String(url).endsWith("/reconcile")) return normal(url, init);
      entered = true;
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      });
    });
    vi.useFakeTimers();
    try {
      const verification = value.reconcileCompletion();
      await vi.advanceTimersByTimeAsync(0);
      expect(entered).toBe(true);
      await vi.advanceTimersByTimeAsync(15000);
      await verification;
      expect(view.message).toBe("UNCERTAIN");
      expect(view.busy).toBe(false);
      expect(loadSavedRecovery(storage, scope)?.pending).toEqual({ kind: "COMPLETE", requestId });
      expect(writes()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("suspension discards late verification results without restoring hidden facts or clearing the marker", async () => {
    const { value, requestId } = await pendingCompletion();
    const normal = fetcher.getMockImplementation()!;
    let release!: () => void,
      entered = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetcher.mockImplementation(async (url, init) => {
      if (!String(url).endsWith("/reconcile")) return normal(url, init);
      entered = true;
      const result = await normal(url, init);
      await held;
      return result;
    });
    const verification = value.reconcileCompletion();
    await vi.waitFor(() => expect(entered).toBe(true));
    value.suspend();
    release();
    await verification;
    expect(view.scope).toBeNull();
    expect(view.saved).toBeNull();
    expect(view.message).toBe("INITIAL");
    expect(loadSavedRecovery(storage, scope)?.pending).toEqual({ kind: "COMPLETE", requestId });
    expect(writes()).toHaveLength(1);
  });
  it.each(["before", "after"])(
    "fresh %s verification authority checks reject a profile switch",
    async (when) => {
      const { value } = await pendingCompletion();
      const normal = fetcher.getMockImplementation()!;
      fetcher.mockImplementation(async (url, init) => {
        const result = await normal(url, init);
        if (String(url).endsWith("/reconcile")) identityScope.profileId = randomUUID();
        return result;
      });
      if (when === "before") identityScope.profileId = randomUUID();
      await value.reconcileCompletion();
      expect(view.scope).toBeNull();
      expect(view.saved).toBeNull();
      expect(view.message).toBe("AUTHORITY_CHANGED");
      expect(storage.length).toBe(0);
      expect(writes()).toHaveLength(when === "before" ? 0 : 1);
    },
  );
  it("an unverifiable post-verification identity hides facts but retains the safe COMPLETE marker", async () => {
    const { value, requestId } = await pendingCompletion();
    const normal = fetcher.getMockImplementation()!;
    let verified = false;
    fetcher.mockImplementation(async (url, init) => {
      if (verified && String(url).endsWith("/auth/me"))
        return response({ error: { code: "TEMPORARILY_UNAVAILABLE" } }, 503);
      const result = await normal(url, init);
      if (String(url).endsWith("/reconcile")) verified = true;
      return result;
    });
    await value.reconcileCompletion();
    expect(view.scope).toBeNull();
    expect(view.saved).toBeNull();
    expect(view.message).toBe("AUTHORITY_UNVERIFIED");
    expect(loadSavedRecovery(storage, scope)?.pending).toEqual({ kind: "COMPLETE", requestId });
    expect(writes()).toHaveLength(1);
  });
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
  it("transfers three parts concurrently, then verifies every saved part before completing the same draft", async () => {
    const releases = new Map<number, () => void>();
    let allStarted!: () => void;
    const started = new Promise<void>((resolve) => (allStarted = resolve));
    const { value, bodies } = await multipartFixture({
      put: (_signal, part) =>
        new Promise<void>((resolve) => {
          releases.set(part, resolve);
          if (releases.size === 3) allStarted();
        }),
    });
    const operation = value.continueUpload({ concurrency: 3, complete: true });
    await started;
    expect(bodies).toEqual(["01234", "56789", "a"]);
    expect(view.saved?.pending).toBeNull();
    expect(writes().some(([url]) => String(url).endsWith("/complete"))).toBe(false);
    releases.get(2)!();
    releases.get(3)!();
    expect(writes().some(([url]) => String(url).endsWith("/complete"))).toBe(false);
    releases.get(1)!();
    await operation;
    expect(view.saved?.session?.videoId).toBe(session.videoId);
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(view.uploadedBytes).toBe(11);
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(1);
    expect(writes().filter(([url]) => String(url).endsWith("/recoverable-drafts"))).toHaveLength(0);
  });
  it("automatically retries a transient part with a fresh grant after verifying saved sibling parts", async () => {
    vi.useFakeTimers();
    try {
      let failures = 0;
      const { value, bodies } = await multipartFixture({
        put: async (_signal, part) => {
          if (part === 1 && failures++ === 0)
            throw new UploadBlobError("Storage temporarily unavailable", {
              status: 503,
              retryable: true,
            });
        },
      });
      const operation = value.continueUpload({ concurrency: 3, complete: true });
      await vi.advanceTimersByTimeAsync(5000);
      await operation;
      expect(bodies).toEqual(["01234", "56789", "a", "01234"]);
      const grants = writes()
        .filter(([url]) => String(url).endsWith("/authorize"))
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(grants.map((grant) => grant.partNumber)).toEqual([1, 2, 3, 1]);
      expect(new Set(grants.map((grant) => grant.requestId)).size).toBe(4);
      expect(view.saved?.session?.state).toBe("COMPLETED");
      expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(1);
      expect(writes().filter(([url]) => String(url).endsWith("/recoverable-drafts"))).toHaveLength(
        0,
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds automatic transfer retry to four attempts and never completes a missing part", async () => {
    vi.useFakeTimers();
    try {
      const { value } = await multipartFixture({
        put: async (_signal, part) => {
          if (part === 1) throw new UploadBlobError("Stalled", { retryable: true });
        },
      });
      const operation = value.continueUpload({ concurrency: 3, complete: true });
      await vi.advanceTimersByTimeAsync(5000);
      await operation;
      const grants = writes()
        .filter(([url]) => String(url).endsWith("/authorize"))
        .map(([, init]) => JSON.parse(String(init?.body)).partNumber);
      expect(grants.filter((part) => part === 1)).toHaveLength(4);
      expect(grants.filter((part) => part === 2)).toHaveLength(1);
      expect(grants.filter((part) => part === 3)).toHaveLength(1);
      expect(view.message).toBe("UPLOAD_NETWORK_FAILED");
      expect(view.saved?.session?.state).toBe("OPEN");
      expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops an automatic retry backoff immediately without requesting another grant", async () => {
    vi.useFakeTimers();
    try {
      const { value } = await multipartFixture({
        put: async () => {
          throw new TypeError("Network interrupted");
        },
      });
      const operation = value.continueUpload({ concurrency: 3, complete: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(view.message).toBe("RETRYING");
      value.stop();
      await operation;
      expect(view.message).toBe("STOPPED");
      expect(writes().filter(([url]) => String(url).endsWith("/authorize"))).toHaveLength(3);
      expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancel waits for every active part to abort before revoking the same saved upload", async () => {
    let entered!: () => void,
      starts = 0;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const aborted: number[] = [];
    const { value } = await multipartFixture({
      put: (signal, part) =>
        new Promise<void>((_resolve, reject) => {
          if (++starts === 3) entered();
          signal.addEventListener(
            "abort",
            () => {
              aborted.push(part);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    const operation = value.continueUpload({ concurrency: 3, complete: true });
    await started;
    await value.cancel();
    await operation;
    expect(aborted.sort()).toEqual([1, 2, 3]);
    expect(view.saved?.session?.state).toBe("ABORTED");
    expect(value.canForgetFinished()).toBe(true);
    expect(writes().filter(([url]) => String(url).endsWith("/cancel"))).toHaveLength(1);
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(0);
    value.forgetFinished();
    expect(storage.length).toBe(0);
    expect(state.state).toBe("ABORTED");
  });
  it("requires an authoritative terminal outcome before forgetting a closed descriptor", async () => {
    state = { ...state, state: "REVOKED" };
    saveRecovery(storage, saved({ session: state }));
    const value = client();
    await value.open();
    expect(value.canForgetFinished()).toBe(false);
    value.forgetFinished();
    expect(storage.length).toBe(1);
    await value.inspect();
    expect(value.canForgetFinished()).toBe(true);
    value.forgetFinished();
    expect(storage.length).toBe(0);
    expect(writes()).toHaveLength(0);
  });
  it("allows safe local exit after terminal cleanup revokes authority without reinterpreting UNKNOWN provider outcome", async () => {
    const requestId = randomUUID();
    state = { ...state, state: "REVOKED" };
    saveRecovery(
      storage,
      saved({ creationRequestId: requestId, pending: { kind: "CREATE", requestId } }),
    );
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).includes("/operations/")
        ? Promise.resolve(
            response(
              envelope(requestId, {
                session: state,
                operation: { requestId, status: "UNKNOWN", replayed: true },
                cleanup: { authorityRevoked: true, settlement: "PENDING" },
              }),
            ),
          )
        : normal(url, init),
    );
    const value = client();
    await value.check();
    expect(view.saved?.pending).toEqual({ kind: "CREATE", requestId });
    expect(value.canForgetFinished()).toBe(true);
    value.forgetFinished();
    expect(storage.length).toBe(0);
    expect(writes()).toHaveLength(0);
  });
  it("requires explicit cancellation for an expired descriptor without server cleanup proof", async () => {
    state = { ...state, state: "EXPIRED", expiresAt: new Date(Date.now() - 1000).toISOString() };
    saveRecovery(storage, saved({ session: state }));
    const value = client();
    await value.check();
    expect(value.canForgetFinished()).toBe(false);
    value.forgetFinished();
    expect(storage.length).toBe(1);
    await value.cancel();
    expect(value.canForgetFinished()).toBe(true);
    value.forgetFinished();
    expect(storage.length).toBe(0);
    expect(writes().filter(([url]) => String(url).endsWith("/cancel"))).toHaveLength(1);
  });
  it("permits local exit when a lost AUTHORIZE is followed by authoritative terminal cleanup", async () => {
    const requestId = randomUUID();
    const descriptor = saved({ pending: { kind: "AUTHORIZE", requestId } });
    saveRecovery(storage, descriptor);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith(`/operations/${requestId}`))
        return Promise.resolve(response({ error: { code: "UPLOAD_RECOVERY_NOT_FOUND" } }, 404));
      if (String(url).includes("/recoverable-drafts/"))
        return Promise.resolve(
          response(
            envelope(descriptor.creationRequestId, {
              session: { ...state, state: "REVOKED", revision: 3 },
              operation: {
                requestId: descriptor.creationRequestId,
                status: "UNKNOWN",
                replayed: true,
              },
              cleanup: { authorityRevoked: true, settlement: "PENDING" },
            }),
          ),
        );
      return normal(url, init);
    });
    const value = client();
    await value.check();
    expect(value.canForgetFinished()).toBe(true);
    expect(view.saved?.pending).toEqual({ kind: "AUTHORIZE", requestId });
    value.forgetFinished();
    expect(storage.length).toBe(0);
    expect(writes()).toHaveLength(0);
  });
  it("preserves the original COMPLETE marker when completion wins a cancellation race", async () => {
    const requestId = randomUUID();
    state = { ...state, state: "FINALIZING" };
    saveRecovery(storage, saved({ session: state, pending: { kind: "COMPLETE", requestId } }));
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith("/cancel")) {
        state = { ...state, state: "COMPLETED", revision: 3 };
        return Promise.resolve(response({ error: { code: "UPLOAD_ALREADY_ACCEPTED" } }, 409));
      }
      return normal(url, init);
    });
    const value = client();
    await value.open();
    await value.cancel();
    expect(view.saved?.pending).toEqual({ kind: "COMPLETE", requestId });
    expect(view.message).toBe("UPLOAD_ALREADY_ACCEPTED");
    await value.check();
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(value.canForgetFinished()).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.[0]).toContain("/cancel");
  });
  it("keeps the existing three-part upload running across blur and foreground restoration without another intent", async () => {
    let release!: () => void,
      entered!: () => void,
      starts = 0;
    const held = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    const { value, bodies } = await multipartFixture({
      put: async () => {
        if (++starts === 3) entered();
        await held;
      },
    });
    const target = new EventTarget();
    const suspend = vi.fn(() => value.suspend());
    const restore = vi.fn(() => {
      if (!value.getSnapshot().busy) void value.check();
    });
    const stopWatching = watchUploadRecoveryLifecycle({
      target,
      isVisible: () => true,
      suspend,
      restore,
    });
    const operation = value.continueUpload({ concurrency: 3, complete: true });
    await started;
    const before = writes().length;
    target.dispatchEvent(new Event("blur"));
    target.dispatchEvent(new Event("visibilitychange"));
    target.dispatchEvent(new Event("focus"));
    expect(suspend).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(view.busy).toBe(true);
    expect(view.fileName).toBe("whole.mp4");
    expect(writes()).toHaveLength(before);
    release();
    await operation;
    expect(bodies).toEqual(["01234", "56789", "a"]);
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(1);
    stopWatching();
    target.dispatchEvent(new Event("pagehide"));
    expect(suspend).not.toHaveBeenCalled();
  });
  it("does not lose the selected native-picker file or restart its fingerprint when the window blurs", async () => {
    let entered!: () => void, release!: () => void;
    let checkingSignal: AbortSignal | null = null;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const identify = vi.fn(async (_file: File, signal: AbortSignal) => {
      checkingSignal = signal;
      entered();
      await held;
      signal.throwIfAborted();
      return fileIdentity;
    });
    const value = client(identify);
    await value.open();
    const target = new EventTarget();
    const stopWatching = watchUploadRecoveryLifecycle({
      target,
      isVisible: () => true,
      suspend: () => value.suspend(),
      restore: () => {
        if (!value.getSnapshot().busy) void value.check();
      },
    });
    const selected = value.choose(file());
    await started;
    target.dispatchEvent(new Event("blur"));
    target.dispatchEvent(new Event("focus"));
    expect(checkingSignal!.aborted).toBe(false);
    release();
    await selected;
    expect(identify).toHaveBeenCalledTimes(1);
    expect(view.fileName).toBe("camera.mp4");
    expect(view.message).toBe("CREATE_READY");
    await value.create();
    expect(view.saved?.session?.sessionId).toBe(session.sessionId);
    expect(writes().filter(([url]) => String(url).endsWith("/recoverable-drafts"))).toHaveLength(1);
    stopWatching();
  });
  it("still aborts all parts on real pagehide and restores only metadata until the user resumes", async () => {
    let entered!: () => void,
      starts = 0;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const aborted: number[] = [];
    const { value, bodies } = await multipartFixture({
      put: (signal, part) =>
        new Promise<void>((_resolve, reject) => {
          if (++starts === 3) entered();
          signal.addEventListener(
            "abort",
            () => {
              aborted.push(part);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    const target = new EventTarget();
    let restored: Promise<void> | null = null;
    const stopWatching = watchUploadRecoveryLifecycle({
      target,
      isVisible: () => true,
      suspend: () => value.suspend(),
      restore: () => {
        restored = value.check();
      },
    });
    const operation = value.continueUpload({ concurrency: 3, complete: true });
    await started;
    target.dispatchEvent(new Event("pagehide"));
    await operation;
    expect(aborted.sort()).toEqual([1, 2, 3]);
    expect(view.fileName).toBeNull();
    expect(view.scope).toBeNull();
    const before = writes().length;
    target.dispatchEvent(new Event("pageshow"));
    await restored;
    expect(view.saved?.session?.sessionId).toBe(session.sessionId);
    expect(view.fileName).toBeNull();
    expect(view.message).toBe("INSPECTED");
    expect(writes()).toHaveLength(before);
    expect(bodies).toHaveLength(3);
    stopWatching();
  });
  it("aborts a failed batch, then after reload sends only parts absent from the provider inventory", async () => {
    let fail!: () => void;
    let partTwoSaved!: () => void;
    const twoSaved = new Promise<void>((resolve) => (partTwoSaved = resolve));
    let laterAttempt = false;
    const aborted: number[] = [];
    let allStarted!: () => void;
    let starts = 0;
    const started = new Promise<void>((resolve) => (allStarted = resolve));
    const { value, bodies } = await multipartFixture({
      put: (signal, part) => {
        if (laterAttempt) return Promise.resolve();
        starts++;
        if (starts === 3) allStarted();
        if (part === 2) {
          partTwoSaved();
          return Promise.resolve();
        }
        return new Promise<void>((_resolve, reject) => {
          if (part === 1) fail = () => reject(new Error("Network disconnected"));
          signal.addEventListener(
            "abort",
            () => {
              aborted.push(part);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    });
    const first = value.continueUpload({ concurrency: 3, complete: true });
    await started;
    await twoSaved;
    fail();
    await first;
    expect(aborted).toContain(3);
    expect(view.saved?.pending).toBeNull();
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(0);
    value.suspend();
    laterAttempt = true;
    const reopened = client(vi.fn(async () => ({ ...fileIdentity, sizeBytes: 11 })));
    await reopened.check();
    expect(view.uploadedBytes).toBe(5);
    expect(view.fileName).toBeNull();
    await reopened.choose(new File(["0123456789a"], "whole.mp4", { type: "video/mp4" }));
    await reopened.continueUpload({ concurrency: 3, complete: true });
    expect(bodies).toEqual(["01234", "56789", "a", "01234", "a"]);
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(1);
  });
  it("keeps UNKNOWN authorization pending and sends no prepared batch bytes", async () => {
    const { value, bodies } = await multipartFixture();
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (String(url).endsWith("/authorize") && body.partNumber === 2) {
        state = { ...state, state: "UNRESOLVED", revision: 2 };
        return Promise.resolve(
          response(
            envelope(body.requestId, {
              session: state,
              operation: { requestId: body.requestId, status: "UNKNOWN", replayed: false },
            }),
            201,
          ),
        );
      }
      return normal(url, init);
    });
    await value.continueUpload({ concurrency: 3, complete: true });
    expect(bodies).toEqual([]);
    expect(view.saved?.pending?.kind).toBe("AUTHORIZE");
    expect(view.message).toBe("UNCERTAIN");
    expect(writes().filter(([url]) => String(url).endsWith("/authorize"))).toHaveLength(2);
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(0);
  });
  it("stopping a parallel batch aborts every PUT and retains the same recoverable session", async () => {
    let started!: () => void;
    const entered = new Promise<void>((resolve) => (started = resolve));
    let active = 0;
    const aborted: number[] = [];
    const { value } = await multipartFixture({
      put: (signal, part) =>
        new Promise<void>((_resolve, reject) => {
          if (++active === 3) started();
          signal.addEventListener(
            "abort",
            () => {
              aborted.push(part);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    const transfer = value.continueUpload({ concurrency: 3, complete: true });
    await entered;
    value.stop();
    await transfer;
    expect(aborted.sort()).toEqual([1, 2, 3]);
    expect(view.message).toBe("STOPPED");
    expect(view.saved?.session?.sessionId).toBe(session.sessionId);
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(0);
  });
  it("recovers an AUTHORIZE marker that never reached the server without replaying it or creating a new draft", async () => {
    const requestId = randomUUID();
    saveRecovery(storage, saved({ pending: { kind: "AUTHORIZE", requestId } }));
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).endsWith(`/operations/${requestId}`)
        ? Promise.resolve(response({ error: { code: "UPLOAD_RECOVERY_NOT_FOUND" } }, 404))
        : normal(url, init),
    );
    const reopened = client();
    await reopened.check();
    expect(view.message).toBe("INSPECTED");
    expect(view.saved?.pending).toBeNull();
    expect(view.saved?.session?.sessionId).toBe(session.sessionId);
    expect(writes()).toHaveLength(0);
    await reopened.choose(file());
    await reopened.continueUpload({ concurrency: 3, complete: true });
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(writes().filter(([url]) => String(url).endsWith("/recoverable-drafts"))).toHaveLength(0);
    expect(writes().filter(([url]) => String(url).endsWith("/authorize"))).toHaveLength(1);
    expect(
      JSON.parse(String(writes().find(([url]) => String(url).endsWith("/authorize"))?.[1]?.body))
        .requestId,
    ).not.toBe(requestId);
  });
  it("does not clear or replay an unresolved COMPLETE marker when its outcome is not found", async () => {
    const requestId = randomUUID();
    saveRecovery(storage, saved({ pending: { kind: "COMPLETE", requestId } }));
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).endsWith(`/operations/${requestId}`)
        ? Promise.resolve(response({ error: { code: "UPLOAD_RECOVERY_NOT_FOUND" } }, 404))
        : normal(url, init),
    );
    const reopened = client();
    await reopened.check();
    expect(view.saved?.pending).toEqual({ kind: "COMPLETE", requestId });
    await reopened.choose(file());
    await reopened.continueUpload({ concurrency: 3, complete: true });
    expect(writes()).toHaveLength(0);
  });
  it("restores a 5 GiB descriptor, rejects a same-metadata replacement, and transfers only its last three parts", async () => {
    const sizeBytes = 5 * 1024 ** 3,
      partSizeBytes = 16 * 1024 ** 2,
      partCount = 320;
    state = { ...session, mode: "MULTIPART", sizeBytes, partSizeBytes, partCount };
    const savedDescriptor = saved({ session: state });
    saveRecovery(storage, savedDescriptor);
    expect(storage.getItem(RECOVERY_STORAGE_KEY)!.length).toBeLessThan(8192);
    const uploaded = new Map(Array.from({ length: 317 }, (_, index) => [index + 1, partSizeBytes]));
    const slices: [number, number][] = [];
    const virtualFile = () => {
      const value = new File(["small fixture"], "original.mp4", {
        type: "video/mp4",
        lastModified: 123,
      });
      Object.defineProperty(value, "size", { value: sizeBytes });
      value.slice = (start = 0, end = sizeBytes) => {
        slices.push([start, end]);
        const blob = new Blob(["bounded slice fixture"]);
        Object.defineProperty(blob, "size", { value: end - start });
        return blob;
      };
      return value;
    };
    const correct = virtualFile(),
      wrong = virtualFile();
    const fullIdentity = { ...fileIdentity, sizeBytes, leafCount: 1280 };
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      const path = String(url),
        body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (path.includes("/capability"))
        return response({
          protocolVersion: 1,
          supported: true,
          reason: null,
          maxSourceBytes: sizeBytes,
        });
      if (path.endsWith("/inspection"))
        return response({
          ...state,
          observation: {
            kind: "PARTS_OBSERVED",
            parts: [...uploaded].map(([partNumber, sizeBytes]) => ({ partNumber, sizeBytes })),
            uploadedBytes: [...uploaded.values()].reduce((sum, bytes) => sum + bytes, 0),
          },
        });
      if (path.endsWith("/resume") && body.fileIdentity.rootSha256 !== fullIdentity.rootSha256)
        return response({ error: { code: "UPLOAD_FILE_CHANGED" } }, 409);
      if (path.endsWith("/authorize"))
        return response(
          envelope(body.requestId, {
            session: state,
            grant: {
              url: `https://provider.invalid/large/${body.partNumber}`,
              method: "PUT",
              headers: {},
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              partNumber: body.partNumber,
            },
          }),
          201,
        );
      if (path.startsWith("https://provider.invalid/large/")) {
        uploaded.set(Number(path.split("/").at(-1)), (init?.body as Blob).size);
        return new Response(null, { status: 200 });
      }
      return normal(url, init);
    });
    const identify = vi.fn(async (selected: File) => ({
      ...fullIdentity,
      rootSha256: selected === correct ? fullIdentity.rootSha256 : "a".repeat(64),
    }));
    const reopened = client(identify);
    await reopened.check();
    expect(view.uploadedBytes).toBe(317 * partSizeBytes);
    expect(view.fileName).toBeNull();
    await reopened.choose(wrong);
    await reopened.continueUpload({ concurrency: 3, complete: true });
    expect(view.message).toBe("UPLOAD_FILE_CHANGED");
    expect(slices).toEqual([]);
    expect(writes().filter(([url]) => String(url).endsWith("/authorize"))).toHaveLength(0);
    await reopened.choose(correct);
    await reopened.continueUpload({ concurrency: 3, complete: true });
    expect(slices).toEqual(
      [317, 318, 319].map((index) => [index * partSizeBytes, (index + 1) * partSizeBytes]),
    );
    expect(view.saved?.session?.state).toBe("COMPLETED");
    expect(view.saved?.session?.videoId).toBe(savedDescriptor.session?.videoId);
    expect(view.saved?.creationRequestId).toBe(savedDescriptor.creationRequestId);
    expect(view.uploadedBytes).toBe(sizeBytes);
    expect(writes().filter(([url]) => String(url).endsWith("/complete"))).toHaveLength(1);
    expect(writes().filter(([url]) => String(url).endsWith("/recoverable-drafts"))).toHaveLength(0);
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
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/capability"))).toBe(false);
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
      String(url).includes("/capability")
        ? Promise.resolve(response({ protocolVersion: 1, supported: false, reason: "UNSUPPORTED" }))
        : normal(url, init),
    );
    const value = client();
    await Promise.all([value.open(), value.open()]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/capability"))).toHaveLength(
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
