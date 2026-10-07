import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdvertisingClient } from "./admin-advertising";
import { seedPost, seedRequest } from "./admin-content-import";
import { registerAdminVerification } from "./admin-reauthentication";
import { parseVideoAdTarget, saveVideoAdCommand, videoAdValues } from "./admin-video-ad-workspace";

const advertisingActor = {
  accountId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  authVersion: 1,
  roles: ["AD_MANAGER" as const],
};
const advertisingClient = () =>
  createAdvertisingClient({
    lease: { epoch: 1, session: advertisingActor },
    isCurrent: () => true,
    signal: new AbortController().signal,
  });
const deletes = [
  { run: (id: string) => advertisingClient().deleteAdvertiser(id), path: "advertisers" },
  { run: (id: string) => advertisingClient().deleteCampaign(id), path: "campaigns" },
  { run: (id: string) => advertisingClient().deleteCreative(id), path: "creatives" },
];
afterEach(() => vi.unstubAllGlobals());

describe("Admin JSON mutation transport", () => {
  it.each(deletes)(
    "sends a real JSON body for $path without changing session policy",
    async ({ run, path }) => {
      const fetcher = vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(url.endsWith("/admin/session") ? advertisingActor : { deleted: true }),
          ),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(run("fixture/id")).resolves.toEqual({ deleted: true });
      expect(fetcher).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/admin/advertising/${path}/fixture%2Fid`),
        expect.objectContaining({
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-ayin-expected-account": advertisingActor.accountId,
            "x-ayin-expected-session": advertisingActor.sessionId,
          },
          body: "{}",
          credentials: "include",
          cache: "no-store",
        }),
      );
    },
  );

  it.each(deletes)("does not replay $path after step-up or a lost response", async ({ run }) => {
    const verification = vi.fn();
    const unregister = registerAdminVerification(verification);
    let write = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("/admin/session")) return new Response(JSON.stringify(advertisingActor));
      if (++write === 1)
        return new Response(
          JSON.stringify({ error: { code: "STEP_UP_REQUIRED", message: "Verify first" } }),
          { status: 403 },
        );
      throw new TypeError("Response lost");
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(run("fixture-id")).rejects.toMatchObject({
        verificationRequired: true,
        uncertain: false,
      });
      expect(verification).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await expect(run("fixture-id")).rejects.toMatchObject({ uncertain: true });
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      unregister();
    }
  });

  it("does not add bodies to reads", async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async (url: string) =>
        new Response(JSON.stringify(url.endsWith("/admin/session") ? advertisingActor : [])),
    );
    vi.stubGlobal("fetch", fetcher);
    await advertisingClient().getAdvertisers();
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/admin/session",
      "/admin/advertising/advertisers",
      "/admin/session",
    ]);
    for (const [, init] of fetcher.mock.calls) expect(init).not.toHaveProperty("body");
  });

  it("native import mutations use the JSON helper at every scoped write call site", () => {
    const path = "../components/admin/admin-content-library.tsx";
    const content = readFileSync(new URL(path, import.meta.url), "utf8");
    const source = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let writes = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "seedRequest") {
        const init = node.arguments[4];
        if (init) {
          writes++;
          expect(ts.isCallExpression(init), node.getText(source)).toBe(true);
          if (ts.isCallExpression(init)) expect(init.expression.getText(source)).toBe("post");
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(writes).toBe(5);
  });

  it.each([
    ["/admin/content-seeding/batches", { channelId: "original", items: [{ title: "Original" }] }],
    [
      "/admin/content-seeding/items/original/upload-session",
      { sizeBytes: 1024, mimeType: "video/mp4" },
    ],
    ["/media/uploads/sessions/complete", { sessionToken: "fixture-only", parts: [] }],
    ["/admin/content-seeding/items/original/publish", undefined],
    ["/admin/content-seeding/batches/original/rollback", undefined],
  ])("sends JSON for %s without bodies on either authority read", async (path, body) => {
    const actor = {
      accountId: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000002",
      authVersion: 1,
      roles: ["OPERATIONS" as const],
    };
    const fetcher = vi.fn(
      async (input: string) =>
        new Response(JSON.stringify(input.endsWith("/admin/session") ? actor : { saved: true })),
    );
    vi.stubGlobal("fetch", fetcher);
    await seedRequest(
      path as string,
      (value) => value,
      actor,
      new AbortController().signal,
      seedPost(body),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1]![1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "include",
      cache: "no-store",
    });
    expect(calls[0]![1]).not.toHaveProperty("body");
    expect(calls[2]![1]).not.toHaveProperty("body");
  });

  it("native advertising settings, override and deletion send real versioned JSON without bodies on actor reads", async () => {
    const actor = {
      accountId: "00000000-0000-4000-8000-000000000001",
      roles: ["AD_MANAGER" as const],
    };
    const stamp = "2035-01-01T00:00:00.000Z",
      next = "2035-01-01T00:00:00.001Z";
    const settings = {
      masterEnabled: false,
      provider: "GOOGLE_IMA" as const,
      preRollEnabled: true,
      midRollEnabled: false,
      postRollEnabled: false,
      midRollEverySec: 600,
      frequencyCapPerSession: 3,
      externalVastTagUrl: null,
      houseCreativeUrl: null,
      houseClickUrl: null,
    };
    const videoId = "00000000-0000-4000-8000-000000000002";
    const row = {
      id: "00000000-0000-4000-8000-000000000003",
      channelId: null,
      videoId,
      enabled: false,
      preRollEnabled: null,
      midRollEnabled: null,
      postRollEnabled: null,
      provider: null,
      vastTagUrl: null,
      midRollEverySec: 600,
      updatedAt: stamp,
    };
    const original = parseVideoAdTarget(
      {
        kind: "VIDEO",
        target: {
          id: videoId,
          title: "Actual JSON target",
          slug: "json-target",
          status: "PUBLISHED",
          channel: { id: actor.accountId, name: "Actual owner", handle: "actual-owner" },
        },
        override: row,
      },
      { kind: "VIDEO", id: videoId },
    );
    const fetcher = vi.fn(
      async (input: string, init: RequestInit) =>
        new Response(
          JSON.stringify(
            input.endsWith("/admin/session")
              ? actor
              : init.method === "DELETE"
                ? { deleted: true }
                : input.endsWith("/settings")
                  ? {
                      settings: { ...settings, frequencyCapPerSession: 5 },
                      source: "STORED",
                      updatedAt: next,
                    }
                  : { ...row, midRollEverySec: 900, updatedAt: next },
          ),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await saveVideoAdCommand(
      actor,
      {
        kind: "SETTINGS",
        original: { settings, source: "STORED", updatedAt: stamp },
        settings: { ...settings, frequencyCapPerSession: 5 },
      },
      new AbortController().signal,
    );
    const changed = await saveVideoAdCommand(
      actor,
      { kind: "OVERRIDE", original, values: { ...videoAdValues(row), midRollEverySec: 900 } },
      new AbortController().signal,
    );
    if (changed.kind !== "OVERRIDE") throw Error("Expected actual override ACK");
    await saveVideoAdCommand(
      actor,
      {
        kind: "DELETE",
        original: { ...original, override: changed.record },
        values: videoAdValues(changed.record),
      },
      new AbortController().signal,
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
    const writes = fetcher.mock.calls.filter(([, init]) => init.method);
    expect(writes.map(([, init]) => init.method)).toEqual(["PATCH", "PATCH", "DELETE"]);
    for (const [, init] of writes) {
      expect(init).toMatchObject({
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: expect.any(String),
      });
      expect(JSON.parse(init.body as string)).toHaveProperty("expectedUpdatedAt");
    }
    expect(JSON.parse(writes[2]![1].body as string)).toEqual({ expectedUpdatedAt: next });
    for (const [, init] of fetcher.mock.calls.filter(([, init]) => !init.method))
      expect(init).not.toHaveProperty("body");
  });
});
