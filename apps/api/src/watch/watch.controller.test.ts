import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { PublicWatchController } from "./watch.controller.js";

function controller() {
  const watch = {
    getPublicPlayback: vi.fn().mockResolvedValue({ detail: { seriesContext: null } }),
  };
  const localization = { localizeSeriesContext: vi.fn() };
  return {
    watch,
    localization,
    controller: new PublicWatchController(
      watch as never,
      { countryFromHeaders: () => "JP" } as never,
      localization as never,
    ),
  };
}

describe("public playback query boundary", () => {
  it("rejects repeated, nested, blank and oversized locale before loading or localizing playback", async () => {
    const fixture = controller();
    for (const query of [
      { locale: ["ar", "en"] },
      { locale: { name: "ar" } },
      { "locale[name]": "ar" },
      { "locale[]": "ar" },
      { "locale.name": "ar" },
      { locale: "" },
      { locale: "a".repeat(36) },
    ]) {
      await expect(fixture.controller.playback("episode", query, {})).rejects.toMatchObject({
        status: 400,
        response: { error: { code: "INVALID_PLAYBACK_QUERY" } },
      });
    }
    expect(fixture.watch.getPublicPlayback).not.toHaveBeenCalled();
    expect(fixture.localization.localizeSeriesContext).not.toHaveBeenCalled();
  });
  it("retains default and Kids behavior and forwards only a bounded scalar locale", async () => {
    const fixture = controller();
    await fixture.controller.playback("video", {}, {});
    expect(fixture.watch.getPublicPlayback).toHaveBeenLastCalledWith("video", "JP", false);
    await fixture.controller.playback("legacy", { kids: ["1", "0"], tracking: "unchanged" }, {});
    expect(fixture.watch.getPublicPlayback).toHaveBeenLastCalledWith("legacy", "JP", false);
    await fixture.controller.playback("kids", { kids: "1", locale: " ar " }, {});
    expect(fixture.watch.getPublicPlayback).toHaveBeenLastCalledWith("kids", "JP", true);
    const context = { series: { id: "s", title: "Original" } };
    fixture.watch.getPublicPlayback.mockResolvedValue({ detail: { seriesContext: context } });
    fixture.localization.localizeSeriesContext.mockResolvedValue({ ...context, nextEpisode: null });
    await fixture.controller.playback("episode", { locale: " ar " }, {});
    expect(fixture.localization.localizeSeriesContext).toHaveBeenCalledWith(context, "ar");
  });
});
