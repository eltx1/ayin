import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAdminHomeRow,
  getAdminProductControls,
  mergeHomeRowFields,
  parseRegionTargets,
  updateAdminProductControls,
  updateAdminHomeDiscoveryMode,
  type AdminHomeRow,
  type CreateAdminHomeRow,
  type ProductControls,
} from "./admin-product";
import { AdminWorkspaceError } from "./verified-admin-transport";
import { registerAdminVerification } from "./admin-reauthentication";
afterEach(() => vi.unstubAllGlobals());
describe("merchandising drafts and request contracts", () => {
  it("normalizes regional targets and enforces the backend shape and limit", () => {
    expect(parseRegionTargets("de, JP de\nBR")).toEqual(["DE", "JP", "BR"]);
    expect(parseRegionTargets("de، jp، DE")).toEqual(["DE", "JP"]);
    expect(parseRegionTargets("  ")).toEqual([]);
    expect(() => parseRegionTargets("DE, invalid")).toThrow("INVALID_REGIONS");
    expect(() =>
      parseRegionTargets(
        Array.from({ length: 65 }, (_, i) =>
          String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
        ).join(","),
      ),
    ).toThrow();
  });
  it("applies only confirmed fields without losing same-row or unrelated drafts", () => {
    const rows = [
      { id: "one", title: "Unsaved title", targetRegions: [], manualItems: [] },
      { id: "two", title: "Other draft" },
    ] as unknown as AdminHomeRow[];
    const result = mergeHomeRowFields(
      rows,
      "one",
      { title: "Persisted old title", targetRegions: ["DE"] },
      ["targetRegions"],
    );
    expect(result[0]).toEqual({ ...rows[0], targetRegions: ["DE"] });
    expect(result[1]).toBe(rows[1]);
    expect(rows[0]!.targetRegions).toEqual([]);
    expect(mergeHomeRowFields(rows, "one", {}, ["manualItems"])[0]!.manualItems).toEqual([]);
  });
  it("uses a single abortable private snapshot read without caching", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [],
          controls: {},
          homeDiscoveryMode: "INHERIT",
          homeRowsRevision: "a".repeat(64),
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await getAdminProductControls(signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/admin/product-controls"),
      expect.objectContaining({ credentials: "include", cache: "no-store", signal }),
    );
  });
});

const sectionInput = (): CreateAdminHomeRow => ({
  requestId: "11111111-1111-4111-8111-111111111111",
  expectedRowsRevision: "a".repeat(64),
  key: "documentaries",
  title: "وثائقيات",
  source: "RECENTLY_ADDED",
  audience: "ALL",
  enabled: false,
  maxItems: 12,
  regionPersonalizationRequired: false,
  targetRegions: ["GB", "FR"],
  confirmManagedTransition: true,
  reason: "Create a reviewed section",
});
const sectionResponse = () => ({
  row: {
    id: sectionInput().requestId,
    key: "documentaries",
    title: "وثائقيات",
    source: "RECENTLY_ADDED",
    audience: "ALL",
    enabled: false,
    maxItems: 12,
    position: 0,
    regionPersonalizationRequired: false,
    targetRegions: ["FR", "GB"],
    manualItems: [],
  },
  replayed: false,
  homeRowsRevision: "b".repeat(64),
});

describe("Admin home composition and creation contracts", () => {
  it("writes a confirmed mode once through settings and verifies a fresh saved snapshot", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            key: "homeDiscoveryMode",
            value: "AUTO",
            highImpact: true,
            changed: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rows: [],
            controls: {},
            homeDiscoveryMode: "AUTO",
            homeRowsRevision: "a".repeat(64),
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(
      updateAdminHomeDiscoveryMode("AUTO", "Reviewed catalog home", true, signal),
    ).resolves.toBe("AUTO");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![0]).toContain("/admin/settings/homeDiscoveryMode");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "PATCH", signal, cache: "no-store" });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      value: "AUTO",
      reason: "Reviewed catalog home",
      confirmHighImpact: true,
    });
    expect(fetcher.mock.calls[1]![0]).toContain("/admin/product-controls");
    expect(fetcher.mock.calls[1]![1].method).toBeUndefined();
  });

  it("does not claim mode success when readback differs, and does not replay the mutation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            key: "homeDiscoveryMode",
            value: "AUTO",
            highImpact: true,
            changed: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rows: [],
            controls: {},
            homeDiscoveryMode: "MANAGED",
            homeRowsRevision: "a".repeat(64),
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      updateAdminHomeDiscoveryMode("AUTO", "Reviewed catalog home", true),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("requires explicit high-impact confirmation before sending a settings mutation", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      updateAdminHomeDiscoveryMode("AUTO", "Reviewed catalog home", false),
    ).rejects.toBeInstanceOf(AdminWorkspaceError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves denied scope on mode readback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            key: "homeDiscoveryMode",
            value: "AUTO",
            highImpact: true,
            changed: true,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "ADMIN_FORBIDDEN", message: "Access changed" } }),
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      updateAdminHomeDiscoveryMode("AUTO", "Reviewed catalog home", true),
    ).rejects.toMatchObject({ status: 403, code: "ADMIN_FORBIDDEN" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves the creation request ID, revision, disabled state and explicit transition review", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(sectionResponse())));
    vi.stubGlobal("fetch", fetcher);
    const result = await createAdminHomeRow(sectionInput());
    expect(result.row.enabled).toBe(false);
    expect(result.homeRowsRevision).toBe("b".repeat(64));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      ...sectionInput(),
      targetRegions: ["FR", "GB"],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      ...sectionResponse(),
      row: { ...sectionResponse().row, id: "22222222-2222-4222-8222-222222222222" },
    },
    { ...sectionResponse(), row: { ...sectionResponse().row, enabled: true } },
    { ...sectionResponse(), homeRowsRevision: "invalid" },
  ])("rejects an unrelated or unverifiable creation acknowledgment", async (response) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetcher);
    await expect(createAdminHomeRow(sectionInput())).rejects.toMatchObject({ writeStarted: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never automatically retries a lost creation response", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Response lost"));
    vi.stubGlobal("fetch", fetcher);
    await expect(createAdminHomeRow(sectionInput())).rejects.toThrow("Response lost");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).requestId).toBe(sectionInput().requestId);
  });
});

const productDraft = (): ProductControls => ({
  navigation: [{ key: "home", label: "Home", href: "/", enabled: true, featureFlag: null }],
  hero: { entityType: null, entityId: null },
  taxonomy: [{ key: "original-key", label: "قصص، ثقافة", enabled: false }],
  announcement: { enabled: true, text: "أهلاً", href: "/tv" },
  deviceVisibility: { web: true, mobile: false, tv: true },
});

describe("product control mutation confirmation", () => {
  it("round-trips exact stable keys, Arabic labels and disabled states after documented trimming", async () => {
    const draft = productDraft();
    draft.taxonomy[0]!.label = "  قصص، ثقافة  ";
    draft.announcement.text = "  أهلاً  ";
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(productDraft())));
    vi.stubGlobal("fetch", fetcher);
    await expect(updateAdminProductControls(draft, "Review categories")).resolves.toEqual(
      productDraft(),
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      ...productDraft(),
      reason: "Review categories",
    });
    expect(draft.taxonomy[0]).toEqual({
      key: "original-key",
      label: "  قصص، ثقافة  ",
      enabled: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ok: true },
    { ...productDraft(), taxonomy: [] },
    { ...productDraft(), taxonomy: [{ ...productDraft().taxonomy[0], enabled: true }] },
    { ...productDraft(), deviceVisibility: { web: true, mobile: true, tv: true } },
  ])(
    "does not report an incomplete or different success response as this saved draft",
    async (response) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response)));
      vi.stubGlobal("fetch", fetcher);
      await expect(
        updateAdminProductControls(productDraft(), "Review categories"),
      ).rejects.toMatchObject({ writeStarted: true });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps step-up distinct, and never replays generic 400, lost responses or verification requests", async () => {
    const verify = vi.fn();
    const unregister = registerAdminVerification(verify);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "STEP_UP_REQUIRED", message: "Verify first" } }),
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "UNKNOWN", message: "Generic 400" } }), {
          status: 400,
        }),
      )
      .mockRejectedValueOnce(new TypeError("Response lost"));
    vi.stubGlobal("fetch", fetcher);
    const draft = productDraft();
    try {
      await expect(updateAdminProductControls(draft, "Review categories")).rejects.toMatchObject({
        verificationRequired: true,
      });
      expect(verify).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(updateAdminProductControls(draft, "Review categories")).rejects.toBeInstanceOf(
        AdminWorkspaceError,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      await expect(updateAdminProductControls(draft, "Review categories")).rejects.toThrow(
        "Response lost",
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(draft).toEqual(productDraft());
    } finally {
      unregister();
    }
  });
});
