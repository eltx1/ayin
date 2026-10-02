import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";

const stream = {
  id: "00000000-0000-4000-8000-000000000174",
  title: "Live design fixture",
  description: "A creator live session for Viewer acceptance.",
  status: "LIVE",
  playbackUrl: null,
  scheduledStartAt: null,
  chatEnabled: true,
  captions: [],
  dvrWindowSeconds: null,
  channel: {
    id: "00000000-0000-4000-8000-000000000175",
    handle: "live-design",
    name: "Live Design",
  },
  providerStreamId: "must-not-render",
  ingestEndpoint: "rtmps://must-not-render.example/live",
  adBreakHook: "IMA_CLIENT_BREAK",
};

test.use({ serviceWorkers: "block" });

test("Live Viewer is localized and reconciles an uncertain chat write without replay", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  let messages: Array<{ id: string; body: string; createdAt: string }> = [];
  let writes = 0;
  let chatReads = 0;
  await page.clock.install();

  await page.route(`${API}/live/live-design`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(stream),
    });
  });
  await page.route(`${API}/live/live-design/chat`, async (route) => {
    if (route.request().method() === "GET") {
      chatReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatEnabled: true, messages }),
      });
      return;
    }
    if (route.request().method() === "POST") {
      writes += 1;
      const payload = route.request().postDataJSON() as { body: string };
      messages = [
        ...messages,
        {
          id: "00000000-0000-4000-8000-000000000190",
          body: payload.body,
          createdAt: "2026-10-03T00:10:00.000Z",
        },
      ];
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.route(`${API}/analytics/events`, async (route) => {
    await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/live/live-design?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Live design fixture" })).toBeVisible();
  await expect(main.getByText("Live on AYIN", { exact: true })).toBeVisible();
  await expect(main.locator('span[data-tone="success"]')).toHaveText("Live");
  await expect(main.getByRole("link", { name: "View channel", exact: true })).toHaveAttribute(
    "href",
    "/c/live-design",
  );
  await expect(main.getByText("Waiting for live video…", { exact: true })).toBeVisible();
  await expect(main.getByText(/must-not-render/)).toHaveCount(0);
  await expect(main.getByRole("button", { name: /ad-break/i })).toHaveCount(0);

  const message = main.getByLabel("Message", { exact: true });
  await expect(message).toBeVisible();
  await message.fill("A message that may already be sent");
  await main.getByRole("button", { name: "Send", exact: true }).click();
  await expect(main.getByText(/could not confirm whether your message was sent/i)).toBeVisible();
  await expect(message).toHaveValue("A message that may already be sent");
  await expect(main.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  const readsBeforeRecovery = chatReads;
  await page.clock.fastForward(5_100);
  expect(chatReads).toBe(readsBeforeRecovery);
  await expect(main.getByRole("button", { name: "Send", exact: true })).toBeDisabled();

  await main.getByRole("button", { name: "Refresh chat", exact: true }).click();
  await expect(main.getByText("A message that may already be sent", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  expect(writes).toBe(1);

  await page.screenshot({
    path: testInfo.outputPath("design-live-viewer-1440-en.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/live/live-design?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByText("مباشر على AYIN", { exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: "الدردشة المباشرة" })).toBeVisible();
  await expect(main.getByLabel("الرسالة", { exact: true })).toBeVisible();
  await expect(main.getByText("في انتظار الفيديو المباشر…", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-live-viewer-390-ar.png"),
    fullPage: true,
  });
});

test("Live chat serializes read recovery and duplicate submit events", async ({ page }) => {
  let reads = 0;
  let writes = 0;
  let releaseRead!: () => void;
  let releaseWrite!: () => void;
  const readBarrier = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const writeBarrier = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  await page.route(`${API}/live/live-design`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(stream),
    }),
  );
  await page.route(`${API}/analytics/events`, (route) =>
    route.fulfill({ status: 202, body: "{}" }),
  );
  await page.route(`${API}/live/live-design/chat`, async (route) => {
    if (route.request().method() === "GET") {
      reads += 1;
      if (reads === 1) {
        await route.fulfill({ status: 503, body: "{}" });
        return;
      }
      await readBarrier;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          chatEnabled: true,
          messages:
            reads >= 3
              ? [
                  {
                    id: "00000000-0000-4000-8000-000000000192",
                    body: "Another viewer joined",
                    createdAt: "2026-10-03T00:11:00.000Z",
                  },
                ]
              : [],
        }),
      });
      return;
    }
    writes += 1;
    await writeBarrier;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-4000-8000-000000000191",
        body: "One confirmed message",
        createdAt: "2026-10-03T00:10:00.000Z",
      }),
    });
  });
  await page.goto("/live/live-design?lang=en");
  const main = page.getByRole("main");
  const input = main.getByLabel("Message", { exact: true });
  const send = main.getByRole("button", { name: "Send", exact: true });
  await expect(main.getByRole("button", { name: "Reload chat", exact: true })).toBeVisible();
  await input.fill("One confirmed message");
  await expect(send).toBeDisabled();
  await main.getByRole("button", { name: "Reload chat", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(send).toBeDisabled();
  releaseRead();
  await expect(send).toBeEnabled();
  await main.locator("form").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => writes).toBe(1);
  await expect(main.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
  releaseWrite();
  await expect(input).toHaveValue("");
  await expect(main.getByText("One confirmed message", { exact: true })).toHaveCount(1);
  expect(writes).toBe(1);
  await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await expect(main.getByText("Another viewer joined", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
});
