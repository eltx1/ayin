import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
import {
  adminAdvertisingEn,
  adminAdvertisingAr,
} from "../../apps/web/src/lib/i18n/resources/admin-advertising";
import {
  advertisingEditorEn,
  advertisingEditorAr,
} from "../../apps/web/src/lib/i18n/resources/admin-advertising-editor";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type Row = { id: string; name: string };
type Fixture = {
  accountId: string;
  prefix: string;
  advertisers: Row[];
  campaigns: Row[];
  creative: Row;
  placement: Row & { key: string };
};
function db<T>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/admin-advertising-editor-fixture.mjs"),
        command,
        JSON.stringify(payload),
      ],
      { env: process.env, encoding: "utf8" },
    ),
  ) as T;
}
let fixture: Fixture | undefined;
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  fixture = undefined;
});
test.afterEach(() => {
  if (fixture) db("cleanup", fixture);
});
async function seed(page: Page) {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Synthetic advertising editor",
      email: `ad-editor-${randomUUID()}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const accountId = (await response.json()).user.account.id;
  await enrollMfa(page.request);
  fixture = { accountId, ...db<Omit<Fixture, "accountId">>("seed", { accountId }) };
  return fixture;
}
async function open(
  page: Page,
  locale: "en" | "ar",
  section: "inventory" | "creatives" | "sellers",
) {
  const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
  await page.goto("/admin/advertising?lang=" + locale);
  await expect(page.getByRole("button", { name: copy.refresh, exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: copy[section], exact: true }).click();
  return page.getByRole("tabpanel");
}
function evidence(data: Fixture) {
  return db<{
    creatives: Array<Row & { campaignId: string }>;
    placements: Array<Row & { key: string; enabled: boolean }>;
    audits: Array<{ action: string; entityId: string }>;
  }>("evidence", data);
}
async function shots(page: Page, info: TestInfo, locale: string, state: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.getByRole("main").getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    for (const control of await page
      .getByRole("tabpanel")
      .locator("input,select,textarea,button")
      .all()) {
      if (!(await control.isVisible())) continue;
      expect(
        await control.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.left >= -1 &&
            r.right <= innerWidth + 1 &&
            ((n instanceof HTMLInputElement && n.type === "checkbox") || r.height >= 40)
          );
        }),
      ).toBe(true);
      if (await control.evaluate((n) => n.matches("input:not([type=checkbox]),select,textarea")))
        expect(await control.evaluate((n) => Boolean((n as HTMLInputElement).labels?.length))).toBe(
          true,
        );
    }
    await page.screenshot({
      path: info.outputPath(`advertising-editor-${locale}-${width}-${state}.png`),
      fullPage: true,
      style: "html{scroll-behavior:auto!important}",
    });
  }
}
for (const locale of ["en", "ar"] as const) {
  test(`Advertising native editors ${locale}: original 390/1440 layouts, labels, scoped campaign search and real synthetic writes`, async ({
    page,
  }, info) => {
    const data = await seed(page),
      copy = locale === "ar" ? advertisingEditorAr : advertisingEditorEn,
      area = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
    const panel = await open(page, locale, "inventory");
    const inventory = panel
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: copy.inventoryTitle, exact: true }) });
    const form = inventory.locator("form").first();
    await form.getByLabel(copy.key, { exact: true }).fill(data.prefix + "created");
    await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "New placement");
    await form.getByLabel(copy.width, { exact: true }).fill("0");
    await form.getByRole("button", { name: copy.createPlacement, exact: true }).click();
    expect(evidence(data).audits.filter((a) => a.action === "AD_PLACEMENT_CREATED")).toHaveLength(
      0,
    );
    await form.getByLabel(copy.width, { exact: true }).fill("300");
    await inventory.getByText(copy.configuration, { exact: true }).first().click();
    await shots(page, info, locale, "inventory");
    await form.getByRole("button", { name: copy.createPlacement, exact: true }).click();
    await expect(page.getByText(copy.placementCreated, { exact: true })).toBeVisible();
    await expect(form.getByLabel(copy.key, { exact: true })).toHaveValue("");
    const created = evidence(data).placements.find((p) => p.key === data.prefix + "created");
    expect(created?.enabled).toBe(false);
    await page.getByRole("tab", { name: area.creatives, exact: true }).click();
    const creativeForm = panel.locator("form").first();
    await creativeForm.getByLabel(copy.campaignSearch, { exact: true }).fill(data.prefix);
    await expect(
      creativeForm.getByLabel(copy.campaign, { exact: true }).locator("option"),
    ).toHaveCount(103);
    await creativeForm
      .getByLabel(copy.campaignSearch, { exact: true })
      .fill(data.advertisers[1]!.name);
    await expect(
      creativeForm.getByLabel(copy.campaign, { exact: true }).locator("option"),
    ).toHaveCount(2);
    await creativeForm
      .getByLabel(copy.campaign, { exact: true })
      .selectOption(data.campaigns[101]!.id);
    await creativeForm.getByLabel(copy.name, { exact: true }).fill(data.prefix + "New creative");
    await creativeForm.getByLabel(copy.type, { exact: true }).selectOption("DISPLAY");
    const card = panel
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: data.creative.name, exact: true }) });
    await card.getByRole("button", { name: copy.edit, exact: true }).click();
    await shots(page, info, locale, "creative");
    await creativeForm.getByRole("button", { name: copy.createCreative, exact: true }).click();
    await expect(page.getByText(copy.creativeCreated, { exact: true })).toBeVisible();
    await expect(creativeForm.getByLabel(copy.name, { exact: true })).toHaveValue("");
    expect(
      evidence(data).creatives.find((c) => c.name === data.prefix + "New creative")?.campaignId,
    ).toBe(data.campaigns[101]!.id);
    await card.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Retained edit");
    await page.getByRole("button", { name: area.refresh, exact: true }).click();
    await expect(page.getByRole("button", { name: area.refresh, exact: true })).toBeEnabled();
    await expect(card.getByLabel(copy.name, { exact: true })).toHaveValue(
      data.prefix + "Retained edit",
    );
    await card.getByRole("button", { name: copy.close, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(card.getByLabel(copy.name, { exact: true })).toHaveValue(
      data.prefix + "Retained edit",
    );
    await page.getByRole("tab", { name: area.sellers, exact: true }).click();
    await panel
      .getByLabel(copy.manualSeller, { exact: true })
      .first()
      .fill("# Synthetic draft only. No seller relationship.");
    await panel.getByText(copy.preview, { exact: true }).first().click();
    await shots(page, info, locale, "sellers");
    await expect(
      panel.getByRole("button", { name: copy.publish, exact: true }).first(),
    ).toBeEnabled();
    expect(
      evidence(data).audits.filter((a) => a.action === "AUTHORIZED_SELLER_FILE_UPDATED"),
    ).toHaveLength(0);
  });
}

test("MFA rejection keeps the original creative draft and target with no replay", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "creatives"),
    copy = advertisingEditorEn;
  const form = panel.locator("form").first();
  await form.getByLabel(copy.campaign, { exact: true }).selectOption(data.campaigns[0]!.id);
  await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "MFA draft");
  let writes = 0;
  await page.route(API + "/admin/advertising/creatives", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "STEP_UP_REQUIRED", message: "Verify session" } }),
    });
  });
  await form.getByRole("button", { name: copy.createCreative, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Confirm your identity" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form.getByLabel(copy.name, { exact: true })).toHaveValue(data.prefix + "MFA draft");
  await expect(form.getByLabel(copy.campaign, { exact: true })).toHaveValue(data.campaigns[0]!.id);
  await expect(page.getByText(copy.verify, { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  expect(evidence(data).audits.filter((a) => a.action === "CREATIVE_CREATED")).toHaveLength(0);
});

test("A committed creative with a lost response stays uncertain through current reads and newer history", async ({
  page,
}) => {
  const data = await seed(page),
    copy = advertisingEditorEn;
  await page.goto("/admin/video-ads?lang=en");
  await expect(
    page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
  ).toBeEnabled();
  await page.getByRole("link", { name: adminAdvertisingEn.pageArea, exact: true }).click();
  await expect(
    page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: adminAdvertisingEn.creatives, exact: true }).click();
  const form = page.getByRole("tabpanel").locator("form").first();
  await form.getByLabel(copy.campaign, { exact: true }).selectOption(data.campaigns[0]!.id);
  await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Unknown result");
  let writes = 0;
  await page.route(API + "/admin/advertising/creatives", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await form.getByRole("button", { name: copy.createCreative, exact: true }).click();
  await expect(page.getByText(copy.uncertain, { exact: true })).toBeVisible();
  await expect(form.getByLabel(copy.name, { exact: true })).toHaveValue(
    data.prefix + "Unknown result",
  );
  await expect(form.getByRole("button", { name: copy.createCreative, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }).click();
  await expect(page.getByRole("button", { name: copy.review, exact: true })).toBeEnabled();
  await expect(page.getByText(copy.creativeCreated, { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/video-ads/);
  await page.goForward();
  await expect(page.getByText(copy.uncertain, { exact: true })).toBeVisible();
  await expect(form.getByLabel(copy.name, { exact: true })).toHaveValue(
    data.prefix + "Unknown result",
  );
  await expect(form.getByRole("button", { name: copy.createCreative, exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  expect(evidence(data).audits.filter((a) => a.action === "CREATIVE_CREATED")).toHaveLength(1);
});

test("A successful placement save remains successful when the follow-up read fails", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "inventory"),
    copy = advertisingEditorEn;
  const form = panel
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: copy.inventoryTitle, exact: true }) })
    .locator("form")
    .first();
  await form.getByLabel(copy.key, { exact: true }).fill(data.prefix + "read-failure");
  await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Acknowledged");
  await page.route(API + "/admin/advertising/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "TEMPORARY" } }),
    }),
  );
  await form.getByRole("button", { name: copy.createPlacement, exact: true }).click();
  await expect(page.getByText(copy.placementCreated, { exact: true })).toBeVisible();
  await expect(page.getByText(adminAdvertisingEn.readError, { exact: true })).toBeVisible();
  await expect(form.getByLabel(copy.key, { exact: true })).toHaveValue("");
  expect(evidence(data).audits.filter((a) => a.action === "AD_PLACEMENT_CREATED")).toHaveLength(1);
});

test("A held preflight with revoked current authority cannot dispatch or retain private drafts", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "creatives"),
    copy = advertisingEditorEn;
  const form = panel.locator("form").first();
  await form.getByLabel(copy.campaign, { exact: true }).selectOption(data.campaigns[0]!.id);
  await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Private draft");
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>((r) => {
      release = r;
    }),
    seen = new Promise<void>((r) => {
      reached = r;
    });
  await page.route(API + "/admin/session", async (route) => {
    reached();
    await held;
    await route.continue();
  });
  await form.getByRole("button", { name: copy.createCreative, exact: true }).click();
  await seen;
  db("revoke-role", data);
  release();
  await expect(page.getByText(copy.access, { exact: true })).toBeVisible();
  await expect(page.locator("[data-advertising-private]")).toHaveCount(0);
  expect(evidence(data).audits.filter((a) => a.action === "CREATIVE_CREATED")).toHaveLength(0);
});

test("A frozen native surface is concealed synchronously before React can repaint", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "creatives"),
    copy = advertisingEditorEn;
  const form = panel.locator("form").first();
  await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Private text");
  const result = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>("[data-advertising-private]")!;
    // Exercise native checked/default state too; changing these properties does
    // not dispatch an application event or save a setting.
    node
      .querySelectorAll<HTMLInputElement>("input[type=checkbox],input[type=radio]")
      .forEach((input) => {
        input.checked = true;
        input.defaultChecked = true;
        input.value = "Synthetic private checkbox value";
      });
    document.dispatchEvent(new Event("freeze"));
    return {
      hidden: node.hidden,
      inert: node.inert,
      values: Array.from(
        node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input:not([type=checkbox]):not([type=radio]),textarea",
        ),
        (input) => ({ value: input.value, defaultValue: input.defaultValue }),
      ),
      toggles: Array.from(
        node.querySelectorAll<HTMLInputElement>("input[type=checkbox],input[type=radio]"),
        (input) => ({
          checked: input.checked,
          defaultChecked: input.defaultChecked,
          valueAttribute: input.getAttribute("value"),
        }),
      ),
      selected: Array.from(node.querySelectorAll("select"), (select) => ({
        index: select.selectedIndex,
        options: Array.from(select.options, (option) => ({
          selected: option.selected,
          defaultSelected: option.defaultSelected,
        })),
      })),
    };
  });
  expect(result.hidden).toBe(true);
  expect(result.inert).toBe(true);
  expect(result.values.length).toBeGreaterThan(0);
  expect(result.values.every((input) => input.value === "" && input.defaultValue === "")).toBe(
    true,
  );
  expect(result.toggles.length).toBeGreaterThan(0);
  expect(
    result.toggles.every(
      (input) => !input.checked && !input.defaultChecked && input.valueAttribute === null,
    ),
  ).toBe(true);
  expect(result.selected.length).toBeGreaterThan(0);
  expect(
    result.selected.every(
      (select) =>
        select.index === -1 &&
        select.options.every((option) => !option.selected && !option.defaultSelected),
    ),
  ).toBe(true);
  expect(evidence(data).audits).toHaveLength(0);
});

test("A dirty original creative survives a refresh but cannot silently overwrite a changed record", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "creatives"),
    copy = advertisingEditorEn;
  const card = panel
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: data.creative.name, exact: true }) });
  await card.getByRole("button", { name: copy.edit, exact: true }).click();
  await card.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Local draft");
  db("change-creative", data);
  await page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }).click();
  const updated = panel
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: data.prefix + "concurrent", exact: true }) });
  await expect(updated.getByText(copy.changed, { exact: true })).toBeVisible();
  await expect(updated.getByLabel(copy.name, { exact: true })).toHaveValue(
    data.prefix + "Local draft",
  );
  await expect(
    updated.getByRole("button", { name: copy.saveCreative, exact: true }),
  ).toBeDisabled();
  expect(evidence(data).audits).toHaveLength(0);
});

for (const kind of ["creative", "placement"] as const) {
  test(`An acknowledged ${kind} draft is reset before a held refresh and same-session history change`, async ({
    page,
  }) => {
    const data = await seed(page),
      copy = advertisingEditorEn;
    await page.goto("/admin/video-ads?lang=en");
    await expect(
      page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
    ).toBeEnabled();
    await page.getByRole("link", { name: adminAdvertisingEn.pageArea, exact: true }).click();
    await expect(
      page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("tab", {
        name: kind === "creative" ? adminAdvertisingEn.creatives : adminAdvertisingEn.inventory,
        exact: true,
      })
      .click();
    const panel = page.getByRole("tabpanel");
    const form =
      kind === "creative"
        ? panel.locator("form").first()
        : panel
            .locator("section")
            .filter({ has: page.getByRole("heading", { name: copy.inventoryTitle, exact: true }) })
            .locator("form")
            .first();
    await form.getByLabel(copy.name, { exact: true }).fill(data.prefix + "Accepted original");
    if (kind === "creative")
      await form.getByLabel(copy.campaign, { exact: true }).selectOption(data.campaigns[0]!.id);
    else await form.getByLabel(copy.key, { exact: true }).fill(data.prefix + "accepted-original");
    let release!: () => void,
      reached!: () => void,
      writes = 0;
    const held = new Promise<void>((r) => {
        release = r;
      }),
      seen = new Promise<void>((r) => {
        reached = r;
      });
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url() ===
          API + "/admin/advertising/" + (kind === "creative" ? "creatives" : "placements")
      )
        writes++;
    });
    await page.route(API + "/admin/advertising/overview", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      reached();
      await held;
      await route.fulfill({ response }).catch(() => undefined);
    });
    const action = kind === "creative" ? copy.createCreative : copy.createPlacement;
    await form.getByRole("button", { name: action, exact: true }).click();
    await seen;
    await expect(form.getByLabel(copy.name, { exact: true })).toHaveValue("");
    await expect(
      page.getByText(kind === "creative" ? copy.creativeCreated : copy.placementCreated, {
        exact: true,
      }),
    ).toBeVisible();
    const nextDraft = data.prefix + "Next unsaved draft";
    await expect(form.getByLabel(copy.name, { exact: true })).toBeEnabled();
    await form.getByLabel(copy.name, { exact: true }).fill(nextDraft);
    await expect(form.getByRole("button", { name: action, exact: true })).toBeDisabled();
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/video-ads/);
    release();
    await page.unroute(API + "/admin/advertising/overview");
    await page.goForward();
    await expect(
      page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
    ).toBeEnabled();
    await expect(form.getByLabel(copy.name, { exact: true })).toHaveValue(nextDraft);
    if (kind === "placement")
      await expect(form.getByLabel(copy.key, { exact: true })).toHaveValue("");
    else await expect(form.getByRole("button", { name: action, exact: true })).toBeEnabled();
    await expect(page.getByText(copy.uncertain, { exact: true })).toHaveCount(0);
    expect(writes).toBe(1);
    expect(
      evidence(data).audits.filter(
        (a) => a.action === (kind === "creative" ? "CREATIVE_CREATED" : "AD_PLACEMENT_CREATED"),
      ),
    ).toHaveLength(1);
  });
}

for (const kind of ["creative", "placement"] as const) {
  test(`An acknowledged existing ${kind} stays current through a held read and retains newer edits across history`, async ({
    page,
  }) => {
    const data = await seed(page),
      copy = advertisingEditorEn;
    await page.goto("/admin/video-ads?lang=en");
    await expect(
      page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
    ).toBeEnabled();
    await page.getByRole("link", { name: adminAdvertisingEn.pageArea, exact: true }).click();
    await expect(
      page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("tab", {
        name: kind === "creative" ? adminAdvertisingEn.creatives : adminAdvertisingEn.inventory,
        exact: true,
      })
      .click();
    const panel = page.getByRole("tabpanel");
    const card =
      kind === "creative"
        ? panel.locator("article").first()
        : panel.locator("article").filter({
            has: page.getByText(data.placement.key, { exact: true }),
          });
    if (kind === "creative")
      await card.getByRole("button", { name: copy.edit, exact: true }).click();
    const acceptedName = data.prefix + "Accepted edit",
      newerName = data.prefix + "Newer unsaved edit",
      name = card.getByLabel(copy.name, { exact: true }),
      save = card.getByRole("button", {
        name: kind === "creative" ? copy.saveCreative : copy.save,
        exact: true,
      });
    await name.fill(acceptedName);
    let release!: () => void,
      reached!: () => void,
      writes = 0;
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      seen = new Promise<void>((resolve) => {
        reached = resolve;
      });
    const endpoint =
      API +
      "/admin/advertising/" +
      (kind === "creative" ? "creatives/" + data.creative.id : "placements/" + data.placement.id);
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url() === endpoint) writes++;
    });
    await page.route(API + "/admin/advertising/overview", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      reached();
      await held;
      await route.fulfill({ response }).catch(() => undefined);
    });
    try {
      await save.click();
      await seen;
      await expect(name).toHaveValue(acceptedName);
      await expect(name).toBeEnabled();
      await expect(save).toBeDisabled();
      await expect(card.getByText(copy.changed, { exact: true })).toHaveCount(0);
      await name.fill(newerName);
      await expect(name).toHaveValue(newerName);
      await expect(save).toBeDisabled();
      await page.goBack();
      await expect(page).toHaveURL(/\/admin\/video-ads/);
    } finally {
      release();
      await page.unroute(API + "/admin/advertising/overview");
    }
    await page.goForward();
    await expect(
      page.getByRole("button", { name: adminAdvertisingEn.refresh, exact: true }),
    ).toBeEnabled();
    await expect(name).toHaveValue(newerName);
    await expect(save).toBeEnabled();
    await expect(card.getByText(copy.changed, { exact: true })).toHaveCount(0);
    await expect(page.getByText(copy.uncertain, { exact: true })).toHaveCount(0);
    const result = evidence(data),
      rows = kind === "creative" ? result.creatives : result.placements,
      id = kind === "creative" ? data.creative.id : data.placement.id;
    expect(rows.find((row) => row.id === id)?.name).toBe(acceptedName);
    expect(writes).toBe(1);
    expect(
      result.audits.filter(
        (audit) =>
          audit.entityId === id &&
          audit.action === (kind === "creative" ? "CREATIVE_UPDATED" : "AD_PLACEMENT_UPDATED"),
      ),
    ).toHaveLength(1);
  });
}
