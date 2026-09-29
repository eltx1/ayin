import { expect, test } from "@playwright/test";

test("old Arabic prefetch responses cannot overwrite an explicit English preference", async ({
  page,
}) => {
  // Exercise the actual Next adapter, which removes Flight headers before Proxy.
  // Missing-hash Flight requests may receive a framework 307 before content; the
  // no-cookie invariant must hold on that response too, not just on a later 200.
  for (const metadata of [{}, { "sec-fetch-dest": "empty" }]) {
    for (const path of ["/ar/browse", "/ar/movies", "/ar/shorts"]) {
      const response = await page.request.get(path, {
        headers: {
          ...metadata,
          rsc: "1",
          "next-router-prefetch": "1",
          cookie: "ayin_locale=en",
        },
        maxRedirects: 0,
      });
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect([200, 307, 308]).toContain(response.status());
      if (response.status() === 307) {
        const target = new URL(response.headers().location!, response.url());
        expect(target.origin).toBe(new URL(response.url()).origin);
        expect(target.searchParams.get("_rsc")).toBeTruthy();
      }
      if (response.status() === 308) {
        expect(new URL(response.headers().location!, response.url()).pathname).toBe("/ar/clips");
      }
    }
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
  // A late browser fetch has sec-fetch-dest=empty even when Next has normalized
  // away its Flight headers. It must not change the next document's locale.
  await page.evaluate(async () => {
    await fetch("/ar/browse", {
      headers: { rsc: "1", "next-router-prefetch": "1" },
      credentials: "same-origin",
      redirect: "manual",
    });
  });
  const afterLateResponse = await page.context().cookies();
  expect(afterLateResponse.find((cookie) => cookie.name === "ayin_locale")?.value).toBe("en");
  await page.goto("/browse");
  await expect(page).toHaveURL(/\/browse$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore AYIN");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
