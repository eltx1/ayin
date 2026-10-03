import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminVideoError,
  getAdminVideos,
  parseAdminVideo,
  parseAdminVideoDirectory,
  parseAdminVideoAck,
  saveAdminVideo,
  videoCommand,
  bulkVerifiedAdminVideos,
  reviewAdminVideo,
  reviewAdminVideoTargets,
} from "./admin-video-workspace";
const targetId = "00000000-0000-4000-8000-000000000001",
  actorId = "00000000-0000-4000-8000-000000000002";
const stamp = "2035-01-01T00:00:00.000Z",
  next = "2035-01-01T00:00:00.001Z";
const actor = { accountId: actorId, roles: ["CONTENT_MODERATOR" as const] };
const filters = { page: 1, query: "", status: "", visibility: "" };
const row = () => ({
  id: targetId,
  slug: "actual-video",
  title: "Actual title",
  description: null,
  status: "VALIDATING",
  visibility: "PRIVATE",
  videoForm: "CLIP",
  commentsEnabled: true,
  updatedAt: stamp,
  publishedAt: null,
  channel: { id: actorId, name: "Actual channel", handle: "actual-channel", status: "ACTIVE" },
  tvControl: null,
  tvPreferences: [{ tvChannelId: targetId, included: false, priority: -100000, sortOrder: null }],
  _count: { comments: 0, reports: 0 },
});
const directory = () => ({ items: [row()], pagination: { page: 1, take: 25, pages: 1, total: 1 } });
const command = () => ({
  title: "Actual new title",
  description: "",
  status: "VALIDATING" as const,
  visibility: "PRIVATE" as const,
  commentsEnabled: true,
  reason: " Actual reviewed reason ",
});
const ack = () => ({
  id: targetId,
  title: "Actual new title",
  status: "VALIDATING",
  visibility: "PRIVATE",
  commentsEnabled: true,
  updatedAt: next,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Native video verified single/bulk command boundaries", () => {
  it("retains real Clip/processing/null/negative-priority facts and strips extra sensitive projections", () => {
    const parsed = parseAdminVideo({ ...row(), providerSecret: "never-ui" });
    expect(parsed).toMatchObject({
      videoForm: "CLIP",
      status: "VALIDATING",
      publishedAt: null,
      description: null,
      counts: { comments: 0, reports: 0 },
    });
    expect(parsed.tvPreferences[0]?.priority).toBe(-100000);
    expect(parsed).not.toHaveProperty("providerSecret");
    for (const changed of [
      { videoForm: "SHORT_FORM" },
      { commentsEnabled: "true" },
      { tvPreferences: Array(101).fill({}) },
      { _count: { comments: -1, reports: 0 } },
      { tvPreferences: [{ ...row().tvPreferences[0], priority: -100001 }] },
    ])
      expect(() => parseAdminVideo({ ...row(), ...changed })).toThrow();
    expect(() => parseAdminVideo(row(), actorId)).toThrow();
  });
  it("validates actual default/explicit TV facts and sends the selected preference version rather than an unrelated preference", () => {
    const control = {
      id: targetId,
      name: "Actual TV",
      status: "ACTIVE",
      included: true,
      origin: "DEFAULT",
      updatedAt: null,
    };
    const record = parseAdminVideo({ ...row(), tvControl: control });
    const payload = videoCommand(record, { ...command(), title: record.title, tvIncluded: false });
    expect(payload).toMatchObject({
      tvIncluded: false,
      expectedTvPreference: { tvChannelId: targetId, updatedAt: null },
    });
    for (const changed of [
      { origin: "DEFAULT", included: false },
      { origin: "DEFAULT", updatedAt: stamp },
      { origin: "EXPLICIT", updatedAt: null },
    ])
      expect(() => parseAdminVideo({ ...row(), tvControl: { ...control, ...changed } })).toThrow();
    expect(() =>
      videoCommand(parseAdminVideo(row()), { ...command(), tvIncluded: false }),
    ).toThrow();
    const removed = { ...command(), status: "REMOVED" as const, tvIncluded: true };
    const explicit = parseAdminVideo({
      ...row(),
      tvControl: { ...control, included: false, origin: "EXPLICIT", updatedAt: stamp },
    });
    expect(
      parseAdminVideoAck(
        {
          ...ack(),
          status: "REMOVED",
          tvControl: { id: targetId, included: false, origin: "EXPLICIT", updatedAt: next },
        },
        explicit,
        removed,
      ).tvControl?.included,
    ).toBe(false);
    expect(() =>
      parseAdminVideoAck(
        {
          ...ack(),
          status: "REMOVED",
          tvControl: { id: targetId, included: true, origin: "EXPLICIT", updatedAt: next },
        },
        explicit,
        removed,
      ),
    ).toThrow();
  });
  it("rejects duplicate/false pagination/filter facts while preserving actual zero", () => {
    for (const value of [
      { ...directory(), items: [] },
      { ...directory(), items: [row(), row()] },
      { ...directory(), pagination: { page: 1, take: 100, total: 1, pages: 1 } },
    ])
      expect(() => parseAdminVideoDirectory(value, filters)).toThrow();
    expect(() =>
      parseAdminVideoDirectory(directory(), { ...filters, visibility: "PUBLIC" }),
    ).toThrow();
    expect(
      parseAdminVideoDirectory(
        { items: [], pagination: { page: 1, take: 25, total: 0, pages: 1 } },
        filters,
      ).pagination.total,
    ).toBe(0);
  });
  it("sends an actual original version and omits unchanged processing status; rejects no-op/removal/short reason before writing", () => {
    const record = parseAdminVideo(row()),
      payload = videoCommand(record, command());
    expect(payload.expectedUpdatedAt).toBe(stamp);
    expect(payload.reason).toBe("Actual reviewed reason");
    expect(payload).not.toHaveProperty("status");
    expect(payload.description).toBeNull();
    expect(() => videoCommand(record, { ...command(), title: record.title })).toThrow();
    expect(() => videoCommand(record, { ...command(), reason: "short" })).toThrow();
    expect(() => videoCommand({ ...record, status: "REMOVED" }, command())).toThrow();
    expect(() => videoCommand(record, { ...command(), status: "UPLOADING" })).toThrow();
    expect(videoCommand(record, { ...command(), status: "PUBLISHED" }).status).toBe("PUBLISHED");
  });
  it("accepts only the smaller matching monotonic command acknowledgment", () => {
    const record = parseAdminVideo(row());
    expect(
      parseAdminVideoAck({ ...ack(), channel: row().channel }, record, command()),
    ).not.toHaveProperty("channel");
    for (const changed of [
      { id: actorId },
      { title: "Other title" },
      { visibility: "PUBLIC" },
      { commentsEnabled: false },
      { updatedAt: stamp },
      { status: "PUBLISHED" },
    ])
      expect(() => parseAdminVideoAck({ ...ack(), ...changed }, record, command())).toThrow();
  });
  it("allows scoped Content Moderator reads, denies Finance before facts and rejects changed identity after the read", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(directory()))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    expect(
      (await getAdminVideos(filters, new AbortController().signal)).directory.items,
    ).toHaveLength(1);
    fetch.mockReset().mockResolvedValueOnce(response({ ...actor, roles: ["FINANCE_MANAGER"] }));
    await expect(getAdminVideos(filters, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(directory()))
      .mockResolvedValueOnce(response({ ...actor, accountId: targetId }));
    await expect(getAdminVideos(filters, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("bounds the whole read and aborts pending facts instead of leaving role/data work unbounded", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockImplementationOnce(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              signal = init.signal;
              signal!.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        ),
    );
    const read = getAdminVideos(filters, new AbortController().signal);
    const rejected = expect(read).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(signal?.aborted).toBe(true);
  });
  it("marks actual malformed/lost single responses uncertain with one explicit write and no automatic read or replay", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ ...ack(), id: actorId }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveAdminVideo(actor, parseAdminVideo(row()), command(), new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(fetch.mock.calls[1]?.[1].body);
    expect(payload.expectedUpdatedAt).toBe(stamp);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(new Error("lost actual response"));
    await expect(
      saveAdminVideo(actor, parseAdminVideo(row()), command(), new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("sends exact all-target bulk versions, accepts only complete acknowledgments and rejects invalid selections before any request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ affected: 1, action: "UNPUBLISH" }, 201));
    vi.stubGlobal("fetch", fetch);
    const record = parseAdminVideo(row());
    expect(
      await bulkVerifiedAdminVideos(
        actor,
        [record],
        "UNPUBLISH",
        "Actual reviewed bulk",
        new AbortController().signal,
      ),
    ).toEqual({ affected: 1, action: "UNPUBLISH", ids: [targetId] });
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body).expectedVideos).toEqual([
      { id: targetId, updatedAt: stamp },
    ]);
    fetch.mockReset();
    for (const records of [[], [record, record], [{ ...record, status: "REMOVED" as const }]])
      await expect(
        bulkVerifiedAdminVideos(
          actor,
          records,
          "UNPUBLISH",
          "Actual reviewed bulk",
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(AdminVideoError);
    expect(fetch).not.toHaveBeenCalled();
    fetch
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ affected: 0, action: "UNPUBLISH" }));
    await expect(
      bulkVerifiedAdminVideos(
        actor,
        [record],
        "UNPUBLISH",
        "Actual reviewed bulk",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("recovers only the exact original record, preserves real missing404 and verifies actor before and after", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ error: "missing" }, 404))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    expect(await reviewAdminVideo(actor, targetId, new AbortController().signal)).toBeNull();
    expect(fetch.mock.calls[1]?.[0]).toContain("/admin/control/videos/" + targetId);
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ ...row(), id: actorId }));
    await expect(reviewAdminVideo(actor, targetId, new AbortController().signal)).rejects.toThrow();
  });
  it("reviews every captured bulk target with at most four concurrent reads and preserves input order and real404", async () => {
    vi.useFakeTimers();
    const ids = Array.from(
      { length: 9 },
      (_, n) => `00000000-0000-4000-8000-${String(n + 10).padStart(12, "0")}`,
    );
    let active = 0,
      peak = 0,
      sessionReads = 0;
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBeUndefined();
      if (url.endsWith("/admin/session")) {
        sessionReads++;
        return response(actor);
      }
      const current = url.split("/").at(-1)!;
      seen.push(current);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10 + (9 - ids.indexOf(current)) * 5));
      active--;
      return current === ids[2] ? response({}, 404) : response({ ...row(), id: current });
    });
    vi.stubGlobal("fetch", fetch);
    const pending = reviewAdminVideoTargets(actor, ids, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(peak).toBe(4);
    expect(seen).toEqual(ids);
    expect(sessionReads).toBe(2);
    expect(result.map((entry) => entry.id)).toEqual(ids);
    expect(result[2]?.record).toBeNull();
    expect(result.filter((entry) => entry.record)).toHaveLength(8);
  });
  it("discards partial bulk recovery and aborts other reads on a real failed target", async () => {
    const ids = [targetId, actorId];
    let pendingSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/admin/session")) return response(actor);
      if (url.endsWith(targetId)) return response({}, 503);
      return new Promise<Response>((_resolve, reject) => {
        pendingSignal = init.signal as AbortSignal;
        pendingSignal.addEventListener("abort", () =>
          reject(new Error("aborted partial recovery")),
        );
      });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      reviewAdminVideoTargets(actor, ids, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
    expect(pendingSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("bounds the entire multi-target recovery to15seconds and rejects identity changes after all facts", async () => {
    vi.useFakeTimers();
    let pendingSignal: AbortSignal | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            pendingSignal = init.signal;
            pendingSignal!.addEventListener("abort", () => reject(new Error("expired")));
          }),
      );
    vi.stubGlobal("fetch", fetch);
    const pending = reviewAdminVideoTargets(actor, [targetId], new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(pendingSignal?.aborted).toBe(true);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(row()))
      .mockResolvedValueOnce(response({ ...actor, roles: ["FINANCE_MANAGER"] }));
    await expect(
      reviewAdminVideoTargets(actor, [targetId], new AbortController().signal),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects duplicate, malformed and excessive recovery targets before any private request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const ids of [[], [targetId, targetId], ["invalid"], Array(101).fill(targetId)])
      await expect(
        reviewAdminVideoTargets(actor, ids, new AbortController().signal),
      ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
