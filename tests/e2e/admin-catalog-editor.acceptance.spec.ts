import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type Movie = {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  status: string;
  availability: Array<{ startsAt: string }>;
  artwork: Array<{ altText: string | null; mediaAssetId: string }>;
};
type Episode = { id: string; title: string; releaseDate: string; sortOrder: number };
type Series = {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  seasons: Array<{ id: string; title: string; episodes: Episode[] }>;
};
type Fixture = { accountId: string; prefix: string; movies: Movie[]; series: Series[] };
type Evidence = Fixture & { audits: Array<{ action: string; entityId: string }> };
function db<T>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/admin-catalog-editor-fixture.mjs"),
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
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Catalog editor operator",
      email: `catalog-${randomUUID()}@e2e.ayin.test`,
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
  kind: "movies" | "series",
  data: Fixture,
  locale: "en" | "ar" = "en",
) {
  await page.goto(`/admin/${kind}?lang=${locale}`);
  await page
    .getByLabel(
      locale === "ar"
        ? kind === "movies"
          ? "البحث عن أفلام"
          : "البحث عن مسلسلات"
        : kind === "movies"
          ? "Search movies"
          : "Search series",
      { exact: true },
    )
    .fill(data.prefix);
  await expect(
    page.getByText((kind === "movies" ? data.movies : data.series)[0]!.title, { exact: true }),
  ).toBeVisible();
}
async function editMovie(page: Page, title: string, locale = "en") {
  await page
    .locator("article")
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole("button", { name: locale === "ar" ? "تعديل" : "Edit", exact: true })
    .click();
}
async function editSeries(page: Page, title: string, locale = "en") {
  await page
    .getByRole("row")
    .filter({ has: page.getByText(title, { exact: true }) })
    .getByRole("button", { name: locale === "ar" ? "إدارة" : "Manage", exact: true })
    .click();
}
async function screenshots(page: Page, info: TestInfo, name: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
  }
}

test("Movie browser reads cannot overwrite drafts or retarget a save", async ({ page }) => {
  const data = await seed(page);
  await open(page, "movies", data);
  const first = data.movies[0]!,
    second = data.movies[1]!;
  await editMovie(page, first.title);
  const form = page.getByRole("form", { name: "Movie details" });
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(first.title);
  await form.getByLabel("Title", { exact: true }).fill(first.title + " edited");
  await page.getByLabel("Search movies").fill("no matching record");
  await expect(page.locator("article")).toHaveCount(0);
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(first.title + " edited");
  await expect(form.getByRole("button", { name: "Save movie", exact: true })).toBeVisible();
  await page.getByLabel("Search movies").fill(data.prefix);
  await editMovie(page, second.title);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(first.title + " edited");
  await editMovie(page, second.title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(second.title);
  const saved = db<Evidence>("evidence", data);
  expect(saved.movies.find((r) => r.id === first.id)?.title).toBe(first.title + " edited");
  expect(saved.movies.find((r) => r.id === second.id)?.title).toBe(second.title);
  expect(saved.movies.find((r) => r.id === first.id)?.availability[0]?.startsAt).toBe(
    "2035-01-01T12:01:23.456Z",
  );
  expect(saved.movies.find((r) => r.id === first.id)?.artwork[0]?.altText).toBe(
    "Keep authored artwork caption",
  );
  expect(saved.audits.filter((r) => r.action === "catalog.movie.update")).toHaveLength(1);
  await form.getByRole("textbox", { name: "Title", exact: true }).fill(second.title + " discarded");
  await editMovie(page, first.title + " edited");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    first.title + " edited",
  );
  const afterDiscard = db<Evidence>("evidence", data);
  expect(afterDiscard.movies.find((r) => r.id === second.id)?.title).toBe(second.title);
  expect(afterDiscard.audits.filter((r) => r.action === "catalog.movie.update")).toHaveLength(1);
});

test("Late Movie detail A cannot replace selected B, and territory typing keeps focus", async ({
  page,
}) => {
  const data = await seed(page);
  await open(page, "movies", data);
  const first = data.movies[0]!,
    second = data.movies[1]!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let delivered!: () => void;
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(API + `/admin/catalog/movies/${first.id}`, async (route) => {
    const response = await route.fetch();
    requested();
    await held;
    await route.fulfill({ response });
    delivered();
  });
  await editMovie(page, first.title);
  await started;
  await editMovie(page, second.title);
  const form = page.getByRole("form", { name: "Movie details" });
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(second.title);
  release();
  await delivery;
  await page.unroute(API + `/admin/catalog/movies/${first.id}`);
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(second.title);
  const territory = form.getByLabel("Territory", { exact: true });
  await territory.fill("");
  await territory.pressSequentially("us");
  await expect(territory).toHaveValue("US");
  await expect(territory).toBeFocused();
});

test("Series create uses its returned ID with duplicate titles and blocks synchronous duplicate submission", async ({
  page,
}) => {
  const data = await seed(page);
  await open(page, "series", data);
  const form = page.getByRole("form", { name: "Series details" });
  await form.getByLabel("Title", { exact: true }).fill(data.series[0]!.title);
  await form.getByLabel("Slug", { exact: true }).fill(data.prefix + "created-duplicate-title");
  await form.getByRole("textbox", { name: "Synopsis", exact: true }).fill("Created exact identity");
  await form.getByLabel("Genres / categories", { exact: true }).fill("Drama");
  await form.evaluate((node: HTMLFormElement) => {
    node.requestSubmit();
    node.requestSubmit();
  });
  await expect(page.getByRole("status").filter({ hasText: "Series draft created." })).toBeVisible();
  const created = db<Evidence>("evidence", data).series.find(
    (r) => r.slug === data.prefix + "created-duplicate-title",
  )!;
  expect(created).toBeTruthy();
  expect(created.id).not.toBe(data.series[0]!.id);
  const addSeason = page.getByRole("form", { name: "New season", exact: true });
  await addSeason.getByLabel("Title", { exact: true }).fill("Belongs to returned ID");
  await addSeason.getByRole("button", { name: "Add season", exact: true }).click();
  await expect(page.getByText("Season created.", { exact: true })).toBeVisible();
  const evidence = db<Evidence>("evidence", data);
  expect(evidence.series.find((r) => r.id === created.id)?.seasons[0]?.title).toBe(
    "Belongs to returned ID",
  );
  expect(evidence.series.find((r) => r.id === data.series[0]!.id)?.seasons).toHaveLength(2);
  expect(evidence.audits.filter((r) => r.action === "catalog.series.create")).toHaveLength(1);
});

test("Series targeted saves and reorder preserve parent and sibling drafts", async ({ page }) => {
  const data = await seed(page);
  await open(page, "series", data);
  await editSeries(page, data.series[0]!.title);
  const series = page.getByRole("form", { name: "Series details", exact: true });
  const seasons = page.getByRole("form", { name: "Season details", exact: true });
  const episodeForms = page.getByRole("form", { name: "Episode details", exact: true });
  await series
    .getByRole("textbox", { name: "Synopsis", exact: true })
    .fill("Parent unsaved synopsis");
  await seasons.nth(0).getByLabel("Season title", { exact: true }).fill("Season unsaved title");
  await episodeForms.nth(1).getByLabel("Title", { exact: true }).fill("Sibling unsaved title");
  await episodeForms.nth(0).getByLabel("Title", { exact: true }).fill("First episode saved");
  await episodeForms.nth(0).getByRole("button", { name: "Save episode", exact: true }).click();
  await expect(page.getByText("Episode saved.", { exact: true })).toBeVisible();
  await expect(series.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue(
    "Parent unsaved synopsis",
  );
  await expect(seasons.nth(0).getByLabel("Season title", { exact: true })).toHaveValue(
    "Season unsaved title",
  );
  await expect(episodeForms.nth(1).getByLabel("Title", { exact: true })).toHaveValue(
    "Sibling unsaved title",
  );
  await episodeForms
    .nth(1)
    .getByRole("button", { name: "Move up: Second episode", exact: true })
    .click();
  await expect(page.getByText("Episode ordering updated.", { exact: true })).toBeVisible();
  await expect(episodeForms.nth(0).getByLabel("Title", { exact: true })).toHaveValue(
    "Sibling unsaved title",
  );
  await editSeries(page, data.series[1]!.title);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(series.getByRole("textbox", { name: "Synopsis", exact: true })).toHaveValue(
    "Parent unsaved synopsis",
  );
  await editSeries(page, data.series[1]!.title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(series.getByLabel("Title", { exact: true })).toHaveValue(data.series[1]!.title);
  const saved = db<Evidence>("evidence", data).series.find((r) => r.id === data.series[0]!.id)!;
  expect(saved.synopsis).toBe("Parent unsaved synopsis");
  expect(saved.seasons[0]?.title).toBe("Season unsaved title");
  expect(
    saved.seasons[0]?.episodes.find((r) => r.id === data.series[0]!.seasons[0]!.episodes[0]!.id)
      ?.releaseDate,
  ).toBe("2035-01-01T12:01:23.456Z");
  expect(saved.seasons[0]?.episodes.some((r) => r.title === "Sibling unsaved title")).toBe(true);
});

test("Acknowledged Movie save remains committed when list refresh fails", async ({ page }) => {
  const data = await seed(page);
  await open(page, "movies", data);
  await editMovie(page, data.movies[0]!.title);
  const form = page.getByRole("form", { name: "Movie details" });
  await form.getByLabel("Title", { exact: true }).fill(data.movies[0]!.title + " committed");
  await page.route(API + "/admin/catalog/movies?*", (route) => route.abort());
  await form.getByRole("button", { name: "Save movie", exact: true }).click();
  await expect(page.getByText("Movie changes saved.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Changes were saved, but" }),
  ).toBeVisible();
  expect(
    db<Evidence>("evidence", data).audits.filter((r) => r.action === "catalog.movie.update"),
  ).toHaveLength(1);
});

test("Unknown create outcome retains draft and does not blindly replay", async ({ page }) => {
  const data = await seed(page);
  await open(page, "series", data);
  const form = page.getByRole("form", { name: "Series details" });
  await form.getByLabel("Title", { exact: true }).fill(data.prefix + "uncertain");
  await form.getByLabel("Slug", { exact: true }).fill(data.prefix + "uncertain");
  await form
    .getByRole("textbox", { name: "Synopsis", exact: true })
    .fill("Preserve me after unknown acknowledgement");
  await form.getByLabel("Genres / categories", { exact: true }).fill("Drama");
  await page.route(API + "/admin/catalog/series", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ series: { id: "wrong" } }),
    });
  });
  await form.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "No request was repeated." }),
  ).toBeVisible();
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue(data.prefix + "uncertain");
  await expect(form.getByRole("button", { name: "Create draft", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh list", exact: true }).click();
  await expect(form.getByRole("button", { name: "Create draft", exact: true })).toBeDisabled();
  expect(
    db<Evidence>("evidence", data).audits.filter((r) => r.action === "catalog.series.create"),
  ).toHaveLength(1);
});

for (const locale of ["en", "ar"] as const) {
  test(`Catalog native ${locale} desktop/mobile fields and identity conceal`, async ({
    page,
  }, info) => {
    const data = await seed(page);
    await open(page, "movies", data, locale);
    await editMovie(page, data.movies[0]!.title, locale);
    await screenshots(page, info, `movie-${locale}`);
    await open(page, "series", data, locale);
    await editSeries(page, data.series[0]!.title, locale);
    await screenshots(page, info, `series-${locale}`);
    const form = page.getByRole("form", {
      name: locale === "ar" ? "بيانات المسلسل" : "Series details",
    });
    await form
      .getByRole("textbox", { name: locale === "ar" ? "الملخص" : "Synopsis", exact: true })
      .fill("PRIVATE CATALOG DRAFT");
    await page.route(API + "/admin/catalog/series?*", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "SESSION_CHANGED", message: "Session changed" } }),
      }),
    );
    await page
      .getByLabel(locale === "ar" ? "البحث عن مسلسلات" : "Search series", { exact: true })
      .fill("trigger-scope-change");
    await expect(form).toHaveCount(0);
    await expect(page.locator("textarea").filter({ hasText: "PRIVATE CATALOG DRAFT" })).toHaveCount(
      0,
    );
  });
}

test("Serial navigation saves commit once and stop at invalid child before navigation", async ({
  page,
}) => {
  const data = await seed(page);
  await open(page, "series", data);
  await editSeries(page, data.series[0]!.title);
  const season = page.getByRole("form", { name: "Season details", exact: true }).nth(0);
  const episode = page.getByRole("form", { name: "Episode details", exact: true }).nth(0);
  await season.getByLabel("Season title", { exact: true }).fill("Serial season committed once");
  await episode.getByLabel("Title", { exact: true }).fill("");
  await editSeries(page, data.series[1]!.title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Not all drafts were saved.");
  let evidence = db<Evidence>("evidence", data);
  expect(evidence.audits.filter((r) => r.action === "catalog.season.update")).toHaveLength(1);
  expect(evidence.audits.filter((r) => r.action === "catalog.episode.update")).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Series details" }).getByLabel("Title", { exact: true }),
  ).toHaveValue(data.series[0]!.title);
  await episode.getByLabel("Title", { exact: true }).fill("Serial episode corrected");
  await editSeries(page, data.series[1]!.title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Series details" }).getByLabel("Title", { exact: true }),
  ).toHaveValue(data.series[1]!.title);
  evidence = db<Evidence>("evidence", data);
  expect(evidence.audits.filter((r) => r.action === "catalog.season.update")).toHaveLength(1);
  expect(evidence.audits.filter((r) => r.action === "catalog.episode.update")).toHaveLength(1);
});

test("Malformed picker responses offer no resources and remain recoverable", async ({ page }) => {
  const data = await seed(page);
  await page.route(API + "/admin/operations/directory/catalog-videos*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ id: "invalid", label: "UNVERIFIED RESOURCE" }] }),
    }),
  );
  await open(page, "movies", data);
  await page.getByLabel("Search Primary playback", { exact: true }).fill("malformed");
  await expect(
    page.getByRole("alert").filter({ hasText: "Search results could not be verified." }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button").filter({ hasText: "UNVERIFIED RESOURCE" })).toHaveCount(0);
  await page.unroute(API + "/admin/operations/directory/catalog-videos*");
  await page.getByLabel("Search Primary playback", { exact: true }).fill("no matching resource");
  await expect(
    page.getByRole("alert").filter({ hasText: "Search results could not be verified." }),
  ).toHaveCount(1);
});

test("Standalone localization picker conceals and scrubs its own native root", async ({ page }) => {
  const data = await seed(page);
  await page.goto("/admin/catalog-localizations?lang=en");
  await page
    .getByRole("combobox", { name: "Catalog entity", exact: true })
    .selectOption(data.movies[0]!.id);
  const input = page.getByLabel("Search Localized poster override", { exact: true });
  await expect(input).toBeVisible();
  await page.route(API + "/admin/operations/directory/catalog-artwork?*", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "ACCOUNT_CHANGED", message: "Account changed" } }),
    }),
  );
  await input.fill("PRIVATE PICKER QUERY");
  await expect(input).toBeHidden();
  await expect(input).toHaveValue("");
  expect(
    await input.evaluate((field) => ({
      defaultValue: (field as HTMLInputElement).defaultValue,
      display: getComputedStyle(field.parentElement!).display,
      inert: field.parentElement!.inert,
    })),
  ).toEqual({ defaultValue: "", display: "none", inert: true });
});

test("Movie lifecycle confirms the saved record and keeps it selected outside the active filter", async ({
  page,
}) => {
  const data = await seed(page);
  await open(page, "movies", data);
  await editMovie(page, data.movies[0]!.title);
  const form = page.getByRole("form", { name: "Movie details" });
  await expect(form.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await form
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(data.movies[0]!.title + " lifecycle");
  await expect(form.getByRole("button", { name: "Archive", exact: true })).toBeDisabled();
  await form.getByRole("button", { name: "Save movie", exact: true }).click();
  await expect(page.getByText("Movie changes saved.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by status", exact: true }).selectOption("DRAFT");
  await form.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    db<Evidence>("evidence", data).audits.filter((row) => row.action === "catalog.movie.archive"),
  ).toHaveLength(0);
  await form.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Movie archived.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: data.movies[0]!.title + " lifecycle",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("article").filter({ hasText: data.movies[0]!.title })).toHaveCount(0);
  const evidence = db<Evidence>("evidence", data);
  expect(evidence.movies.find((row) => row.id === data.movies[0]!.id)?.status).toBe("ARCHIVED");
  expect(evidence.audits.filter((row) => row.action === "catalog.movie.archive")).toHaveLength(1);
});
