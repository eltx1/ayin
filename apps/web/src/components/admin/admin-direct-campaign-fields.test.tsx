import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AdPlacement, Advertiser } from "@/lib/admin-advertising";
import {
  adminDirectCampaignAr,
  adminDirectCampaignEn,
} from "@/lib/i18n/resources/admin-direct-campaign";

import {
  AdvertiserFields,
  DirectCampaignFields,
  type CampaignDraft,
} from "./admin-direct-campaign-fields";

const draft: CampaignDraft = {
  advertiserId: "advertiser-1",
  name: "Direct launch",
  status: "DRAFT",
  startsAt: "2026-10-05T08:09:10.123",
  endsAt: "2026-10-06T11:12:13.456",
  budget: "123456789012345678.123456",
  currency: "",
  pricingModel: "CPM",
  rate: "0.123456",
  priority: "100",
  impressionGoal: "",
  frequencyCap: "0",
  pacing: "EVEN",
  placementKeys: "player.pre, saved.unknown",
  countries: "CA, JP",
  regions: "Quebec, Tokyo",
  categories: "documentary, animation",
  devices: ["TV"],
  channelIds: ["saved-channel-id"],
  videoIds: ["saved-video-id"],
};
const advertisers: Advertiser[] = [
  { id: "advertiser-1", name: "Named advertiser", status: "ACTIVE" },
];
const placements: AdPlacement[] = [
  {
    id: "placement-1",
    key: "player.pre",
    name: "Player pre-roll",
    enabled: true,
    inventoryFamily: "IN_PLAYER_VIDEO",
    format: "PRE_ROLL",
    config: null,
  },
];

function renderCampaign(
  locale: "en" | "ar",
  options: { creating?: boolean; disabled?: boolean; missingAdvertiser?: boolean } = {},
) {
  const onChange = vi.fn();
  const targetSearch = vi.fn().mockResolvedValue({ channels: [], videos: [] });
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <DirectCampaignFields
        draft={draft}
        onChange={onChange}
        advertiserOptions={options.missingAdvertiser ? [] : advertisers}
        placements={placements}
        targetSearch={targetSearch}
        disabled={options.disabled ?? false}
        creating={options.creating ?? true}
      />
    </I18nProvider>,
  );
  return { html, onChange, targetSearch };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function inputForLabel(html: string, label: string) {
  const id = html.match(new RegExp(`<label for="([^"]+)">${escapeRegExp(label)}</label>`))?.[1];
  expect(id).toBeTruthy();
  const input = html.match(new RegExp(`<input[^>]*id="${escapeRegExp(id!)}"[^>]*>`))?.[0];
  expect(input).toBeTruthy();
  return input!;
}

describe("native direct campaign fields", () => {
  it("keeps the basic creation fields simple and advanced settings in native disclosures", () => {
    const { html, onChange, targetSearch } = renderCampaign("en");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(html).toContain("<legend>Campaign details</legend>");
    expect(inputForLabel(html, "Campaign name")).toContain('required=""');
    expect(inputForLabel(html, "Find an advertiser")).toContain('type="search"');
    expect(html).toContain(
      '<option value="advertiser-1" selected="">Named advertiser · Active</option>',
    );
    for (const label of [
      adminDirectCampaignEn.campaignStatusOptions,
      adminDirectCampaignEn.schedule,
      adminDirectCampaignEn.pricing,
      adminDirectCampaignEn.delivery,
      adminDirectCampaignEn.targeting,
    ]) {
      expect(html).toContain(`<summary>${label}</summary>`);
    }
    expect(html.match(/<details[ >]/g)).toHaveLength(5);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('<option value="DRAFT" selected="">Draft</option>');
    expect(onChange).not.toHaveBeenCalled();
    expect(targetSearch).not.toHaveBeenCalled();
  });

  it("renders precise dates and monetary strings without a currency fallback or number conversion", () => {
    const { html } = renderCampaign("en");
    expect(inputForLabel(html, "Starts at")).toContain('step="0.001"');
    expect(inputForLabel(html, "Starts at")).toContain('value="2026-10-05T08:09:10.123"');
    expect(inputForLabel(html, "Ends at")).toContain('value="2026-10-06T11:12:13.456"');
    expect(inputForLabel(html, "Budget")).toContain('value="123456789012345678.123456"');
    expect(inputForLabel(html, "Budget")).not.toContain('type="number"');
    expect(inputForLabel(html, "CPM amount")).toContain('value="0.123456"');
    expect(inputForLabel(html, "Currency")).toContain('value=""');
    expect(inputForLabel(html, "Impression goal")).toContain('value=""');
    expect(inputForLabel(html, "Frequency cap per session")).toContain('value="0"');
  });

  it("makes saved unknown placements and unresolved target IDs visible and individually removable", () => {
    const { html } = renderCampaign("en", { missingAdvertiser: true });
    expect(html).toContain("Saved advertiser ID: advertiser-1");
    expect(html).toMatch(
      /<label[^>]*><input type="checkbox" checked=""\/>[\s\S]*?<bdi dir="ltr">saved\.unknown<\/bdi>/,
    );
    expect(html).toContain(adminDirectCampaignEn.savedPlacement);
    expect(html).toContain("<bdi>Channel ID</bdi>");
    expect(html).toContain('<bdi dir="ltr">saved-channel-id</bdi>');
    expect(html).toContain('aria-label="Remove: Channel ID saved-channel-id"');
    expect(html).toContain('aria-label="Remove: Video ID saved-video-id"');
    expect(html).not.toContain("Clear channel/video targeting");
    expect(html).not.toContain("Unknown channel");
    expect(draft.placementKeys).toBe("player.pre, saved.unknown");
    expect(draft.channelIds).toEqual(["saved-channel-id"]);
    expect(draft.videoIds).toEqual(["saved-video-id"]);
  });

  it("provides native Arabic labels, disclosures and ID-safe target controls", () => {
    const { html } = renderCampaign("ar");
    expect(inputForLabel(html, adminDirectCampaignAr.campaignName)).toContain('dir="auto"');
    expect(inputForLabel(html, adminDirectCampaignAr.advertiserSearch)).toContain('type="search"');
    expect(html).toContain(`<summary>${adminDirectCampaignAr.schedule}</summary>`);
    expect(html).toContain(`<summary>${adminDirectCampaignAr.pricing}</summary>`);
    expect(html).toContain(`<summary>${adminDirectCampaignAr.delivery}</summary>`);
    expect(html).toContain(`<summary>${adminDirectCampaignAr.targeting}</summary>`);
    expect(html).toContain('<option value="DRAFT" selected="">مسودة</option>');
    expect(html).toContain('aria-label="إزالة: معرّف القناة saved-channel-id"');
    expect(html).not.toContain(">Campaign name<");
    expect(html).not.toContain(">Search targets<");
    expect(html).not.toContain("legacy");
  });

  it("uses disabled native groups and prevents advertiser reassignment when editing", () => {
    const { html } = renderCampaign("en", { creating: false, disabled: true });
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*>/);
    expect(html).toContain(adminDirectCampaignEn.advertiserFixed);
    expect(html).not.toContain("Find an advertiser");
    expect(html).toMatch(
      /<button[^>]*aria-label="Remove: Channel ID saved-channel-id"[^>]*disabled=""/,
    );
  });

  it.each(["en", "ar"] as const)(
    "keeps %s advertiser creation to a name plus optional status",
    (locale) => {
      const copy = locale === "ar" ? adminDirectCampaignAr : adminDirectCampaignEn;
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <AdvertiserFields
            draft={{ name: "First advertiser", status: "ACTIVE" }}
            onChange={() => undefined}
            disabled={false}
          />
        </I18nProvider>,
      );
      expect(inputForLabel(html, copy.advertiserName)).toContain('required=""');
      expect(html).toContain(`<summary>${copy.advertiserOptions}</summary>`);
      expect(html).toContain(
        `<option value="ACTIVE" selected="">${copy.advertiserStatuses.ACTIVE}</option>`,
      );
      expect(html).not.toContain("<form");
      expect(html).not.toContain('type="submit"');
    },
  );
});
