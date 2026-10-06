import type { PageAdSettings } from "./admin-advertising";

export type AdvertisingEditableRecords = {
  page: PageAdSettings | null;
  ads: string;
  appAds: string;
};

function samePage(a: PageAdSettings | null, b: PageAdSettings | null) {
  if (a === null || b === null) return a === b;
  return (
    a.masterEnabled === b.masterEnabled &&
    a.googleGptEnabled === b.googleGptEnabled &&
    a.house.imageUrl === b.house.imageUrl &&
    a.house.clickUrl === b.house.clickUrl &&
    a.house.altText === b.house.altText
  );
}

// Manual reads refresh clean forms independently. Compare the latest draft at
// response time, not the request-start value, so in-flight edits remain local.
// This never merges a draft into a request or writes to the server.
export function reconcileAdvertisingRead(
  original: AdvertisingEditableRecords,
  current: AdvertisingEditableRecords,
  incoming: AdvertisingEditableRecords,
): AdvertisingEditableRecords {
  return {
    page: samePage(current.page, original.page) ? incoming.page : current.page,
    ads: current.ads === original.ads ? incoming.ads : current.ads,
    appAds: current.appAds === original.appAds ? incoming.appAds : current.appAds,
  };
}

// A verified campaign deletion also removes its cascade-deleted creative rows.
// Apply this to an older outstanding read as well, so it cannot resurrect them.
export function retainCampaignCreatives<T extends { campaignId: string }>(
  values: T[],
  currentCampaignIds: ReadonlySet<string>,
): T[] {
  return values.filter((value) => currentCampaignIds.has(value.campaignId));
}
