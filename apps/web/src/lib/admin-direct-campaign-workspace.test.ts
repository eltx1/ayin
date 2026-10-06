import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DirectWriteError,
  parseAdvertiser,
  parseCampaign,
  parseDirectOutcome,
  parseDirectWorkspace,
  readDirectWorkspace,
  reviewDirectCommand,
  saveDirectCommand,
  searchDirectTargets,
  type DirectCommand,
} from "./admin-direct-campaign-workspace";
import {
  campaignDraft,
  campaignValues,
  editorCommand,
  editorDirty,
  editorDraft,
  newCampaignDraft,
  reconcileDirectEditor,
} from "./admin-direct-campaign-drafts";
const aid = "00000000-0000-4000-8000-000000000001",
  cid = "00000000-0000-4000-8000-000000000002",
  mid = "00000000-0000-4000-8000-000000000003",
  uid = "00000000-0000-4000-8000-000000000004";
const stamp = "2030-01-01T00:00:00.000Z",
  next = "2030-01-01T00:00:00.001Z";
const actor = { accountId: uid, roles: ["AD_MANAGER" as const], sessionId: mid, authVersion: 1 };
const advertiser = () => ({
  id: aid,
  name: "Test advertiser",
  status: "ACTIVE" as const,
  updatedAt: stamp,
});
const campaign = () => ({
  id: cid,
  advertiserId: aid,
  advertiser: { name: "Test advertiser" },
  name: "Test campaign",
  status: "DRAFT" as const,
  startsAt: "2030-02-01T10:20:30.123Z",
  endsAt: "2030-03-01T10:20:30.789Z",
  budget: "12345678901234.123456",
  currency: null,
  updatedAt: stamp,
  direct: {
    priority: 999,
    pricing: { model: "FIXED" as const, cpm: null, fixedPrice: "98765432109876.123456" },
    impressionGoal: 999999999,
    frequencyCap: 0,
    pacing: "ASAP" as const,
    targeting: {
      placementKeys: ["unknown-key"],
      countries: ["US"],
      regions: ["saved, literal"],
      categories: ["saved-category"],
      devices: ["TV" as const],
      channelIds: [aid],
      videoIds: [cid],
    },
  },
});
const command = (): DirectCommand => ({
  mutationId: mid,
  kind: "advertiser",
  action: "update",
  original: advertiser(),
  values: { name: "Renamed advertiser", status: "ACTIVE" },
});
const outcome = () => ({
  acknowledgment: {
    mutationId: mid,
    actorAccountId: uid,
    action: "ADVERTISER_UPDATED",
    entityType: "Advertiser",
    entityId: aid,
    updatedAt: next,
  },
  record: { ...advertiser(), name: "Renamed advertiser", updatedAt: next },
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Direct advertising exact records and retained intent", () => {
  it("validates coherent records and rejects malformed/versionless/cross-parent snapshots", () => {
    expect(
      parseDirectWorkspace({ advertisers: [advertiser()], campaigns: [campaign()] }).campaigns[0]
        ?.direct?.frequencyCap,
    ).toBe(0);
    for (const input of [
      null,
      { ...advertiser(), updatedAt: null },
      { ...advertiser(), status: "UNKNOWN" },
    ])
      expect(() => parseAdvertiser(input)).toThrow();
    for (const input of [
      { ...campaign(), direct: { ...campaign().direct, frequencyCap: 101 } },
      { ...campaign(), budget: 123 },
      {
        ...campaign(),
        direct: { ...campaign().direct, impressionGoal: Number.MAX_SAFE_INTEGER + 1 },
      },
    ])
      expect(() => parseCampaign(input)).toThrow();
    expect(() =>
      parseDirectWorkspace({ advertisers: [advertiser(), advertiser()], campaigns: [] }),
    ).toThrow();
    expect(() =>
      parseDirectWorkspace({
        advertisers: [{ ...advertiser(), name: "Different name" }],
        campaigns: [campaign()],
      }),
    ).toThrow();
  });
  it("keeps exact stored decimal/date/null/direct values when a name-only edit is saved", () => {
    const original = parseCampaign(campaign()),
      draft = campaignDraft(original);
    expect(draft.budget).toBe("12345678901234.123456");
    expect(draft.rate).toBe("98765432109876.123456");
    expect(draft.startsAt).toMatch(/30\.123$/);
    expect(draft.currency).toBe("");
    expect(campaignValues({ ...draft, name: "Only new name" }, original)).toEqual({
      name: "Only new name",
    });
    expect(campaignValues({ ...draft, priority: "1000" }, original)).toEqual({
      direct: { ...original.direct, priority: 1000 },
    });
    const absent = { ...original, direct: null };
    expect(campaignValues({ ...campaignDraft(absent), name: "Another name" }, absent)).toEqual({
      name: "Another name",
    });
  });
  it("has a simple draft default and never coerces invalid quantities or exact money", () => {
    const draft = { ...newCampaignDraft(), name: "New draft", advertiserId: aid };
    const cmd = editorCommand(
      { kind: "campaign", original: null, draft },
      mid,
      [advertiser()],
      "create",
    );
    expect(cmd.values).toMatchObject({
      status: "DRAFT",
      expectedAdvertiserUpdatedAt: stamp,
      advertiserId: aid,
      direct: { frequencyCap: 3, priority: 100 },
    });
    for (const changed of [
      { priority: "" },
      { frequencyCap: "" },
      { impressionGoal: "9007199254740992" },
      { rate: "1e3" },
      { budget: "-1" },
      { endsAt: "2001-01-01", startsAt: "2002-01-01" },
    ])
      expect(() => campaignValues({ ...draft, ...changed }, null)).toThrow();
  });
  it("keeps dirty/in-flight editor versions through manual read, updates clean drafts only", () => {
    const original = advertiser(),
      clean = editorDraft("advertiser", original),
      fresh = { ...original, name: "Fresh name", updatedAt: next };
    expect(editorDirty(clean)).toBe(false);
    expect(reconcileDirectEditor(clean, [fresh], [])?.original).toEqual(fresh);
    const dirty = { ...clean, draft: { ...clean.draft, name: "Unsent name" } } as typeof clean;
    expect(editorDirty(dirty)).toBe(true);
    expect(reconcileDirectEditor(dirty, [fresh], [])).toBe(dirty);
    expect(reconcileDirectEditor(clean, [fresh], [], true)).toBe(clean);
    expect(reconcileDirectEditor(dirty, [], [])).toBe(dirty);
  });
  it("checks exact command/actor/action/entity/version acknowledgment", () => {
    expect(parseDirectOutcome(outcome(), actor, command()).record?.name).toBe("Renamed advertiser");
    for (const patch of [
      { mutationId: uid },
      { actorAccountId: aid },
      { action: "CAMPAIGN_UPDATED" },
      { entityId: cid },
      { updatedAt: stamp },
    ])
      expect(() =>
        parseDirectOutcome(
          { ...outcome(), acknowledgment: { ...outcome().acknowledgment, ...patch } },
          actor,
          command(),
        ),
      ).toThrow();
    expect(() =>
      parseDirectOutcome(
        { ...outcome(), record: { ...outcome().record, name: "Different" } },
        actor,
        command(),
      ),
    ).toThrow();
  });
  it("accepts database decimal formatting without losing numeric precision", () => {
    const original = parseCampaign(campaign()),
      cmd: DirectCommand = {
        mutationId: mid,
        kind: "campaign",
        action: "update",
        original,
        values: {
          budget: "000123.120000",
          direct: {
            ...original.direct!,
            pricing: { model: "CPM", cpm: "001.000000", fixedPrice: null },
          },
        },
      };
    const result = {
      acknowledgment: {
        ...outcome().acknowledgment,
        action: "CAMPAIGN_UPDATED",
        entityType: "Campaign",
        entityId: cid,
      },
      record: {
        ...original,
        updatedAt: next,
        budget: "123.12",
        direct: { ...original.direct, pricing: { model: "CPM", cpm: "1", fixedPrice: null } },
      },
    };
    expect(parseDirectOutcome(result, actor, cmd).record).not.toBeNull();
  });
});
describe("Direct advertising no-replay transport", () => {
  it("fences uncached snapshots with complete role/account checks", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ advertisers: [advertiser()], campaigns: [campaign()] }))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(readDirectWorkspace(new AbortController().signal, actor)).resolves.toMatchObject({
      actor,
    });
    for (const [, options] of fetch.mock.calls)
      expect(options).toMatchObject({
        credentials: "include",
        cache: "no-store",
        headers: { "x-ayin-expected-account": uid, "x-ayin-expected-session": mid },
        signal: expect.any(AbortSignal),
      });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ advertisers: [], campaigns: [] }))
      .mockResolvedValueOnce(response({ ...actor, roles: ["ADMIN"] }));
    await expect(readDirectWorkspace(new AbortController().signal, actor)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("distinguishes a failed record read with verified identity from an unverified identity boundary", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(readDirectWorkspace(new AbortController().signal, actor)).rejects.toMatchObject({
      status: 500,
      identityUnverified: false,
    });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({}, 500))
      .mockRejectedValueOnce(Error("identity read lost"));
    await expect(readDirectWorkspace(new AbortController().signal, actor)).rejects.toMatchObject({
      identityUnverified: true,
    });
  });
  it("retains session-conflict code separately from an optimistic record conflict", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ error: { code: "SESSION_CHANGED" } }, 409));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveDirectCommand(actor, command(), new AbortController().signal),
    ).rejects.toMatchObject({ status: 409, code: "SESSION_CHANGED", writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("denies identity or Finance-only changes before a mutation is sent", async () => {
    for (const changed of [
      { ...actor, accountId: aid },
      { ...actor, sessionId: cid },
      { ...actor, authVersion: 2 },
      { ...actor, roles: ["FINANCE_MANAGER"] },
      { ...actor, roles: ["AD_MANAGER", "ADMIN"] },
    ]) {
      const fetch = vi.fn().mockResolvedValueOnce(response(changed));
      vi.stubGlobal("fetch", fetch);
      await expect(
        saveDirectCommand(actor, command(), new AbortController().signal),
      ).rejects.toMatchObject({ status: 403, writeStarted: false, acknowledged: null });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("makes exactly one correlated write with original version and no automatic record refresh", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(outcome()))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveDirectCommand(actor, command(), new AbortController().signal),
    ).resolves.toEqual(outcome());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "PATCH",
      headers: {
        "x-ayin-expected-account": uid,
        "x-ayin-expected-session": mid,
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
      ...command().values,
      expectedUpdatedAt: stamp,
      mutationId: mid,
    });
  });
  it("keeps acknowledged commit distinct from a failed identity read", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(outcome()))
      .mockRejectedValueOnce(Error("lost read"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveDirectCommand(actor, command(), new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true, acknowledged: outcome() });
    expect(fetch.mock.calls.filter(([, init]) => init.method)).toHaveLength(1);
  });
  it("never replays lost/rejected/malformed writes and distinguishes step-up", async () => {
    for (const status of [400, 403, 409, 500]) {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(
          response({ error: { code: status === 403 ? "STEP_UP_REQUIRED" : "REJECTED" } }, status),
        );
      vi.stubGlobal("fetch", fetch);
      await expect(
        saveDirectCommand(actor, command(), new AbortController().signal),
      ).rejects.toMatchObject({
        status,
        writeStarted: true,
        acknowledged: null,
        verificationRequired: status === 403,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(Error("response lost"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveDirectCommand(actor, command(), new AbortController().signal),
    ).rejects.toBeInstanceOf(DirectWriteError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("conceals failed or malformed identity checks during target and audit reads, preserving a verified audit acknowledgment", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const failed of [response({}, 500), response({ accountId: uid, roles: ["AD_MANAGER"] })]) {
      fetch.mockReset().mockResolvedValueOnce(failed);
      await expect(
        searchDirectTargets(actor, "target", new AbortController().signal),
      ).rejects.toMatchObject({ identityUnverified: true });
    }
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ acknowledgment: outcome().acknowledgment }))
      .mockRejectedValueOnce(Error("identity failed after audit"));
    await expect(
      reviewDirectCommand(actor, command(), new AbortController().signal),
    ).rejects.toMatchObject({ identityUnverified: true, acknowledgment: outcome().acknowledgment });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response(actor));
    await expect(
      searchDirectTargets(actor, "target", new AbortController().signal),
    ).rejects.toMatchObject({ identityUnverified: false });
    expect(fetch.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("recovers only original actor-owned audit identity and keeps not-found unknown", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ acknowledgment: outcome().acknowledgment }))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(
      reviewDirectCommand(actor, command(), new AbortController().signal),
    ).resolves.toEqual(outcome().acknowledgment);
    expect(fetch.mock.calls.every(([, init]) => !init.method)).toBe(true);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(actor));
    await expect(
      reviewDirectCommand(actor, command(), new AbortController().signal),
    ).resolves.toBeNull();
  });
});
