import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type RecordRow = {
  id: string;
  title: string;
  seasons: Array<{ id: string; episodes: Array<{ id: string }> }>;
};
type Fixture = {
  accountId: string;
  email: string;
  recoveryCode: string;
  prefix: string;
  movies: RecordRow[];
  series: RecordRow[];
};
function db<T>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/admin-catalog-editor-fixture.mjs"),
        command,
        JSON.stringify(payload),
      ],
      { env: process.env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  ) as T;
}
let data: Fixture | undefined;
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  data = undefined;
});
test.afterEach(() => {
  if (data) db("cleanup", data);
});
async function seed(page: Page) {
  const email = `catalog-navigation-${randomUUID()}@e2e.ayin.test`;
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: "Catalog navigation operator", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  const accountId = (await response.json()).user.account.id,
    mfa = await enrollMfa(page.request);
  data = {
    accountId,
    email,
    recoveryCode: mfa.recoveryCodes[0]!,
    ...db<Omit<Fixture, "accountId" | "email" | "recoveryCode">>("seed", { accountId }),
  };
  return data;
}
async function edit(
  page: Page,
  kind: "movies" | "series",
  fixture: Fixture,
  locale: "en" | "ar" = "en",
) {
  await page.goto(`/admin/${kind}?lang=${locale}`);
  await page
    .getByRole("textbox", {
      name:
        locale === "ar"
          ? kind === "movies"
            ? "البحث عن أفلام"
            : "البحث عن مسلسلات"
          : kind === "movies"
            ? "Search movies"
            : "Search series",
      exact: true,
    })
    .fill(fixture.prefix);
  const record = (kind === "movies" ? fixture.movies : fixture.series)[0]!;
  const row =
    kind === "movies"
      ? page.locator("article").filter({ has: page.getByText(record.title, { exact: true }) })
      : page.getByRole("row").filter({ has: page.getByText(record.title, { exact: true }) });
  await row
    .getByRole("button", {
      name:
        locale === "ar"
          ? kind === "movies"
            ? "تعديل"
            : "إدارة"
          : kind === "movies"
            ? "Edit"
            : "Manage",
      exact: true,
    })
    .click();
  const form = page.getByRole("form", {
    name:
      locale === "ar"
        ? kind === "movies"
          ? "بيانات الفيلم"
          : "بيانات المسلسل"
        : kind === "movies"
          ? "Movie details"
          : "Series details",
    exact: true,
  });
  await expect(
    form.getByRole("textbox", { name: locale === "ar" ? "العنوان" : "Title", exact: true }),
  ).toHaveValue(record.title);
  return form;
}
async function sidebar(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: /AYIN administration|إدارة AYIN/ })
    .getByRole("link", { name, exact: true })
    .click();
}
async function leave(page: Page, destination: "Movies" | "Series" = "Series") {
  await sidebar(page, destination);
  await page.getByRole("dialog").getByRole("button", { name: "Leave page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${destination.toLowerCase()}`));
}
async function review(page: Page) {
  const panel = page.getByRole("region", { name: "Catalog draft recovery" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Review record and restore draft", exact: true }).click();
}
async function originals(page: Page, name: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const dialog = page.getByRole("dialog");
    const hasDialog = await dialog.count();
    if (hasDialog) {
      await expect(dialog).toBeInViewport();
      for (const button of await dialog.getByRole("button").all()) {
        await expect(button).toBeInViewport();
        const bounds = await button.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
      }
    }
    await page.screenshot({
      path: test.info().outputPath(`${name}-${width}.png`),
      fullPage: !hasDialog,
    });
  }
}
const audits = (fixture: Fixture) =>
  db<{ audits: Array<{ action: string; entityId: string }> }>("evidence", fixture).audits.filter(
    (row) => row.action.startsWith("catalog."),
  );

for (const locale of ["en", "ar"] as const)
  test(`Catalog ${locale} ordinary sidebar Leave/Cancel preserves the original target until explicit restoration`, async ({
    page,
  }) => {
    const fixture = await seed(page),
      form = await edit(page, "movies", fixture, locale);
    await form
      .getByRole("textbox", { name: locale === "ar" ? "العنوان" : "Title", exact: true })
      .fill(fixture.prefix + "private-movie-draft");
    const destination = locale === "ar" ? "المسلسلات" : "Series";
    await sidebar(page, destination);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await originals(page, `catalog-leave-${locale}`);
    await dialog
      .getByRole("button", {
        name: locale === "ar" ? "متابعة التحرير" : "Keep editing",
        exact: true,
      })
      .click();
    await expect(
      form.getByRole("textbox", { name: locale === "ar" ? "العنوان" : "Title", exact: true }),
    ).toHaveValue(fixture.prefix + "private-movie-draft");
    await sidebar(page, destination);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: locale === "ar" ? "مغادرة الصفحة" : "Leave page", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: destination, exact: true }),
    ).toBeVisible();
    await page.goBack();
    const recovery = page.getByRole("region", {
      name: locale === "ar" ? "استعادة مسودة المكتبة" : "Catalog draft recovery",
    });
    await expect(recovery).toBeVisible();
    await originals(page, `catalog-recovery-${locale}`);
    await expect(
      page.getByRole("form", { name: locale === "ar" ? "بيانات الفيلم" : "Movie details" }),
    ).toHaveCount(0);
    expect(audits(fixture)).toHaveLength(0);
    const detail = page.waitForRequest(
      (request) =>
        request.url() === API + `/admin/catalog/movies/${fixture.movies[0]!.id}` &&
        request.method() === "GET",
    );
    await recovery
      .getByRole("button", {
        name: locale === "ar" ? "مراجعة السجل واستعادة المسودة" : "Review record and restore draft",
        exact: true,
      })
      .click();
    await detail;
    await expect(
      form.getByRole("textbox", { name: locale === "ar" ? "العنوان" : "Title", exact: true }),
    ).toHaveValue(fixture.prefix + "private-movie-draft");
    await form
      .getByRole("button", { name: locale === "ar" ? "حفظ الفيلم" : "Save movie", exact: true })
      .click();
    await expect(
      page.getByText(locale === "ar" ? "حُفظت تعديلات الفيلم." : "Movie changes saved.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      audits(fixture)
        .filter((row) => row.action === "catalog.movie.update")
        .map((row) => row.entityId),
    ).toEqual([fixture.movies[0]!.id]);
  });

test("Native Back/Forward retains drafts only behind a new exact-target read", async ({ page }) => {
  const fixture = await seed(page);
  await page.goto("/admin/series?lang=en");
  await sidebar(page, "Movies");
  await page.getByRole("textbox", { name: "Search movies", exact: true }).fill(fixture.prefix);
  await page
    .locator("article")
    .filter({ has: page.getByText(fixture.movies[0]!.title, { exact: true }) })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Movie details" });
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    fixture.movies[0]!.title,
  );
  await form.getByRole("textbox", { name: "Title", exact: true }).fill("Back-only private draft");
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/series/);
  await page.goForward();
  await review(page);
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Back-only private draft",
  );
  expect(audits(fixture)).toHaveLength(0);
});

test("Series parent and two child drafts survive same-session return without sibling overwrite", async ({
  page,
}) => {
  const fixture = await seed(page),
    form = await edit(page, "series", fixture);
  const seasons = page.getByRole("form", { name: "Season details", exact: true }),
    episodes = page.getByRole("form", { name: "Episode details", exact: true });
  await form.getByRole("textbox", { name: "Synopsis", exact: true }).fill("Parent private draft");
  await seasons
    .first()
    .getByRole("textbox", { name: "Season title", exact: true })
    .fill("Season private draft");
  await episodes
    .first()
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Episode private draft");
  await leave(page, "Movies");
  await page.goBack();
  await review(page);
  await expect(form.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue(
    "Parent private draft",
  );
  await expect(
    seasons.first().getByRole("textbox", { name: "Season title", exact: true }),
  ).toHaveValue("Season private draft");
  await expect(episodes.first().getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Episode private draft",
  );
  expect(audits(fixture)).toHaveLength(0);
});

test("Changed episode baseline blocks Series restoration while parent updatedAt is unchanged", async ({
  page,
}) => {
  const fixture = await seed(page),
    form = await edit(page, "series", fixture);
  await form
    .getByRole("textbox", { name: "Synopsis", exact: true })
    .fill("Parent pending original");
  await leave(page, "Movies");
  const changed = db<{ parentBefore: string; parentAfter: string }>("change-episode", {
    ...fixture,
    episodeId: fixture.series[0]!.seasons[0]!.episodes[0]!.id,
  });
  expect(changed.parentAfter).toBe(changed.parentBefore);
  await page.goBack();
  await review(page);
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toContainText(
    "Episode records or their order changed",
  );
  await expect(form).toHaveCount(0);
  expect(audits(fixture)).toHaveLength(0);
});

for (const change of ["change-movie", "archive-movie", "delete-movie"] as const)
  test(`Catalog return rejects ${change} of the original stable target`, async ({ page }) => {
    const fixture = await seed(page),
      form = await edit(page, "movies", fixture);
    await form.getByRole("textbox", { name: "Title", exact: true }).fill("Original private title");
    await leave(page);
    db(change, { ...fixture, movieId: fixture.movies[0]!.id });
    await page.goBack();
    await review(page);
    await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toContainText(
      change === "delete-movie"
        ? "no longer available"
        : change === "archive-movie"
          ? "original record is archived"
          : "metadata or status changed",
    );
    await expect(form).toHaveCount(0);
    expect(audits(fixture)).toHaveLength(0);
  });

test("Same-account new login destroys the absent Catalog shelf", async ({ page }) => {
  const fixture = await seed(page),
    form = await edit(page, "movies", fixture);
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Earlier session private title");
  await leave(page);
  expect(
    (await page.request.post(API + "/auth/logout", { headers: { origin: WEB } })).status(),
  ).toBe(204);
  const login = await page.request.post(API + "/auth/login", {
    headers: { origin: WEB },
    data: { email: fixture.email, password: "strong-pass-123" },
  });
  expect(login.ok()).toBe(true);
  expect(
    (
      await page.request.post(API + "/auth/mfa/challenge", {
        headers: { origin: WEB },
        data: {
          challengeToken: (await login.json()).challengeToken,
          recoveryCode: fixture.recoveryCode,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goBack();
  await expect(page.getByRole("form", { name: "Movie details" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toHaveCount(0);
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
});

test("Hidden-page invalidation clears the absent Catalog shelf", async ({ page }) => {
  const fixture = await seed(page),
    form = await edit(page, "movies", fixture);
  await form.getByRole("textbox", { name: "Title", exact: true }).fill("Hidden-page private title");
  await leave(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
  });
  await expect(page.getByRole("textbox", { name: "Search series", exact: true })).toBeVisible();
  await page.goBack();
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toHaveCount(0);
});

test("In-flight Catalog write is never replayed or restored as a clean baseline after Back", async ({
  page,
}) => {
  const fixture = await seed(page);
  await page.goto("/admin/series?lang=en");
  await sidebar(page, "Movies");
  await page.getByRole("textbox", { name: "Search movies", exact: true }).fill(fixture.prefix);
  await page
    .locator("article")
    .filter({ has: page.getByText(fixture.movies[0]!.title, { exact: true }) })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Movie details" });
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    fixture.movies[0]!.title,
  );
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(fixture.prefix + "pending-commit");
  let started!: () => void, release!: () => void, delivered!: () => void;
  const start = new Promise<void>((resolve) => {
      started = resolve;
    }),
    held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    delivery = new Promise<void>((resolve) => {
      delivered = resolve;
    });
  await page.route(API + `/admin/catalog/movies/${fixture.movies[0]!.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    started();
    await held;
    await route.fulfill({ response }).catch(() => {});
    delivered();
  });
  await form.getByRole("button", { name: "Save movie", exact: true }).click();
  await start;
  await page.goBack();
  release();
  await delivery;
  await page.goForward();
  await review(page);
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toContainText(
    "earlier request may have committed",
  );
  await expect(form).toHaveCount(0);
  expect(audits(fixture).filter((row) => row.action === "catalog.movie.update")).toHaveLength(1);
});

test("Oversized catalog baseline warns before an explicit discard leave and retains no partial draft", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seed(page);
  db("large-series", { ...fixture, seriesId: fixture.series[0]!.id });
  const form = await edit(page, "series", fixture);
  await form.getByRole("textbox", { name: "Title", exact: true }).fill("Oversized private draft");
  await expect(
    page.getByText(
      "These drafts exceed the retention limit. Save or discard before leaving; they cannot be partially restored on return.",
      { exact: true },
    ),
  ).toBeVisible();
  await sidebar(page, "Movies");
  await expect(page.getByRole("dialog")).toContainText("Leaving discards these unsaved changes");
  await page.getByRole("dialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Oversized private draft",
  );
  await leave(page, "Movies");
  await page.goBack();
  const recovery = page.getByRole("region", { name: "Catalog draft recovery" });
  await expect(recovery).toContainText("no partial draft was restored");
  await expect(form).toHaveCount(0);
  await expect(
    recovery.getByRole("button", { name: "Review record and restore draft", exact: true }),
  ).toBeDisabled();
  await recovery.getByRole("button", { name: "Discard retained draft", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  expect(audits(fixture)).toHaveLength(0);
});

test("Catalog recovery retains drafts after a failed target read and retries only the read", async ({
  page,
}) => {
  const fixture = await seed(page),
    form = await edit(page, "movies", fixture);
  await form.getByRole("textbox", { name: "Title", exact: true }).fill("Read-retry private draft");
  await leave(page);
  await page.goBack();
  const url = API + `/admin/catalog/movies/${fixture.movies[0]!.id}`;
  await page.route(url, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Temporary read failure" } }),
    }),
  );
  await review(page);
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toContainText(
    "draft is kept; retry the read",
  );
  await expect(form).toHaveCount(0);
  expect(audits(fixture)).toHaveLength(0);
  await page.unroute(url);
  await review(page);
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Read-retry private draft",
  );
  expect(audits(fixture)).toHaveLength(0);
});

test("Leaving Admin deliberately destroys the Catalog candidate even on Back", async ({ page }) => {
  const fixture = await seed(page),
    form = await edit(page, "movies", fixture);
  await form.getByRole("textbox", { name: "Title", exact: true }).fill("Off-Admin private draft");
  await page.getByRole("link", { name: "Back to AYIN", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave page", exact: true }).click();
  await expect(page).toHaveURL(WEB + "/");
  await page.goBack();
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toHaveCount(0);
});

test("An absent Catalog candidate is destroyed by an actual role change", async ({ page }) => {
  const fixture = await seed(page),
    form = await edit(page, "movies", fixture);
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Revoked-role private draft");
  await leave(page);
  db("revoke-role", fixture);
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Search movies", exact: true })).not.toBeVisible();
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toHaveCount(0);
  expect((await page.request.get(API + "/admin/catalog/movies")).status()).toBe(403);
  expect(audits(fixture)).toHaveLength(0);
});

test("A new unsaved draft returns as a new draft without guessing a title-matched record", async ({
  page,
}) => {
  const fixture = await seed(page);
  await page.goto("/admin/movies?lang=en");
  const form = page.getByRole("form", { name: "Movie details" });
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(fixture.movies[0]!.title);
  await leave(page);
  await page.goBack();
  await review(page);
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    fixture.movies[0]!.title,
  );
  await expect(form.getByRole("button", { name: "Create draft", exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: "Save movie", exact: true })).toHaveCount(0);
  expect(audits(fixture)).toHaveLength(0);
});

test("Restored child and new-child seeds cannot survive explicit refresh discard or acknowledged save", async ({
  page,
}) => {
  const fixture = await seed(page),
    form = await edit(page, "series", fixture);
  const season = page.getByRole("form", { name: "Season details", exact: true }).first();
  const episode = page.getByRole("form", { name: "Episode details", exact: true }).first();
  const newSeason = page.getByRole("form", { name: "New season", exact: true });
  const newEpisode = page.getByRole("form", { name: "New episode", exact: true }).first();
  await form.getByRole("textbox", { name: "Title", exact: true }).fill("Retained parent");
  await season.getByRole("textbox", { name: "Season title", exact: true }).fill("Retained season");
  await episode.getByRole("textbox", { name: "Title", exact: true }).fill("Retained episode");
  await newSeason.getByRole("textbox", { name: "Title", exact: true }).fill("Retained new season");
  await newEpisode
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Retained new episode");
  await leave(page, "Movies");
  await page.goBack();
  await review(page);
  await expect(season.getByRole("textbox", { name: "Season title", exact: true })).toHaveValue(
    "Retained season",
  );
  await season
    .getByRole("textbox", { name: "Season title", exact: true })
    .fill("Edited after restoration");
  await page.getByRole("button", { name: "Refresh record", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    fixture.series[0]!.title,
  );
  await expect(season.getByRole("textbox", { name: "Season title", exact: true })).toHaveValue(
    "First season",
  );
  await expect(episode.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "First episode",
  );
  await expect(newSeason.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(newEpisode.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  expect(audits(fixture)).toHaveLength(0);
  await season
    .getByRole("textbox", { name: "Season title", exact: true })
    .fill("Second retained seed");
  await leave(page, "Movies");
  await page.goBack();
  await review(page);
  await season
    .getByRole("textbox", { name: "Season title", exact: true })
    .fill("Acknowledged final season");
  await season.getByRole("button", { name: "Save season metadata", exact: true }).click();
  await expect(page.getByText("Season saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh record", exact: true }).click();
  await expect(season.getByRole("textbox", { name: "Season title", exact: true })).toHaveValue(
    "Acknowledged final season",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(audits(fixture).filter((item) => item.action === "catalog.season.update")).toHaveLength(1);
});

test("Campaign overflow cannot restore an older draft or evict independent Movie and Series candidates", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await seed(page);
  db("advertising-seed", fixture);
  const movie = await edit(page, "movies", fixture);
  await movie
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Independent movie candidate");
  await leave(page);
  await page.getByRole("textbox", { name: "Search series", exact: true }).fill(fixture.prefix);
  await page
    .getByRole("row")
    .filter({ has: page.getByText(fixture.series[0]!.title, { exact: true }) })
    .getByRole("button", { name: "Manage", exact: true })
    .click();
  const series = page.getByRole("form", { name: "Series details" });
  await expect(series.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    fixture.series[0]!.title,
  );
  await series
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Independent series candidate");
  await page.getByRole("link", { name: "Advertising", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave page", exact: true }).click();
  await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", { name: "New campaign", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Campaign name", exact: true })
    .fill("Earlier small campaign candidate");
  await panel.locator("summary").filter({ hasText: "Targeting (optional)" }).click();
  const regions = panel.getByRole("textbox", { name: "Regions", exact: true });
  const size = 4 * 1024 * 1024 + 64;
  await regions.fill("r".repeat(size));
  await expect(
    panel.getByText(
      "This draft cannot be kept across navigation. Keep this page open and shorten or save the edits before leaving.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Video ads", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Leaving discards its unsaved edits");
  await page.getByRole("dialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  expect(await regions.evaluate((element) => (element as HTMLInputElement).value.length)).toBe(
    size,
  );
  await page.getByRole("link", { name: "Video ads", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave page", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/video-ads/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/advertising/);
  await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
  await panel.getByRole("button", { name: "Read current records", exact: true }).click();
  await expect(
    panel.getByText(
      "The earlier draft could not be retained. No older draft was restored. Start from the current records.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Campaign name", exact: true })).toHaveCount(0);
  await page.goBack();
  await review(page);
  await expect(series.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Independent series candidate",
  );
  await page.goBack();
  await review(page);
  await expect(movie.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Independent movie candidate",
  );
  expect(audits(fixture)).toHaveLength(0);
  await leave(page, "Series");
  expect(
    (await page.request.post(API + "/auth/logout", { headers: { origin: WEB } })).status(),
  ).toBe(204);
  const login = await page.request.post(API + "/auth/login", {
    headers: { origin: WEB },
    data: { email: fixture.email, password: "strong-pass-123" },
  });
  expect(login.ok()).toBe(true);
  expect(
    (
      await page.request.post(API + "/auth/mfa/challenge", {
        headers: { origin: WEB },
        data: {
          challengeToken: (await login.json()).challengeToken,
          recoveryCode: fixture.recoveryCode,
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goBack();
  await expect(movie.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await sidebar(page, "Series");
  await expect(series.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toHaveCount(0);
  await page.getByRole("link", { name: "Advertising", exact: true }).click();
  await page.getByRole("tab", { name: "Campaigns", exact: true }).click();
  await panel.getByRole("button", { name: "Read current records", exact: true }).click();
  await expect(
    panel.getByText(
      "The earlier draft could not be retained. No older draft was restored. Start from the current records.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("A dirty episode keeps its original baseline when a sibling save reads a newer external edit", async ({
  page,
}) => {
  const fixture = await seed(page);
  await edit(page, "series", fixture);
  const episodes = page.getByRole("form", { name: "Episode details", exact: true });
  await episodes
    .first()
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Private original episode intent");
  db("change-episode", { ...fixture, episodeId: fixture.series[0]!.seasons[0]!.episodes[0]!.id });
  await episodes
    .nth(1)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Acknowledged different sibling");
  await episodes.nth(1).getByRole("button", { name: "Save episode", exact: true }).click();
  await expect(page.getByText("Episode saved.", { exact: true })).toBeVisible();
  await expect(episodes.first().getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Private original episode intent",
  );
  await leave(page, "Movies");
  await page.goBack();
  await review(page);
  await expect(page.getByRole("region", { name: "Catalog draft recovery" })).toContainText(
    "Episode records or their order changed",
  );
  await expect(episodes).toHaveCount(0);
  expect(
    audits(fixture)
      .filter((row) => row.action === "catalog.episode.update")
      .map((row) => row.entityId),
  ).toEqual([fixture.series[0]!.seasons[0]!.episodes[1]!.id]);
});
