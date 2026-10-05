import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type OwnedFixture = { channelId: string; query: string };
type Seed = OwnedFixture & {
  accountId: string;
  targetId: string;
  secondId: string;
  title: string;
};
const ownedFixtures: OwnedFixture[] = [];
type Evidence = {
  policy: {
    maturityLevel: string | null;
    ageRestriction: string;
    kidsEligible: boolean;
    allowedTerritories: string[];
    blockedTerritories: string[];
    rightsExpiresAt: string;
  };
  override: { disposition: string };
  audits: Array<{ entityId: string; reason: string }>;
};
function db<T = unknown>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-kids-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  ) as T;
}
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
test.afterEach(() => {
  const fixtures = ownedFixtures.splice(0);
  if (fixtures.length)
    expect(db("cleanup", { fixtures })).toEqual({ remainingChannels: 0, remainingVideos: 0 });
});
async function seed(page: Page, role = "CONTENT_MODERATOR", suffix = ""): Promise<Seed> {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual Kids moderator",
      email: "kids-review" + suffix + "@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const accountId = (await response.json()).user.account.id;
  await enrollMfa(page.request);
  const fixture = { channelId: randomUUID(), query: "kids-review-" + randomUUID().slice(0, 8) };
  ownedFixtures.push(fixture);
  return { accountId, ...db<Omit<Seed, "accountId">>("seed", { accountId, role, ...fixture }) };
}
const editor = (page: Page) => page.getByTestId("kids-classification-editor");
const item = (page: Page, id: string) => page.locator(`[data-kids-video="${id}"]`);
async function visit(page: Page, data: Seed, locale = "en") {
  await page.goto("/admin/kids?lang=" + locale);
  await expect(
    page.getByRole("region", {
      name: locale === "ar" ? "نتائج الفيديوهات" : "Video results",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("#kids-video-search")).toBeEnabled();
  await page.locator("#kids-video-search").fill(data.query);
  await page
    .getByRole("button", {
      name: locale === "ar" ? "البحث عن الفيديوهات" : "Search videos",
      exact: true,
    })
    .click();
  await expect(item(page, data.targetId)).toBeVisible();
}
async function choose(page: Page, id: string) {
  await item(page, id).getByRole("button").click();
  await expect(editor(page)).toContainText(id);
}
async function read(page: Page, ar = false) {
  await editor(page)
    .getByRole("button", {
      name: ar ? "قراءة التصنيف الحالي" : "Read current classification",
      exact: true,
    })
    .click();
  await expect(page.locator("#kids-reason")).toBeVisible();
}
for (const locale of ["en", "ar"])
  test(
    "Kids native classification uses real moderator search, pagination, audited policy and EN/AR layout " +
      locale,
    async ({ page }, info) => {
      test.setTimeout(120000);
      const data = await seed(page),
        ar = locale === "ar",
        copy = (en: string, arabic: string) => (ar ? arabic : en);
      await page.setViewportSize({ width: 390, height: 844 });
      await visit(page, data, locale);
      await expect(page.locator("[data-kids-video]")).toHaveCount(25);
      await expect(item(page, data.targetId)).toContainText(copy("Draft", "مسودة"));
      await expect(item(page, data.targetId)).toContainText(copy("Private", "خاص"));
      await page
        .getByRole("button", { name: copy("Next page", "الصفحة التالية"), exact: true })
        .click();
      await expect(page.locator("[data-kids-video]")).toHaveCount(2);
      await page
        .getByRole("button", { name: copy("Previous page", "الصفحة السابقة"), exact: true })
        .click();
      await expect(page.locator("[data-kids-video]")).toHaveCount(25);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page
          .getByRole("heading", { name: copy("Select a video", "اختيار فيديو"), exact: true })
          .evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
        const row = item(page, data.targetId),
          action = row.getByRole("button");
        expect(
          await action.evaluate((el) => el.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44);
        expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(
          width === 1440 ? 100 : 190,
        );
        if (width === 1440) {
          expect(await action.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(200);
          const visibleRows = await page.locator("[data-kids-video]").evaluateAll(
            (nodes) =>
              nodes.filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.top >= 0 && rect.bottom <= innerHeight;
              }).length,
          );
          expect(visibleRows).toBeGreaterThanOrEqual(8);
        }
        for (const identity of await row.locator('[dir="auto"]').all()) {
          expect(
            await identity.evaluate((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              return [...range.getClientRects()].every(
                (rect) => rect.left >= 0 && rect.right <= innerWidth + 1,
              );
            }),
          ).toBe(true);
        }
        await page.screenshot({ path: info.outputPath(`kids-${locale}-${width}-directory.png`) });
      }
      await choose(page, data.targetId);
      await expect(page.locator("#kids-reason")).toHaveCount(0);
      await expect(page.getByLabel("Video UUID", { exact: true })).toHaveCount(0);
      await read(page, ar);
      await expect(page.getByTestId("kids-current-policy")).toContainText(
        copy("Unclassified", "غير مصنّف"),
      );
      await page
        .locator("#kids-reason")
        .fill(
          copy(
            "Reviewed family story for general audiences",
            "تمت مراجعة حكاية العائلة لجميع الأعمار",
          ),
        );
      await editor(page).getByRole("checkbox").check();
      await page.locator("#kids-maturity").selectOption("TEEN");
      const save = editor(page).getByRole("button", {
        name: copy("Save reviewed classification", "حفظ التصنيف بعد المراجعة"),
        exact: true,
      });
      await expect(save).toBeDisabled();
      await page.locator("#kids-maturity").selectOption("GENERAL");
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveCount(1);
        for (const selector of ["#kids-maturity", "#kids-age", "#kids-reason"])
          expect(
            await page.locator(selector).evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1;
            }),
          ).toBe(true);
        expect(
          await editor(page)
            .getByRole("checkbox")
            .locator("..")
            .evaluate((el) => el.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44);
        for (const identity of await editor(page)
          .locator('strong[dir="auto"], span[dir="auto"]')
          .all()) {
          expect(
            await identity.evaluate((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              return [...range.getClientRects()].every(
                (r) => r.left >= 0 && r.right <= innerWidth + 1,
              );
            }),
          ).toBe(true);
        }
        await expect
          .poll(() =>
            page.evaluate(async () => {
              window.scrollTo({ top: 0, left: 0, behavior: "instant" });
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              return window.scrollY;
            }),
          )
          .toBe(0);
        expect(
          await page
            .getByRole("main")
            .getByRole("heading", { level: 1 })
            .evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return (
                rect.top >= 0 &&
                rect.bottom <= innerHeight &&
                rect.left >= 0 &&
                rect.right <= innerWidth
              );
            }),
        ).toBe(true);
        await page.screenshot({ path: info.outputPath(`kids-${locale}-${width}-heading.png`) });
        await editor(page).screenshot({
          path: info.outputPath(`kids-${locale}-${width}-editor.png`),
        });
      }
      let writes = 0;
      page.on("request", (r) => {
        if (r.method() === "PUT" && r.url().endsWith("/classification")) writes++;
      });
      await save.evaluate((node: HTMLButtonElement) => {
        node.click();
        node.click();
      });
      await expect(editor(page)).toContainText(
        copy("Classification saved and audited.", "تم حفظ التصنيف وتسجيله في سجل التدقيق."),
      );
      expect(writes).toBe(1);
      const actual = db<Evidence>("evidence", data);
      expect(actual.policy).toMatchObject({
        maturityLevel: "GENERAL",
        ageRestriction: "NONE",
        kidsEligible: true,
        allowedTerritories: ["CA"],
        blockedTerritories: ["US"],
        rightsExpiresAt: "2038-01-01T00:00:00.000Z",
      });
      expect(actual.override.disposition).toBe("FORCE_BLOCK");
      expect(actual.audits).toHaveLength(1);
      expect(actual.audits[0]!.entityId).toBe(data.targetId);
      await expect(page.locator("#kids-reason")).toHaveValue("");
      await page.locator("#kids-video-search").fill("no-kids-results-unique");
      await page
        .getByRole("button", { name: copy("Search videos", "البحث عن الفيديوهات"), exact: true })
        .click();
      await expect(page.locator("[data-kids-video]")).toHaveCount(0);
      await expect(page.getByRole("main")).toContainText(
        copy("No videos match this search.", "لا توجد فيديوهات مطابقة لهذا البحث."),
      );
    },
  );
test("Kids directory and policy retries never show failed results or save before a verified read", async ({
  page,
}) => {
  const data = await seed(page, "OPERATIONS");
  await page.route(API + "/admin/control/videos?**", (route) =>
    route.fulfill({ status: 503, json: { message: "Controlled read failure" } }),
  );
  await page.goto("/admin/kids?lang=en");
  await expect(page.getByRole("main")).toContainText("The video directory could not be verified");
  await expect(page.locator("[data-kids-video]")).toHaveCount(0);
  await page.unroute(API + "/admin/control/videos?**");
  await page.getByRole("button", { name: "Retry directory", exact: true }).click();
  await expect(item(page, data.targetId)).toBeVisible();
  await choose(page, data.targetId);
  await page.route(API + "/admin/video-policies/" + data.targetId, (route) =>
    route.fulfill({ status: 503, json: { message: "Controlled policy failure" } }),
  );
  await editor(page)
    .getByRole("button", { name: "Read current classification", exact: true })
    .click();
  await expect(editor(page)).toContainText("The current policy could not be verified");
  await expect(page.locator("#kids-reason")).toHaveCount(0);
  await page.unroute(API + "/admin/video-policies/" + data.targetId);
  await read(page);
  expect(db<Evidence>("evidence", data).audits).toHaveLength(0);
});
test("Kids discards a late policy after selecting another target and hides facts on changed role", async ({
  page,
}) => {
  const data = await seed(page);
  await visit(page, data);
  await choose(page, data.targetId);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let arrived!: () => void;
  const sent = new Promise<void>((resolve) => (arrived = resolve));
  await page.route(API + "/admin/video-policies/" + data.targetId, async (route) => {
    const response = await route.fetch();
    arrived();
    await hold;
    await route.fulfill({ response }).catch(() => {});
  });
  await editor(page)
    .getByRole("button", { name: "Read current classification", exact: true })
    .click();
  await sent;
  await choose(page, data.secondId);
  await read(page);
  release();
  await expect(page.getByTestId("kids-current-policy")).toContainText("Teen");
  await expect(editor(page)).not.toContainText(data.targetId);
  await expect(page.locator("#kids-maturity")).toHaveValue("TEEN");
  let releaseRole!: () => void, arrivedRole!: () => void;
  const roleHold = new Promise<void>((resolve) => (releaseRole = resolve));
  const roleSent = new Promise<void>((resolve) => (arrivedRole = resolve));
  await page.route(API + "/admin/video-policies/" + data.secondId, async (route) => {
    const response = await route.fetch();
    arrivedRole();
    await roleHold;
    await route.fulfill({ response });
  });
  await editor(page)
    .getByRole("button", { name: "Read current classification", exact: true })
    .click();
  await roleSent;
  db("role", { ...data, role: "FINANCE_MANAGER" });
  releaseRole();
  await expect(page.getByRole("main")).toContainText(
    "Your account, permissions or selected video changed or became unavailable",
  );
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("[data-kids-video]")).toHaveCount(0);
  expect(db<Evidence>("evidence", data).audits).toHaveLength(0);
});
test("Kids retains a lost-acknowledgment draft and requires policy review before another attempt", async ({
  page,
}) => {
  const data = await seed(page);
  await visit(page, data);
  await choose(page, data.targetId);
  await read(page);
  await editor(page).getByRole("checkbox").check();
  await page.locator("#kids-reason").fill("Actual lost-acknowledgment decision");
  let writes = 0;
  await page.route(
    API + "/admin/video-policies/" + data.targetId + "/classification",
    async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    },
  );
  await editor(page)
    .getByRole("button", { name: "Save reviewed classification", exact: true })
    .click();
  await expect(editor(page)).toContainText("The save was not confirmed");
  await expect(page.locator("#kids-reason")).toHaveValue("Actual lost-acknowledgment decision");
  await expect(page.locator("#kids-reason")).toBeDisabled();
  expect(writes).toBe(1);
  expect(db<Evidence>("evidence", data).audits).toHaveLength(1);
  await page.unroute(API + "/admin/video-policies/" + data.targetId + "/classification");
  await read(page);
  await expect(page.getByTestId("kids-current-policy")).toContainText("Eligible for Kids");
  await expect(page.locator("#kids-reason")).toBeDisabled();
  await editor(page)
    .getByRole("button", { name: "I reviewed the current policy; enable my draft", exact: true })
    .click();
  await expect(page.locator("#kids-reason")).toBeEnabled();
  expect(db<Evidence>("evidence", data).audits).toHaveLength(1);
});
test("Kids actual step-up rejection never replays the classification and keeps the draft", async ({
  page,
}) => {
  const data = await seed(page);
  const cookies = await page.context().cookies(API),
    cookie = cookies.find((c) => c.name === "ayin_session")!;
  expect(cookie).toBeTruthy();
  const parts = cookie.value.split("."),
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  payload.reauthAt = Math.floor(Date.now() / 1000) - 600;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_TOKEN_SECRET!)
    .update(encoded)
    .digest("base64url");
  await page.context().addCookies([{ ...cookie, value: `v1.${encoded}.${signature}` }]);
  await visit(page, data);
  await choose(page, data.targetId);
  await read(page);
  await page.locator("#kids-reason").fill("Retained actual step-up decision");
  await editor(page)
    .getByRole("button", { name: "Save reviewed classification", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor(page)).toContainText("Verify your session");
  await expect(page.locator("#kids-reason")).toHaveValue("Retained actual step-up decision");
  await expect(page.locator("#kids-reason")).toBeDisabled();
  expect(db<Evidence>("evidence", data).audits).toHaveLength(0);
});

test("Kids retains a cancelled target change and conceals private facts on pagehide until a fresh read", async ({
  page,
}) => {
  const data = await seed(page);
  await visit(page, data);
  await choose(page, data.targetId);
  await read(page);
  await page.locator("#kids-reason").fill("Retain this reviewed draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await item(page, data.secondId).getByRole("button").click();
  await expect(editor(page)).toContainText(data.targetId);
  await expect(page.locator("#kids-reason")).toHaveValue("Retain this reviewed draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Back to AYIN", exact: false }).click();
  await expect(page).toHaveURL(/\/admin\/kids/);
  await expect(page.locator("#kids-reason")).toHaveValue("Retain this reviewed draft");
  const firstHide = await page.evaluate(() => {
    const query = document.querySelector<HTMLInputElement>("#kids-video-search")!;
    const reason = document.querySelector<HTMLTextAreaElement>("#kids-reason")!;
    const body = reason.closest("section")!.parentElement!;
    (
      window as unknown as {
        kidsCaptured: { query: HTMLInputElement; reason: HTMLTextAreaElement };
      }
    ).kidsCaptured = { query, reason };
    window.dispatchEvent(new Event("pagehide"));
    return {
      hidden: body.hidden,
      query: query.value,
      queryDefault: query.defaultValue,
      reason: reason.value,
      reasonDefault: reason.defaultValue,
    };
  });
  expect(firstHide).toEqual({
    hidden: true,
    query: "",
    queryDefault: "",
    reason: "",
    reasonDefault: "",
  });
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator("[data-kids-video]")).toHaveCount(0);
  const detached = await page.evaluate(() => {
    const { query, reason } = (
      window as unknown as {
        kidsCaptured: { query: HTMLInputElement; reason: HTMLTextAreaElement };
      }
    ).kidsCaptured;
    return {
      query: query.value,
      queryDefault: query.defaultValue,
      reason: reason.value,
      reasonDefault: reason.defaultValue,
      connected: reason.isConnected,
    };
  });
  expect(detached).toEqual({
    query: "",
    queryDefault: "",
    reason: "",
    reasonDefault: "",
    connected: false,
  });
  await page.getByRole("button", { name: "Retry directory", exact: true }).click();
  await expect(item(page, data.targetId)).toBeVisible();
  await expect(page.locator("#kids-video-search")).toHaveValue("");
  await choose(page, data.targetId);
  await expect(page.locator("#kids-reason")).toHaveCount(0);
  await read(page);
  await expect(page.locator("#kids-reason")).toHaveValue("");
  expect(db<Evidence>("evidence", data).audits).toHaveLength(0);
});

test("Kids binds a protected write to the intended actor after the preflight cookie changes", async ({
  page,
}) => {
  const data = await seed(page);
  await visit(page, data);
  await choose(page, data.targetId);
  await read(page);
  await editor(page).getByRole("checkbox").check();
  await page.locator("#kids-reason").fill("Must remain bound to the original moderator");
  const other = await page.context().browser()!.newContext();
  try {
    const secondPage = await other.newPage(),
      second = await seed(secondPage, "CONTENT_MODERATOR", "-other");
    const cookies = await other.cookies(API);
    let switched = false,
      writes = 0,
      status = 0;
    await page.route(API + "/admin/session", async (route) => {
      const response = await route.fetch();
      if (!switched) {
        switched = true;
        await page.context().addCookies(cookies);
      }
      await route.fulfill({ response });
    });
    page.on("response", (response) => {
      if (response.url().endsWith("/classification") && response.request().method() === "PUT") {
        writes++;
        status = response.status();
        expect(response.request().headers()["x-ayin-expected-account"]).toBe(data.accountId);
      }
    });
    await editor(page)
      .getByRole("button", { name: "Save reviewed classification", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(
      "Your account, permissions or selected video changed or became unavailable",
    );
    expect(status).toBe(409);
    expect(writes).toBe(1);
    await expect(page.locator("#kids-video-search")).toHaveValue("");
    await expect(editor(page)).toHaveCount(0);
    await expect(page.locator("[data-kids-video]")).toHaveCount(0);
    const actual = db<Evidence>("evidence", data);
    expect(actual.policy.kidsEligible).toBe(false);
    expect(actual.policy.maturityLevel).toBeNull();
    expect(actual.audits).toHaveLength(0);
    expect(db<Evidence>("evidence", second).audits).toHaveLength(0);
  } finally {
    await other.close();
  }
});
for (const mode of ["unavailable", "account-change"] as const)
  test(
    "Kids preserves an acknowledged save but conceals private facts after post-write " + mode,
    async ({ page }) => {
      const data = await seed(page);
      await visit(page, data);
      await choose(page, data.targetId);
      await read(page);
      await editor(page).getByRole("checkbox").check();
      await page.locator("#kids-reason").fill("Acknowledged decision before identity reread");
      const other = mode === "account-change" ? await page.context().browser()!.newContext() : null;
      try {
        const cookies = other
          ? (await seed(await other.newPage(), "CONTENT_MODERATOR", "-other"),
            await other.cookies(API))
          : null;
        let reads = 0,
          writes = 0;
        page.on("request", (request) => {
          if (request.method() === "PUT" && request.url().endsWith("/classification")) writes++;
        });
        await page.route(API + "/admin/session", async (route) => {
          reads++;
          if (reads === 1) return route.continue();
          if (!cookies)
            return route.fulfill({
              status: 503,
              json: { message: "Controlled post-ack identity outage" },
            });
          await page.context().addCookies(cookies);
          // Use the newly selected browser cookie for the actual AuthGuard read.
          const response = await route.fetch({
            headers: {
              ...route.request().headers(),
              cookie: cookies.map((c) => c.name + "=" + c.value).join("; "),
            },
          });
          expect(response.status()).toBe(409);
          await route.fulfill({ response });
        });
        await editor(page)
          .getByRole("button", { name: "Save reviewed classification", exact: true })
          .click();
        await expect(page.getByRole("main")).toContainText(
          "Classification saved and audited. Private details are hidden until access is verified again.",
        );
        await expect(editor(page)).toHaveCount(0);
        await expect(page.locator("[data-kids-video]")).toHaveCount(0);
        await expect(page.getByRole("main")).not.toContainText(data.title);
        expect(writes).toBe(1);
        const actual = db<Evidence>("evidence", data);
        expect(actual.policy.kidsEligible).toBe(true);
        expect(actual.audits).toHaveLength(1);
        expect(actual.audits[0]!.entityId).toBe(data.targetId);
      } finally {
        await other?.close();
      }
    },
  );

test("Kids excludes removed videos by default and treats an explicit removed directory record as read-only", async ({
  page,
}) => {
  const data = await seed(page);
  db("remove-target", data);
  const response = await page.request.get(
    API + "/admin/control/videos?take=25&query=" + data.query,
  );
  expect(response.ok()).toBe(true);
  const directory = await response.json();
  expect(directory.pagination.total).toBe(26);
  expect(directory.items.some((record: { id: string }) => record.id === data.targetId)).toBe(false);
  // Exercise the existing endpoint's explicit REMOVED response, which the normal Kids query does not request.
  await page.route(API + "/admin/control/videos?**", async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set("status", "REMOVED");
    url.searchParams.set("query", data.query);
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.goto("/admin/kids?lang=en");
  await expect(item(page, data.targetId)).toContainText("Removed");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/classification")) writes++;
  });
  await choose(page, data.targetId);
  await expect(editor(page)).toContainText("Its policy is read-only");
  await editor(page)
    .getByRole("button", { name: "Read current classification", exact: true })
    .click();
  await expect(page.getByTestId("kids-current-policy")).toContainText("Unclassified");
  await expect(page.locator("#kids-reason")).toHaveCount(0);
  await expect(
    editor(page).getByRole("button", { name: "Save reviewed classification", exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
  expect(db<Evidence>("evidence", data).audits).toHaveLength(0);
});
