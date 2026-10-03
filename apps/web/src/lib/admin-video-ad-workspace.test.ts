import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getVideoAdWorkspace,
  parseVideoAdSettingsRecord,
  parseVideoAdDirectory,
  parseVideoAdTarget,
  reviewVideoAdTarget,
  reviewVideoAdSettings,
  searchVideoAdTargets,
  saveVideoAdCommand,
  videoAdValues,
} from "./admin-video-ad-workspace";
const actorId = "00000000-0000-4000-8000-000000000001",
  targetId = "00000000-0000-4000-8000-000000000002",
  rowId = "00000000-0000-4000-8000-000000000003";
const actor = { accountId: actorId, roles: ["AD_MANAGER" as const] },
  stamp = "2035-01-01T00:00:00.000Z",
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
const settingsRecord = () => ({ settings, source: "STORED" as const, updatedAt: stamp });
const channel = { id: actorId, name: "Test owner", handle: "test-owner", status: "ACTIVE" };
const video = {
  id: targetId,
  title: "Test video",
  slug: "test-video",
  status: "PUBLISHED",
  channel: { id: actorId, name: channel.name, handle: channel.handle },
};
const override = () => ({
  id: rowId,
  channelId: null,
  videoId: targetId,
  enabled: false,
  preRollEnabled: null,
  midRollEnabled: null,
  postRollEnabled: null,
  provider: null,
  vastTagUrl: null,
  midRollEverySec: null,
  updatedAt: stamp,
});
const target = { kind: "VIDEO" as const, id: targetId },
  targetRecord = () =>
    parseVideoAdTarget({ kind: "VIDEO", target: video, override: override() }, target);
const filters = { page: 1, query: "", targetType: "" as const };
const directory = () => ({
  items: [{ ...override(), channel: null, video }],
  pagination: { page: 1, take: 25, total: 1, totalPages: 1, hasNext: false },
});
const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Native advertising verified configuration boundaries", () => {
  it("keeps actual default versus invalid-stored provenance and rejects fabricated versions/settings", () => {
    expect(
      parseVideoAdSettingsRecord({ settings, source: "DEFAULT", updatedAt: null }),
    ).toMatchObject({ source: "DEFAULT", updatedAt: null });
    expect(
      parseVideoAdSettingsRecord({ settings, source: "INVALID_STORED_DEFAULT", updatedAt: stamp }),
    ).toMatchObject({ source: "INVALID_STORED_DEFAULT", updatedAt: stamp });
    for (const v of [
      { ...settingsRecord(), source: "DEFAULT" },
      { ...settingsRecord(), updatedAt: null },
      { ...settingsRecord(), settings: { ...settings, frequencyCapPerSession: 51 } },
      { ...settingsRecord(), settings: { ...settings, midRollEverySec: 0 } },
      { ...settingsRecord(), settings: { ...settings, masterEnabled: "false" } },
    ])
      expect(() => parseVideoAdSettingsRecord(v)).toThrow();
  });
  it("validates exact 25-row pager arithmetic, duplicates, safe facts and real target coverage", () => {
    const parsed = parseVideoAdDirectory({ ...directory(), updatedBy: "never-ui" }, filters);
    expect(parsed).not.toHaveProperty("updatedBy");
    expect(parsed.items[0]).not.toHaveProperty("createdAt");
    for (const v of [
      { ...directory(), pagination: { ...directory().pagination, total: 2 } },
      { ...directory(), pagination: { ...directory().pagination, hasNext: true } },
      { ...directory(), items: [directory().items[0], directory().items[0]] },
      { ...directory(), items: [{ ...directory().items[0], video: { ...video, id: actorId } }] },
    ])
      expect(() => parseVideoAdDirectory(v, filters)).toThrow();
    expect(() =>
      parseVideoAdDirectory(directory(), { ...filters, targetType: "CHANNEL" }),
    ).toThrow();
  });
  it("requires the actual selected target and matching override rather than assuming missing default", () => {
    expect(
      parseVideoAdTarget({ kind: "VIDEO", target: video, override: null }, target).override,
    ).toBeNull();
    for (const v of [
      { kind: "CHANNEL", target: channel, override: null },
      { kind: "VIDEO", target: { ...video, id: actorId }, override: null },
      { kind: "VIDEO", target: video, override: { ...override(), videoId: actorId } },
    ])
      expect(() => parseVideoAdTarget(v, target)).toThrow();
  });
  it("denies Finance and Operations before any private advertising fact request", async () => {
    for (const role of ["FINANCE_MANAGER", "OPERATIONS"]) {
      const fetch = vi.fn().mockResolvedValue(response({ ...actor, roles: [role] }));
      vi.stubGlobal("fetch", fetch);
      await expect(
        getVideoAdWorkspace(filters, new AbortController().signal),
      ).rejects.toMatchObject({ status: 403 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("verifies one actor around bounded configuration reads and rejects a changed post-read role set", async () => {
    const fetch = vi.fn(async (input: string) =>
      input.endsWith("/admin/session")
        ? response(actor)
        : input.includes("settings/record")
          ? response(settingsRecord())
          : response(directory()),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await getVideoAdWorkspace(filters, new AbortController().signal)).actor).toEqual(actor);
    expect(fetch).toHaveBeenCalledTimes(4);
    let reads = 0;
    fetch.mockImplementation(async (input: string) =>
      input.endsWith("/admin/session")
        ? response(++reads === 1 ? actor : { ...actor, roles: ["ADMIN"] })
        : input.includes("settings/record")
          ? response(settingsRecord())
          : response(directory()),
    );
    await expect(getVideoAdWorkspace(filters, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("captures actual nullable settings version, accepts a real versioned ACK and sends no follow-up reads", async () => {
    const changed = { ...settings, frequencyCapPerSession: 5 },
      fetch = vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(response({ settings: changed, source: "STORED", updatedAt: next }));
    vi.stubGlobal("fetch", fetch);
    const result = await saveVideoAdCommand(
      actor,
      { kind: "SETTINGS", original: settingsRecord(), settings: changed },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ kind: "SETTINGS", record: { updatedAt: next } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedUpdatedAt: stamp,
      frequencyCapPerSession: 5,
    });
  });
  it("sends actual existing or absent override version and preserves submitted field semantics", async () => {
    const original = targetRecord(),
      values = { ...videoAdValues(original.override), midRollEverySec: 900 };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ ...override(), midRollEverySec: 900, updatedAt: next }));
    vi.stubGlobal("fetch", fetch);
    await saveVideoAdCommand(
      actor,
      { kind: "OVERRIDE", original, values },
      new AbortController().signal,
    );
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedUpdatedAt: stamp,
      midRollEverySec: 900,
      provider: null,
    });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ ...override(), ...videoAdValues(null), updatedAt: next }));
    await saveVideoAdCommand(
      actor,
      { kind: "OVERRIDE", original: { ...original, override: null }, values: videoAdValues(null) },
      new AbortController().signal,
    );
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      expectedUpdatedAt: null,
    });
  });
  it("rejects no-op settings/overrides and absent deletion before any command or actor read", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const original = targetRecord();
    expect(() =>
      saveVideoAdCommand(
        actor,
        { kind: "SETTINGS", original: settingsRecord(), settings },
        new AbortController().signal,
      ),
    ).toThrow();
    expect(() =>
      saveVideoAdCommand(
        actor,
        { kind: "OVERRIDE", original, values: videoAdValues(original.override) },
        new AbortController().signal,
      ),
    ).toThrow();
    expect(() =>
      saveVideoAdCommand(
        actor,
        { kind: "DELETE", original: { ...original, override: null }, values: videoAdValues(null) },
        new AbortController().signal,
      ),
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains lost/malformed/stale acknowledgements as uncertain started commands with no replay", async () => {
    for (const raw of [
      { ...override(), updatedAt: stamp },
      { ...override(), id: actorId, updatedAt: next },
      { ...override(), midRollEverySec: 600, updatedAt: next },
    ]) {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(response(raw));
      vi.stubGlobal("fetch", fetch);
      await expect(
        saveVideoAdCommand(
          actor,
          {
            kind: "OVERRIDE",
            original: targetRecord(),
            values: { ...videoAdValues(override()), midRollEverySec: 900 },
          },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ writeStarted: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(new Error("Lost actual transport"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveVideoAdCommand(
        actor,
        {
          kind: "SETTINGS",
          original: settingsRecord(),
          settings: { ...settings, frequencyCapPerSession: 5 },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("distinguishes exact step-up cancellation from changed authority and verifies actual delete ACK", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(
        response({ error: { code: "STEP_UP_REQUIRED", message: "Verify" } }, 403),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveVideoAdCommand(
        actor,
        { kind: "DELETE", original: targetRecord(), values: videoAdValues(override()) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, verificationRequired: true, writeStarted: true });
    fetch.mockReset().mockResolvedValueOnce(response({ ...actor, roles: ["FINANCE_MANAGER"] }));
    await expect(
      saveVideoAdCommand(
        actor,
        { kind: "DELETE", original: targetRecord(), values: videoAdValues(override()) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ deleted: true }));
    expect(
      await saveVideoAdCommand(
        actor,
        { kind: "DELETE", original: targetRecord(), values: videoAdValues(override()) },
        new AbortController().signal,
      ),
    ).toMatchObject({ kind: "DELETE", deleted: true });
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual({
      expectedUpdatedAt: stamp,
    });
  });
  it("reviews only the captured original target and real404 while preserving post-read identity verification", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    expect(await reviewVideoAdTarget(actor, target, new AbortController().signal)).toBeNull();
    expect(fetch.mock.calls[1]?.[0]).toContain("/videos/" + targetId + "/record");
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(settingsRecord()))
      .mockResolvedValueOnce(response(actor));
    expect((await reviewVideoAdSettings(actor, new AbortController().signal)).updatedAt).toBe(
      stamp,
    );
  });
  it("bounds target search and the whole read/write deadline including pre-command verification", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ channels: [channel], videos: [video] }))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    expect(
      (await searchVideoAdTargets(actor, "test", new AbortController().signal)).videos,
    ).toHaveLength(1);
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_input: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("Bounded abort")), {
            once: true,
          }),
        ),
    );
    const read = getVideoAdWorkspace(filters, new AbortController().signal);
    const checked = expect(read).rejects.toMatchObject({ message: "Bounded abort" });
    await vi.advanceTimersByTimeAsync(15001);
    await checked;
    const write = saveVideoAdCommand(
      actor,
      {
        kind: "SETTINGS",
        original: settingsRecord(),
        settings: { ...settings, frequencyCapPerSession: 5 },
      },
      new AbortController().signal,
    );
    const ended = expect(write).rejects.toMatchObject({ writeStarted: false });
    await vi.advanceTimersByTimeAsync(30001);
    await ended;
  });
});
