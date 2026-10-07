import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import {
  advertisingEditorAr,
  advertisingEditorEn,
} from "@/lib/i18n/resources/admin-advertising-editor";
import type { AdPlacement, Campaign, Creative } from "@/lib/admin-advertising";
import {
  CreativeEditor,
  CreativeManager,
  InventoryManager,
  SellerEditor,
  creativeDraft,
} from "./admin-advertising-editors";
const retainedDrafts = vi.hoisted(() => new Map<string, unknown>());
afterEach(() => retainedDrafts.clear());
vi.mock("./admin-advertising-draft-shelf", async () => {
  const { useState } = await import("react");
  return {
    useAdvertisingDraft: (key: string, initial: unknown) =>
      useState(() =>
        retainedDrafts.has(key)
          ? retainedDrafts.get(key)
          : typeof initial === "function"
            ? (initial as () => unknown)()
            : initial,
      ),
  };
});
const draft = {
  name: "",
  type: "DISPLAY" as const,
  status: "DRAFT" as const,
  destinationUrl: null,
  vastTagUrl: null,
  headline: null,
  body: null,
  direct: { assetUrl: null, width: null, height: null, approvedReference: null },
};
function verifyLabels(html: string) {
  const controls = [...html.matchAll(/<(?:input|textarea|select)\b[^>]*id="([^"]+)"/g)];
  expect(controls.length).toBeGreaterThan(0);
  expect(new Set(controls.map((m) => m[1])).size).toBe(controls.length);
  for (const [, id] of controls) expect(html).toContain(`for="${id}"`);
}
describe("Native Advertising editor labels and controls", () => {
  it("keeps full route-local EN/AR key parity", () => {
    expect(Object.keys(advertisingEditorAr).sort()).toEqual(
      Object.keys(advertisingEditorEn).sort(),
    );
    for (const value of Object.values(advertisingEditorAr)) expect(value.trim()).not.toBe("");
  });
  it.each(["en", "ar"] as const)(
    "labels every inventory, creative and seller control in %s",
    (locale) => {
      const copy = locale === "ar" ? advertisingEditorAr : advertisingEditorEn;
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <InventoryManager placements={[]} busy={false} onAct={async () => false} />
          <CreativeEditor
            campaigns={[]}
            draft={draft}
            busy={false}
            mode="create"
            onChange={() => undefined}
            onSubmit={async () => undefined}
          />
          <SellerEditor
            label="ads.txt"
            value=""
            automaticRows={[]}
            finalText=""
            busy={false}
            onChange={() => undefined}
            onSave={() => undefined}
          />
        </I18nProvider>,
      );
      verifyLabels(html);
      for (const label of [
        copy.width,
        copy.height,
        copy.campaignSearch,
        copy.manualSeller,
        copy.publish,
        copy.PRE_ROLL,
        copy.DRAFT,
      ])
        expect(html).toContain(label.replace(/&/g, "&amp;"));
      expect(html).not.toContain(">PRE_ROLL<");
      expect(html).not.toContain(">DRAFT<");
      expect(html).toContain('type="url"');
      expect(html).toContain('maxLength="65536"');
    },
  );
  it("disables the native creative form during a pending write", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <CreativeEditor
          campaigns={[]}
          draft={draft}
          busy
          mode="edit"
          onChange={() => undefined}
          onSubmit={async () => undefined}
        />
      </I18nProvider>,
    );
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
  it("keeps drafts editable during reads while mutations remain disabled", () => {
    for (const editor of [
      <InventoryManager
        key="inventory"
        placements={[]}
        busy
        editingDisabled={false}
        onAct={async () => false}
      />,
      <CreativeEditor
        key="creative"
        campaigns={[]}
        draft={draft}
        busy
        editingDisabled={false}
        mode="edit"
        onChange={() => undefined}
        onSubmit={async () => undefined}
      />,
      <SellerEditor
        key="seller"
        label="ads.txt"
        value=""
        automaticRows={[]}
        finalText=""
        busy
        editingDisabled={false}
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    ]) {
      const html = renderToStaticMarkup(<I18nProvider locale="en">{editor}</I18nProvider>);
      expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
      expect(html).toMatch(/<button[^>]*disabled=""/);
    }
  });
});

const placement: AdPlacement = {
  id: "placement-fixture",
  key: "fixture-placement",
  name: "Original name",
  enabled: false,
  inventoryFamily: "OUTSIDE_PLAYER",
  format: "DISPLAY",
  config: null,
};
const creative: Creative = {
  ...draft,
  id: "creative-fixture",
  campaignId: "campaign-fixture",
  mediaAssetId: null,
  name: "Original name",
};
for (const kind of ["placement", "creative"] as const) {
  describe(`${kind} acknowledged edit reconciliation`, () => {
    it.each([
      {
        label: "retained ACK before the next read",
        revision: 5,
        incoming: "Original name",
        local: "Saved name",
        expected: "Saved name",
        conflict: false,
      },
      {
        label: "newer edit while the follow-up read is held or fails",
        revision: 5,
        incoming: "Original name",
        local: "Newer draft",
        expected: "Newer draft",
        conflict: false,
      },
      {
        label: "newer edit when the acknowledged record is read",
        revision: 6,
        incoming: "Saved name",
        local: "Newer draft",
        expected: "Newer draft",
        conflict: false,
      },
      {
        label: "fresh read that genuinely restores the old record",
        revision: 6,
        incoming: "Original name",
        local: "Saved name",
        expected: "Original name",
        conflict: false,
      },
      {
        label: "fresh conflicting read with a newer draft",
        revision: 6,
        incoming: "Original name",
        local: "Newer draft",
        expected: "Newer draft",
        conflict: true,
      },
    ])(
      "preserves the correct values for $label",
      ({ revision, incoming, local, expected, conflict }) => {
        const id = kind === "placement" ? placement.id : creative.id;
        const saved =
          kind === "placement"
            ? { name: "Saved name", format: placement.format }
            : { ...creativeDraft(creative), name: "Saved name" };
        retainedDrafts.set(`${kind}-${id}-base`, saved);
        retainedDrafts.set(`${kind}-${id}-draft`, { ...saved, name: local });
        retainedDrafts.set(`${kind}-${id}-acknowledged-read`, 5);
        retainedDrafts.set(`creative-${id}-open`, true);
        const html = renderToStaticMarkup(
          <I18nProvider locale="en">
            {kind === "placement" ? (
              <InventoryManager
                placements={[{ ...placement, name: incoming }]}
                readRevision={revision}
                busy={false}
                onAct={async () => false}
              />
            ) : (
              <CreativeManager
                campaigns={[
                  {
                    id: creative.campaignId,
                    name: "Campaign",
                    advertiser: { name: "Advertiser" },
                  } as Campaign,
                ]}
                creatives={[{ ...creative, name: incoming }]}
                readRevision={revision}
                busy={false}
                onAct={async () => false}
              />
            )}
          </I18nProvider>,
        );
        expect(html).toContain(`value="${expected}"`);
        if (expected !== incoming) expect(html).not.toContain(`value="${incoming}"`);
        expect(html.includes(advertisingEditorEn.changed)).toBe(conflict);
        if (conflict) expect(html).toContain(`<span>${advertisingEditorEn.changed}</span>`);
      },
    );
  });
}
