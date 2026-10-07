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
  adminDirectCampaignEn,
  adminDirectCampaignAr,
} from "../../apps/web/src/lib/i18n/resources/admin-direct-campaign";
import { advertisingEditorEn } from "../../apps/web/src/lib/i18n/resources/admin-advertising-editor";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type RecordRow = { id: string; name: string; updatedAt: string };
type Fixture = {
  accountId: string;
  email: string;
  recoveryCode: string;
  prefix: string;
  advertisers: RecordRow[];
  campaigns: RecordRow[];
};
function db<T>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/admin-direct-campaign-fixture.mjs"),
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
  fixture = undefined;
});
test.afterEach(() => {
  if (fixture) db("cleanup", fixture);
});
async function seed(page: Page) {
  const email = "native-direct-" + randomUUID() + "@e2e.ayin.test";
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Native direct operator",
      email,
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const accountId = (await response.json()).user.account.id;
  const mfa = await enrollMfa(page.request);
  fixture = {
    accountId,
    email,
    recoveryCode: mfa.recoveryCodes[0]!,
    ...db<Omit<Fixture, "accountId" | "email" | "recoveryCode">>("seed", { accountId }),
  };
  return fixture;
}
async function open(page: Page, locale: "en" | "ar", kind: "advertisers" | "campaigns") {
  const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
  await page.goto("/admin/advertising?lang=" + locale);
  await page.getByRole("tab", { name: copy[kind], exact: true }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("button", {
      name: locale === "ar" ? "قراءة السجلات الحالية" : "Read current records",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.getByRole("tabpanel").locator("[data-direct-private]")).toBeVisible();
  return page.getByRole("tabpanel");
}
async function shots(page: Page, info: TestInfo, locale: string, state: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page
      .getByRole("main")
      .getByRole("heading", { level: 1 })
      .evaluate((n) =>
        n.closest("header")?.scrollIntoView({ block: "start", behavior: "instant" }),
      );
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
    for (const node of await page.getByRole("tabpanel").locator("input,select,button").all()) {
      if (!(await node.isVisible())) continue;
      expect(
        await node.evaluate((n) => {
          const target =
            n instanceof HTMLInputElement && n.type === "checkbox" ? (n.closest("label") ?? n) : n;
          const r = target.getBoundingClientRect();
          return r.left >= -1 && r.right <= innerWidth + 1 && r.height >= 40;
        }),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`design-direct-${locale}-${width}-${state}.png`),
      fullPage: true,
      style: "html {scroll-behavior:auto!important}",
    });
  }
}
function evidence(data: Fixture) {
  return db<{
    campaigns: Array<Record<string, unknown>>;
    audits: Array<{ action: string; entityId: string; metadata: Record<string, unknown> }>;
    configs: Array<Record<string, unknown>>;
  }>("evidence", data);
}
for (const locale of ["en", "ar"] as const) {
  test(`Direct advertiser/campaign ${locale} native search, paging, simple draft and actual audited save`, async ({
    page,
  }, info) => {
    const data = await seed(page),
      copy = locale === "ar" ? adminDirectCampaignAr : adminDirectCampaignEn,
      nav = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
    const panel = await open(page, locale, "advertisers");
    await panel
      .getByLabel(locale === "ar" ? "البحث عن معلنين" : "Search advertisers", { exact: true })
      .fill(data.prefix);
    await expect(
      panel.getByRole("button", { name: locale === "ar" ? "التالي" : "Next", exact: true }),
    ).toBeEnabled();
    await shots(page, info, locale, "advertisers");
    await panel
      .getByRole("button", { name: locale === "ar" ? "التالي" : "Next", exact: true })
      .click();
    await expect(
      panel.getByText(locale === "ar" ? "الصفحة 2 من 2" : "Page 2 of 2", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: nav.campaigns, exact: true }).click();
    await panel
      .getByRole("button", { name: locale === "ar" ? "حملة جديدة" : "New campaign", exact: true })
      .click();
    await panel.getByLabel(copy.campaignName, { exact: true }).fill(data.prefix + "created-draft");
    await panel.getByLabel(copy.advertiserSearch, { exact: true }).fill(data.advertisers[0]!.name);
    await panel.getByLabel(copy.advertiser, { exact: true }).selectOption(data.advertisers[0]!.id);
    await expect(panel.locator("details[open]")).toHaveCount(0);
    await shots(page, info, locale, "new-draft");
    await panel
      .getByRole("button", {
        name: locale === "ar" ? "إنشاء مسودة حملة" : "Create campaign draft",
        exact: true,
      })
      .click();
    await expect(
      panel.getByText(
        locale === "ar"
          ? "تم حفظ الإجراء وتسجيله للمراجعة. لم يُكرّر أي إجراء."
          : "The action was committed and recorded in the audit log. No action was repeated.",
        { exact: true },
      ),
    ).toBeVisible();
    const result = evidence(data),
      created = result.campaigns.find((r) => r.name === data.prefix + "created-draft");
    expect(created?.status).toBe("DRAFT");
    expect(
      result.audits.filter((r) => r.action === "CAMPAIGN_CREATED" && r.entityId === created?.id),
    ).toHaveLength(1);
    await shots(page, info, locale, "committed");
    await page.getByRole("tab", { name: nav.creatives, exact: true }).click();
    const createdOption = page.getByRole("tabpanel").getByRole("option", {
      name: `${data.prefix}created-draft · ${data.advertisers[0]!.name}`,
      exact: true,
    });
    await expect(createdOption).toHaveCount(1);
    expect(created?.id).toEqual(expect.any(String));
    await expect(createdOption).toHaveAttribute("value", String(created?.id));
  });
  test(`Direct campaigns ${locale} retain exact advanced values and dirty drafts across explicit and in-flight reads`, async ({
    page,
  }, info) => {
    const data = await seed(page),
      copy = locale === "ar" ? adminDirectCampaignAr : adminDirectCampaignEn;
    const panel = await open(page, locale, "campaigns");
    await panel
      .getByLabel(
        locale === "ar" ? "البحث عن حملات أو معلنين" : "Search campaigns or advertisers",
        { exact: true },
      )
      .fill(data.campaigns[0]!.name);
    await panel
      .getByRole("button", {
        name: (locale === "ar" ? "تعديل " : "Edit ") + data.campaigns[0]!.name,
        exact: true,
      })
      .click();
    await panel.getByLabel(copy.campaignName, { exact: true }).fill(data.prefix + "unsaved");
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve)),
      seen = new Promise<void>((resolve) => (reached = resolve));
    await page.route(API + "/admin/advertising/workspace", async (route) => {
      const response = await route.fetch();
      reached();
      await held;
      await route.fulfill({ response });
    });
    await panel
      .getByRole("button", {
        name: locale === "ar" ? "قراءة السجلات الحالية" : "Read current records",
        exact: true,
      })
      .click();
    await seen;
    await panel
      .getByLabel(copy.campaignName, { exact: true })
      .fill(data.prefix + "edited-during-read");
    release();
    await expect(
      panel.getByRole("button", {
        name: locale === "ar" ? "قراءة السجلات الحالية" : "Read current records",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(panel.getByLabel(copy.campaignName, { exact: true })).toHaveValue(
      data.prefix + "edited-during-read",
    );
    await page.unroute(API + "/admin/advertising/workspace");
    for (const detail of await panel.locator("details").all())
      await detail.locator("summary").click();
    await expect(panel.getByLabel(copy.budget, { exact: true })).toHaveValue(
      "12345678901234.123456",
    );
    await expect(panel.getByLabel(copy.fixedRate, { exact: true })).toHaveValue(
      "98765432109876.123456",
    );
    await expect(panel.getByLabel(copy.currency, { exact: true })).toHaveValue("");
    await shots(page, info, locale, "advanced");
    const request = page.waitForRequest(
      (r) => r.url().endsWith("/campaigns/" + data.campaigns[0]!.id) && r.method() === "PATCH",
    );
    await panel
      .getByRole("button", {
        name: locale === "ar" ? "حفظ التغييرات" : "Save changes",
        exact: true,
      })
      .click();
    const payload = (await request).postDataJSON();
    expect(Object.keys(payload).sort()).toEqual(["expectedUpdatedAt", "mutationId", "name"]);
    await expect(
      panel.getByText(
        locale === "ar"
          ? "تم حفظ الإجراء وتسجيله للمراجعة. لم يُكرّر أي إجراء."
          : "The action was committed and recorded in the audit log. No action was repeated.",
        { exact: true },
      ),
    ).toBeVisible();
    const after = evidence(data).campaigns.find((r) => r.id === data.campaigns[0]!.id);
    expect(after).toMatchObject({
      budget: "12345678901234.123456",
      currency: null,
      startsAt: "2035-02-01T10:20:30.123Z",
      endsAt: "2035-03-01T10:20:30.789Z",
    });
  });
}
test("Direct campaigns recover an actual lost committed create without replay or duplicate", async ({
  page,
}) => {
  const data = await seed(page),
    copy = adminDirectCampaignEn,
    panel = await open(page, "en", "campaigns");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await panel.getByLabel(copy.campaignName, { exact: true }).fill(data.prefix + "lost-ack");
  await panel.getByLabel(copy.advertiser, { exact: true }).selectOption(data.advertisers[0]!.id);
  let writes = 0;
  await page.route(API + "/admin/advertising/campaigns", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await panel.getByRole("button", { name: "Create campaign draft", exact: true }).click();
  await expect(panel.getByText(/outcome is not confirmed/)).toBeVisible();
  expect(writes).toBe(1);
  await expect(
    panel.getByRole("button", { name: "Create campaign draft", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Review original action", exact: true }).click();
  await expect(panel.getByText(/action was committed and recorded/)).toBeVisible();
  expect(writes).toBe(1);
  const result = evidence(data);
  expect(result.campaigns.filter((r) => r.name === data.prefix + "lost-ack")).toHaveLength(1);
  expect(result.audits.filter((r) => r.action === "CAMPAIGN_CREATED")).toHaveLength(1);
});
test("Direct campaigns preserve conflicting original draft until explicit current-version review", async ({
  page,
}) => {
  const data = await seed(page),
    copy = adminDirectCampaignEn,
    panel = await open(page, "en", "campaigns");
  await panel
    .getByLabel("Search campaigns or advertisers", { exact: true })
    .fill(data.campaigns[0]!.name);
  await panel.getByRole("button", { name: "Edit " + data.campaigns[0]!.name, exact: true }).click();
  await panel.getByLabel(copy.campaignName, { exact: true }).fill(data.prefix + "reviewed-draft");
  db("change-campaign", { ...data, campaignId: data.campaigns[0]!.id });
  await panel.getByRole("button", { name: "Read current records", exact: true }).click();
  await expect(panel.getByText(/newer version is available/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await panel.locator("summary", { hasText: "Review current saved values" }).click();
  await panel.getByRole("button", { name: "Keep draft with current version", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(evidence(data).audits).toHaveLength(0);
  await panel.getByRole("button", { name: "Keep draft with current version", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep draft with current version", exact: true })
    .click();
  await panel.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(panel.getByText(/action was committed and recorded/)).toBeVisible();
  expect(evidence(data).campaigns.find((r) => r.id === data.campaigns[0]!.id)?.name).toBe(
    data.prefix + "reviewed-draft",
  );
});
test("Direct campaign close cancellation and ordinary link cancellation preserve draft and send no writes", async ({
  page,
}) => {
  const data = await seed(page),
    copy = adminDirectCampaignEn,
    panel = await open(page, "en", "campaigns");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await panel.getByLabel(copy.campaignName, { exact: true }).fill(data.prefix + "close-draft");
  await panel.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(panel.getByLabel(copy.campaignName, { exact: true })).toHaveValue(
    data.prefix + "close-draft",
  );
  await page.getByRole("link", { name: "Video ads", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/advertising/);
  expect(evidence(data).audits).toHaveLength(0);
});

async function leaveWithinAdmin(page: Page) {
  await page.getByRole("link", { name: "Video ads", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave page", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/video-ads/);
}
async function returnToCampaigns(page: Page) {
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/advertising/);
  await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
  return page.getByRole("tabpanel");
}
test("Direct campaign Back retains a verified-session draft but requires an explicit fresh read", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "campaigns");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await panel
    .getByLabel(adminDirectCampaignEn.campaignName, { exact: true })
    .fill(data.prefix + "back-draft");
  await leaveWithinAdmin(page);
  const returned = await returnToCampaigns(page);
  await expect(
    returned.getByLabel(adminDirectCampaignEn.campaignName, { exact: true }),
  ).not.toBeVisible();
  await returned.getByRole("button", { name: "Read current records", exact: true }).click();
  await expect(
    returned.getByLabel(adminDirectCampaignEn.campaignName, { exact: true }),
  ).toHaveValue(data.prefix + "back-draft");
  expect(evidence(data).audits).toHaveLength(0);
});
test("Direct campaign shelf is destroyed by same-account logout/relogin while editor is absent", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "campaigns");
  const originalScope = await (await page.request.get(API + "/admin/session")).json();
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await panel
    .getByLabel(adminDirectCampaignEn.campaignName, { exact: true })
    .fill(data.prefix + "previous-session-draft");
  await leaveWithinAdmin(page);
  expect(
    (await page.request.post(API + "/auth/logout", { headers: { origin: WEB } })).status(),
  ).toBe(204);
  const login = await page.request.post(API + "/auth/login", {
    headers: { origin: WEB },
    data: { email: data.email, password: "strong-pass-123" },
  });
  expect(login.ok()).toBe(true);
  const verified = await page.request.post(API + "/auth/mfa/challenge", {
    headers: { origin: WEB },
    data: { challengeToken: (await login.json()).challengeToken, recoveryCode: data.recoveryCode },
  });
  expect(verified.ok()).toBe(true);
  const nextScope = await (await page.request.get(API + "/admin/session")).json();
  expect(nextScope.accountId).toBe(originalScope.accountId);
  expect(nextScope.sessionId).not.toBe(originalScope.sessionId);
  const returned = await returnToCampaigns(page);
  await returned.getByRole("button", { name: "Read current records", exact: true }).click();
  await expect(returned.getByRole("button", { name: "New campaign", exact: true })).toBeEnabled();
  await returned.getByRole("button", { name: "New campaign", exact: true }).click();
  await expect(
    returned.getByLabel(adminDirectCampaignEn.campaignName, { exact: true }),
  ).toHaveValue("");
  expect(evidence(data).audits).toHaveLength(0);
});
test("Direct campaign role revocation off-route clears private drafts and denies re-entry", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "campaigns");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  const privateDraft = data.prefix + "revoked-draft";
  await panel.getByLabel(adminDirectCampaignEn.campaignName, { exact: true }).fill(privateDraft);
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.url().startsWith(API + "/admin/advertising/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
    )
      writes++;
  });
  await leaveWithinAdmin(page);
  db("revoke-role", data);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/advertising/);
  const checkAccess = page.getByRole("button", {
    name: advertisingEditorEn.refreshAccess,
    exact: true,
  });
  for (const recheck of [false, true]) {
    if (recheck) await checkAccess.click();
    await expect(checkAccess).toBeEnabled();
    await expect(page.getByText(advertisingEditorEn.access, { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Campaigns", exact: true })).toHaveCount(0);
    await expect(page.locator("[data-advertising-private]")).toHaveCount(0);
    await expect(page.getByLabel(adminDirectCampaignEn.campaignName, { exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.locator("input,textarea").evaluateAll(
        (nodes, value) =>
          nodes.some((node) => {
            const field = node as HTMLInputElement | HTMLTextAreaElement;
            return field.value === value || field.defaultValue === value;
          }),
        privateDraft,
      ),
    ).toBe(false);
  }
  expect((await page.request.get(API + "/admin/advertising/workspace")).status()).toBe(403);
  expect(writes).toBe(0);
  expect(evidence(data).audits).toHaveLength(0);
});
test("Direct campaign hidden/pagehide boundary scrubs captured controls before re-reading", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "campaigns");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  const name = panel.getByLabel(adminDirectCampaignEn.campaignName, { exact: true });
  await name.fill(data.prefix + "hidden-private-draft");
  await panel
    .getByLabel("Search campaigns or advertisers", { exact: true })
    .fill(data.prefix + "private-search");
  await name.evaluate((node) => {
    (window as unknown as { captured: HTMLInputElement }).captured = node as HTMLInputElement;
  });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  expect(
    await page.evaluate(() => {
      const n = (window as unknown as { captured: HTMLInputElement }).captured;
      return { value: n.value, defaultValue: n.defaultValue };
    }),
  ).toEqual({ value: "", defaultValue: "" });
  await expect(name).not.toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  // A full privacy invalidation also clears the retained section selection.
  await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
  await expect(name).not.toBeVisible();
  await panel.getByRole("button", { name: "Read current records", exact: true }).click();
  await expect(panel.getByRole("button", { name: "New campaign", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await expect(name).toHaveValue("");
  await expect(panel.getByLabel("Search campaigns or advertisers", { exact: true })).toHaveValue(
    "",
  );
  expect(evidence(data).audits).toHaveLength(0);
});
test("Direct campaign rejected step-up never resets the draft or automatically replays", async ({
  page,
}) => {
  const data = await seed(page),
    panel = await open(page, "en", "campaigns");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await panel
    .getByLabel(adminDirectCampaignEn.campaignName, { exact: true })
    .fill(data.prefix + "step-up-draft");
  await panel
    .getByLabel(adminDirectCampaignEn.advertiser, { exact: true })
    .selectOption(data.advertisers[0]!.id);
  let writes = 0;
  await page.route(API + "/admin/advertising/campaigns", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    writes++;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "STEP_UP_REQUIRED", message: "Verify session" } }),
    });
  });
  await panel.getByRole("button", { name: "Create campaign draft", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Confirm your identity" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(panel.getByLabel(adminDirectCampaignEn.campaignName, { exact: true })).toHaveValue(
    data.prefix + "step-up-draft",
  );
  expect(writes).toBe(1);
  expect(evidence(data).audits).toHaveLength(0);
});

for (const phase of ["read", "write"] as const) {
  test(`Direct campaign newer Back navigation fences an in-flight ${phase} without replay`, async ({
    page,
  }) => {
    const data = await seed(page);
    await page.goto("/admin/video-ads?lang=en");
    // Begin this direct-workspace race only after the preceding player read is
    // settled; its own pending-operation departure guard is intentionally kept.
    await expect(
      page.getByRole("group", { name: "Find stored overrides", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Read advertising records", exact: true }),
    ).toBeEnabled();
    await page.getByRole("link", { name: "Page ads & campaigns", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/advertising$/);
    await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
    const panel = page.getByRole("tabpanel");
    await panel.getByRole("button", { name: "New campaign", exact: true }).click();
    await panel
      .getByLabel(adminDirectCampaignEn.campaignName, { exact: true })
      .fill(data.prefix + "history-" + phase);
    await panel
      .getByLabel(adminDirectCampaignEn.advertiser, { exact: true })
      .selectOption(data.advertisers[0]!.id);
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const endpoint = API + "/admin/advertising/" + (phase === "read" ? "workspace" : "campaigns");
    let writes = 0;
    await page.route(endpoint, async (route) => {
      if (phase === "write" && route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      if (phase === "write") writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      reached();
      await held;
      await route.fulfill({ response }).catch(() => undefined); // The owner intentionally aborted this obsolete delivery.
    });
    await panel
      .getByRole("button", {
        name: phase === "read" ? "Read current records" : "Create campaign draft",
        exact: true,
      })
      .click();
    await seen;
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/video-ads/);
    release();
    await page.unroute(endpoint);
    await page.goForward();
    await expect(page).toHaveURL(/\/admin\/advertising/);
    await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
    await expect(
      panel.getByLabel(adminDirectCampaignEn.campaignName, { exact: true }),
    ).not.toBeVisible();
    await panel.getByRole("button", { name: "Read current records", exact: true }).click();
    await expect(panel.getByLabel(adminDirectCampaignEn.campaignName, { exact: true })).toHaveValue(
      data.prefix + "history-" + phase,
    );
    if (phase === "write") {
      await expect(
        panel.getByRole("button", { name: "Create campaign draft", exact: true }),
      ).toBeDisabled();
      await panel.getByRole("button", { name: "Review original action", exact: true }).click();
      await expect(panel.getByText(/action was committed and recorded/)).toBeVisible();
      expect(writes).toBe(1);
      expect(evidence(data).audits.filter((r) => r.action === "CAMPAIGN_CREATED")).toHaveLength(1);
    } else expect(evidence(data).audits).toHaveLength(0);
  });
}

for (const phase of ["write", "recovery"] as const) {
  test(`Direct campaign ${phase} preserves its actual committed acknowledgment when the later identity read fails`, async ({
    page,
  }) => {
    const data = await seed(page),
      panel = await open(page, "en", "campaigns");
    await panel.getByRole("button", { name: "New campaign", exact: true }).click();
    await panel
      .getByLabel(adminDirectCampaignEn.campaignName, { exact: true })
      .fill(data.prefix + "committed-read-failed-" + phase);
    await panel
      .getByLabel(adminDirectCampaignEn.advertiser, { exact: true })
      .selectOption(data.advertisers[0]!.id);
    let committed = false,
      recovered = false,
      afterAudit = 0,
      writes = 0;
    await page.route(API + "/admin/advertising/campaigns", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      if (phase === "recovery") await route.abort("failed");
      else await route.fulfill({ response });
    });
    await page.route(API + "/admin/advertising/mutations/*", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      recovered = true;
      await route.fulfill({ response });
    });
    await page.route(API + "/admin/session", async (route) => {
      const fail = phase === "write" ? committed : recovered && ++afterAudit === 2;
      if (fail)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "TEMPORARILY_UNAVAILABLE" } }),
        });
      else await route.continue();
    });
    await panel.getByRole("button", { name: "Create campaign draft", exact: true }).click();
    if (phase === "recovery") {
      await expect(panel.getByText(/outcome is not confirmed/)).toBeVisible();
      await panel.getByRole("button", { name: "Review original action", exact: true }).click();
    }
    // The known result must survive the outer private gate disappearing.
    await expect(page.getByText(/action was committed and recorded/)).toBeVisible();
    await expect(page.locator("[data-advertising-private]")).toHaveCount(0);
    await expect(page.getByLabel(adminDirectCampaignEn.campaignName, { exact: true })).toHaveCount(
      0,
    );
    expect(writes).toBe(1);
    expect(evidence(data).audits.filter((r) => r.action === "CAMPAIGN_CREATED")).toHaveLength(1);
    // Restoring identity access is an explicit read; it cannot replay the write
    // or resurrect its private draft. The committed record remains discoverable.
    await page.unroute(API + "/admin/session");
    await page
      .getByRole("button", { name: advertisingEditorEn.refreshAccess, exact: true })
      .click();
    await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
    await expect(panel.getByText(/action was committed and recorded/)).toBeVisible();
    await expect(
      panel.getByLabel(adminDirectCampaignEn.campaignName, { exact: true }),
    ).not.toBeVisible();
    await panel.getByRole("button", { name: "Read current records", exact: true }).click();
    await expect(panel.getByRole("button", { name: "New campaign", exact: true })).toBeEnabled();
    const savedName = data.prefix + "committed-read-failed-" + phase;
    await panel.getByLabel("Search campaigns or advertisers", { exact: true }).fill(savedName);
    await expect(
      panel.getByRole("button", { name: "Edit " + savedName, exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(evidence(data).audits.filter((r) => r.action === "CAMPAIGN_CREATED")).toHaveLength(1);
  });
}

test("Direct campaign deletion removes its cached child creative and cannot be reversed by an older global read", async ({
  page,
}) => {
  const data = await seed(page),
    creativeName = data.prefix + "deleted-child";
  const created = await page.request.post(API + "/admin/advertising/creatives", {
    headers: { origin: WEB },
    data: { campaignId: data.campaigns[0]!.id, name: creativeName, type: "DISPLAY", direct: {} },
  });
  expect(created.status()).toBe(201);
  const panel = await open(page, "en", "campaigns");
  await expect(
    page.getByRole("button", { name: "Read advertising records", exact: true }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Creatives", exact: true }).click();
  await expect(panel.getByText(creativeName, { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
  await panel
    .getByLabel("Search campaigns or advertisers", { exact: true })
    .fill(data.campaigns[0]!.name);
  await panel.getByRole("button", { name: "Edit " + data.campaigns[0]!.name, exact: true }).click();
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    seen = new Promise<void>((resolve) => {
      reached = resolve;
    });
  await page.route(API + "/admin/advertising/creatives", async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Read advertising records", exact: true }).click();
  await seen;
  try {
    await panel.getByRole("button", { name: "Delete draft", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Deleting a campaign also removes its creatives.",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(panel.getByText(/action was committed and recorded/)).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "Read advertising records", exact: true }),
  ).toBeEnabled();
  await page.unroute(API + "/admin/advertising/creatives");
  await page.getByRole("tab", { name: "Creatives", exact: true }).click();
  await expect(panel.getByText(creativeName, { exact: true })).toHaveCount(0);
  await expect(
    panel
      .getByLabel("Campaign", { exact: true })
      .locator('option[value="' + data.campaigns[0]!.id + '"]'),
  ).toHaveCount(0);
  const actual = await page.request.get(API + "/admin/advertising/creatives");
  expect(actual.ok()).toBe(true);
  expect((await actual.json()).some((r: { name: string }) => r.name === creativeName)).toBe(false);
  expect(evidence(data).audits.filter((r) => r.action === "CAMPAIGN_DELETED")).toHaveLength(1);
});
