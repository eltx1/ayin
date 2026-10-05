import { describe, expect, it } from "vitest";
import {
  reconcileAdvertisingRead,
  type AdvertisingEditableRecords,
} from "./admin-advertising-drafts";
const original: AdvertisingEditableRecords = {
  page: {
    masterEnabled: false,
    googleGptEnabled: false,
    house: { imageUrl: null, clickUrl: null, altText: null },
  },
  ads: "# original web",
  appAds: "# original app",
};
const incoming: AdvertisingEditableRecords = {
  page: {
    masterEnabled: true,
    googleGptEnabled: false,
    house: {
      imageUrl: "https://example.test/fresh.png",
      clickUrl: null,
      altText: "Fresh server value",
    },
  },
  ads: "# new web",
  appAds: "# new app",
};
describe("manual Advertising read reconciliation", () => {
  it("refreshes all clean forms without retaining stale server values", () => {
    expect(reconcileAdvertisingRead(original, structuredClone(original), incoming)).toEqual(
      incoming,
    );
  });
  it.each(["page", "ads", "appAds"] as const)(
    "retains the independent dirty %s form while refreshing the others",
    (key) => {
      const dirty: AdvertisingEditableRecords = {
        page: {
          masterEnabled: false,
          googleGptEnabled: false,
          house: {
            imageUrl: "https://example.test/local-draft.png",
            clickUrl: null,
            altText: "Local draft",
          },
        },
        ads: "# local web",
        appAds: "# local app",
      };
      const current = { ...structuredClone(original), [key]: dirty[key] };
      const result = reconcileAdvertisingRead(original, current, incoming);
      expect(result).toEqual({ ...incoming, [key]: dirty[key] });
      expect(current).toEqual({ ...original, [key]: dirty[key] });
    },
  );
  it("preserves edits made during a read by using the current response-time draft", () => {
    const requestStart = structuredClone(original);
    const current = { ...requestStart, ads: "# typed while reading", appAds: "# also retained" };
    expect(reconcileAdvertisingRead(original, current, incoming)).toEqual({
      ...incoming,
      ads: current.ads,
      appAds: current.appAds,
    });
    expect(requestStart).toEqual(original);
  });
  it("refreshes reverted clean fields and retains independently edited empty seller text", () => {
    expect(reconcileAdvertisingRead(original, { ...original, ads: "" }, incoming)).toEqual({
      ...incoming,
      ads: "",
    });
    expect(reconcileAdvertisingRead(original, structuredClone(original), incoming)).toEqual(
      incoming,
    );
  });
});
