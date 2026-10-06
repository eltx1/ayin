import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseMerchandisingDirectory,
  merchandisingIdentityFailure,
  searchMerchandisingTargets,
  verifiedMerchandisingOperation,
} from "./admin-merchandising";
import { AdminWorkspaceError } from "./verified-admin-transport";
import { replaceAdminHomeRowManualItems } from "./admin-product";
import type { DirectAdminSession } from "./admin-session-scope";
const actor: DirectAdminSession = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  authVersion: 3,
  roles: ["OPERATIONS"],
};
const item = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Actual private story",
  name: "Actual playlist",
  slug: "actual-story",
  status: "REMOVED",
  visibility: "PRIVATE",
  channel: { handle: "actual-creator" },
};
const response = (value: unknown) => new Response(JSON.stringify(value));
const directory = { items: [item], pagination: { page: 2, take: 25, total: 26, pages: 2 } };
afterEach(() => vi.unstubAllGlobals());
describe("verified merchandising selection", () => {
  it.each([
    ["VIDEO", "/admin/control/videos"],
    ["CHANNEL", "/admin/control/channels"],
    ["CREATOR_TV", "/admin/control/tv"],
    ["PLAYLIST", "/admin/operations/directory/playlists"],
  ] as const)(
    "reuses bounded %s search and validates the same durable session around it",
    async (type, path) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(
          response({ ...directory, items: [{ ...item, handle: "actual-channel" }] }),
        )
        .mockResolvedValueOnce(response(actor));
      vi.stubGlobal("fetch", fetcher);
      const result = await searchMerchandisingTargets(
        actor,
        type,
        "Real name",
        2,
        new AbortController().signal,
      );
      expect(
        fetcher.mock.calls.map(([url]) =>
          String(url)
            .split("?")[0]!
            .replace(/^https?:\/\/[^/]+/, ""),
        ),
      ).toEqual(["/admin/session", path, "/admin/session"]);
      expect(String(fetcher.mock.calls[1]![0])).toContain("query=Real+name&page=2&take=25");
      for (const [, init] of fetcher.mock.calls)
        expect(init).toMatchObject({
          credentials: "include",
          cache: "no-store",
          headers: {
            "x-ayin-expected-account": actor.accountId,
            "x-ayin-expected-session": actor.sessionId,
          },
        });
      expect(result.items[0]).toMatchObject({ entityId: item.id, entityType: type });
    },
  );
  it("retains a named removed/private record without suggesting that it is publicly eligible", () => {
    expect(parseMerchandisingDirectory(directory, "VIDEO", 2).items[0]).toEqual({
      entityType: "VIDEO",
      entityId: item.id,
      label: "Actual private story",
      detail: "@actual-creator · actual-story · REMOVED · PRIVATE",
    });
  });
  it.each([
    { sessionId: "44444444-4444-4444-8444-444444444444" },
    { authVersion: 4 },
    { roles: ["FINANCE_MANAGER"] },
  ])("blocks an operation before dispatch for changed session scope %j", async (patch) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...actor, ...patch })));
    const write = vi.fn();
    await expect(
      verifiedMerchandisingOperation(actor, new AbortController().signal, write),
    ).rejects.toMatchObject({ status: 403 });
    expect(write).not.toHaveBeenCalled();
  });
  it("discards a successful directory response if the same account switched sessions during the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(response(directory))
        .mockResolvedValueOnce(
          response({ ...actor, sessionId: "44444444-4444-4444-8444-444444444444" }),
        ),
    );
    await expect(
      searchMerchandisingTargets(actor, "VIDEO", "", 2, new AbortController().signal),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("never dispatches a mutation after an aborted preflight", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        controller.abort();
        return response(actor);
      }),
    );
    const write = vi.fn();
    await expect(verifiedMerchandisingOperation(actor, controller.signal, write)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects unbounded, duplicate and mislabeled directory responses", () => {
    for (const bad of [
      { ...directory, items: [item, item] },
      { ...directory, pagination: { ...directory.pagination, take: 100 } },
      { ...directory, items: [{ ...item, id: "bad" }] },
      { ...directory, items: [{ ...item, title: "" }] },
    ])
      expect(() => parseMerchandisingDirectory(bad, "VIDEO", 2)).toThrow();
  });
  it("leaves save payloads typed, ordered and free of display metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ manualItems: [] }));
    vi.stubGlobal("fetch", fetcher);
    const items = [
      { entityType: "VIDEO" as const, entityId: item.id },
      { entityType: "PLAYLIST" as const, entityId: actor.accountId },
    ];
    await replaceAdminHomeRowManualItems(
      actor.sessionId,
      items,
      "Reviewed exact named choices",
      undefined,
      actor,
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      items,
      reason: "Reviewed exact named choices",
    });
    expect(fetcher.mock.calls[0]![1].method).toBe("PUT");
    expect(fetcher.mock.calls[0]![1].headers).toMatchObject({
      "x-ayin-expected-account": actor.accountId,
      "x-ayin-expected-session": actor.sessionId,
    });
  });
  it("treats server-bound session mismatches as identity loss, while step-up keeps the current draft", () => {
    expect(
      merchandisingIdentityFailure(new AdminWorkspaceError(409, true, false, "SESSION_CHANGED")),
    ).toBe(true);
    expect(
      merchandisingIdentityFailure(new AdminWorkspaceError(409, true, false, "ACCOUNT_CHANGED")),
    ).toBe(true);
    expect(
      merchandisingIdentityFailure(new AdminWorkspaceError(403, true, true, "STEP_UP_REQUIRED")),
    ).toBe(false);
  });
});
