import { expect, test } from "@playwright/test";

test("old Arabic prefetch responses cannot overwrite an explicit English preference", async ({
  page,
}) => {
  for (const path of ["/ar/browse", "/ar/movies", "/ar/shorts"]) {
    const response = await page.request.get(path, {
      headers: { rsc: "1", "next-router-prefetch": "1", cookie: "ayin_locale=en" },
      maxRedirects: 0,
    });
    expect([200, 308]).toContain(response.status());
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
  for (const locale of ["ar", "en", "ar", "en"]) {
    await page.goto(`/browse?lang=${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "ar" ? "استكشف AYIN" : "Explore AYIN",
    );
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === "ayin_locale")?.value).toBe(locale);
  }
});
