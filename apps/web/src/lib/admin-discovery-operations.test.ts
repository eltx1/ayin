import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultTrendingConfig,
  trendingConfigSchema,
} from "../../../api/src/platform-config/trending-settings";
import {
  getObservedSample,
  getObservedVersions,
  getTrendingConfig,
  saveTrendingConfig,
  summarizeObserved,
  trendingFields,
  validTrending,
} from "./admin-discovery-operations";
import { registerAdminVerification } from "./admin-reauthentication";

afterEach(() => vi.unstubAllGlobals());
describe("discovery operator contracts", () => {
  it("keeps client validation consistent with the authoritative API bounds", () => {
    const cases = [
      defaultTrendingConfig,
      ...trendingFields.flatMap((field) =>
        [field.min - 1, field.max + 1, NaN].map((value) => ({
          ...defaultTrendingConfig,
          [field.key]: value,
        })),
      ),
      { ...defaultTrendingConfig, recentHours: 24, windowHours: 24 },
      { ...defaultTrendingConfig, minAudienceGlobal: 100, minAudienceRegional: 50 },
      {
        ...defaultTrendingConfig,
        weights: Object.fromEntries(
          Object.keys(defaultTrendingConfig.weights).map((key) => [key, 0]),
        ) as typeof defaultTrendingConfig.weights,
      },
    ];
    for (const config of cases)
      expect(validTrending(config)).toBe(trendingConfigSchema.safeParse(config).success);
  });
  it("uses bounded authenticated observed reads with encoded version names", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ versions: [], telemetryCoverage: 0, exposures: [] })),
      );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await getObservedVersions(signal);
    await getObservedSample("version a/b", signal);
    const url = new URL(fetch.mock.calls[1]?.[0]);
    expect(url.searchParams.get("versionIds")).toBe("version a/b");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("days")).toBe("14");
    expect(fetch.mock.calls[1]?.[1]).toEqual({ credentials: "include", cache: "no-store", signal });
  });
  it("does not conflate missing attribution with completed or clicked items", () => {
    expect(
      summarizeObserved({
        versions: ["v"],
        telemetryCoverage: 0.5,
        exposures: [
          {
            exposureId: "1",
            versionId: "v",
            surface: "HOME",
            mode: "TEST",
            createdAt: "",
            outcomes: [],
          },
          {
            exposureId: "2",
            versionId: "v",
            surface: "HOME",
            mode: "TEST",
            createdAt: "",
            outcomes: [
              {
                videoId: "a",
                impression: true,
                clicked: false,
                completed: false,
                watchTimeMs: 5000,
              },
            ],
          },
        ],
      }),
    ).toEqual({ impressions: 1, clicks: 0, completions: 0, watchTimeMs: 5000 });
  });
  it("sends a reviewed config and trimmed audit reason exactly once", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(defaultTrendingConfig));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await saveTrendingConfig(defaultTrendingConfig, "  Restore tested weights  ", signal);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/admin/trending-settings"),
      {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: defaultTrendingConfig, reason: "Restore tested weights" }),
      },
    );
  });
  it("rejects invalid limits and absent reasons before sending", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveTrendingConfig(defaultTrendingConfig, " ", new AbortController().signal),
    ).rejects.toThrow("reason");
    await expect(
      saveTrendingConfig(
        { ...defaultTrendingConfig, minAudienceRegional: 1 },
        "Review",
        new AbortController().signal,
      ),
    ).rejects.toThrow("limits");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not show malformed configuration as editable defaults", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ weights: {} })));
    await expect(getTrendingConfig(new AbortController().signal)).rejects.toThrow(
      "could not be verified",
    );
  });
  it("opens step-up without replaying a settings mutation", async () => {
    const verify = vi.fn(),
      unregister = registerAdminVerification(verify);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: "STEP_UP_REQUIRED", message: "Verify again" } },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        saveTrendingConfig(
          defaultTrendingConfig,
          "Review configuration",
          new AbortController().signal,
        ),
      ).rejects.toThrow("Verify again");
      expect(verify).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });
  it("does not automatically replay a lost save response", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Connection lost"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveTrendingConfig(
        defaultTrendingConfig,
        "Review configuration",
        new AbortController().signal,
      ),
    ).rejects.toThrow("Connection lost");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
