import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw new Error("Requires isolated local ayin_e2e");
  db("reset");
});
async function operator(page: Page, email: string, role = "CONTENT_MODERATOR") {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Trust operator", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  const user = (await response.json()).user;
  db("grant-operator-role", { accountId: user.account.id, role });
  return user;
}
async function fillAction(page: Page, accountId: string) {
  const main = page.getByRole("main");
  await main.getByRole("tab", { name: "Decisions", exact: true }).click();
  await main.getByText("Resource references", { exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Record enforcement action", exact: true }),
  ).toBeEnabled();
  await main.getByPlaceholder("Account UUID when required", { exact: true }).fill(accountId);
  await main
    .getByPlaceholder("Detailed enforcement reason", { exact: true })
    .fill("Specific actual evidence requiring a warning.");
  return main;
}
test("actual acknowledged action resets its captured form and cannot become failed because of refresh", async ({
  page,
}) => {
  const user = await operator(page, "trust-ack@e2e.ayin.test");
  let reads = 0,
    writes = 0,
    failedRead = false;
  await page.route(`${API}/admin/trust/queue`, async (route) => {
    reads++;
    if (failedRead) return route.fulfill({ status: 503, json: {} });
    await route.continue();
  });
  await page.route(`${API}/admin/trust/actions`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await route.continue();
  });
  await page.goto("/admin/trust?lang=en");
  const main = await fillAction(page, user.account.id),
    before = reads;
  failedRead = true;
  await main.getByRole("button", { name: "Record enforcement action", exact: true }).click();
  await expect(main.getByRole("status")).toContainText("Operation saved.");
  await expect(main.getByPlaceholder("Detailed enforcement reason", { exact: true })).toHaveValue(
    "",
  );
  expect(reads).toBe(before);
  expect(writes).toBe(1);
  const history = await page.request.get(`${API}/trust/creator/history`);
  expect(
    (await history.json()).actions.filter((a: { kind: string }) => a.kind === "WARN"),
  ).toHaveLength(1);
  await main.getByRole("button", { name: "Review current queue", exact: true }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await expect(main.getByRole("status")).toContainText("Operation saved.");
  await expect(
    main.getByRole("button", { name: "Confirm review and enable decisions", exact: true }),
  ).toBeDisabled();
  failedRead = false;
  await main.getByRole("button", { name: "Review current queue", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Confirm review and enable decisions", exact: true }),
  ).toBeEnabled();
  await main
    .getByRole("button", { name: "Confirm review and enable decisions", exact: true })
    .click();
  await expect(
    main.getByRole("button", { name: "Record enforcement action", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
});
test("a committed response loss retains enforcement draft and requires explicit review without replay", async ({
  page,
}) => {
  const user = await operator(page, "trust-loss-admin@e2e.ayin.test");
  let reads = 0,
    writes = 0;
  await page.route(`${API}/admin/trust/queue`, async (route) => {
    reads++;
    await route.continue();
  });
  await page.route(`${API}/admin/trust/actions`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.goto("/admin/trust?lang=en");
  const main = await fillAction(page, user.account.id),
    before = reads;
  await main.getByRole("button", { name: "Record enforcement action", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("outcome could not be verified");
  await expect(main.getByPlaceholder("Detailed enforcement reason", { exact: true })).toHaveValue(
    "Specific actual evidence requiring a warning.",
  );
  await expect(
    main.getByRole("button", { name: "Record enforcement action", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
  expect(reads).toBe(before);
  const history = await page.request.get(`${API}/trust/creator/history`);
  expect(
    (await history.json()).actions.filter((a: { kind: string }) => a.kind === "WARN"),
  ).toHaveLength(1);
  await main.getByRole("button", { name: "Review current queue", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Confirm review and enable decisions", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
  expect(reads).toBe(before + 1);
  await main.getByRole("tab", { name: "Your actions", exact: true }).click();
  const ledger = main.getByRole("region", { name: "Your recent enforcement actions", exact: true });
  await ledger.locator("summary").first().click();
  await expect(ledger.locator("li")).toHaveCount(1);
  await expect(ledger).toContainText("Specific actual evidence requiring a warning.");
  await expect(ledger).toContainText(user.account.id);
});
test("finance identity cannot initiate trust queue or settings reads", async ({ page }) => {
  await operator(page, "trust-finance@e2e.ayin.test", "FINANCE_MANAGER");
  let reads = 0;
  page.on("request", (request) => {
    if (/\/admin\/trust\/(queue|settings|actions)/.test(request.url())) reads++;
  });
  await page.goto("/admin/trust?lang=en");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("cannot read Trust");
  expect(reads).toBe(0);
  await expect(
    page.getByRole("main").getByRole("button", { name: "Record enforcement action", exact: true }),
  ).toBeDisabled();
});

test("the real recent-action endpoint is actor scoped and denies unrelated staff", async ({
  page,
}) => {
  const first = await operator(page, "trust-actor-first@e2e.ayin.test");
  const result = await page.request.post(`${API}/admin/trust/actions`, {
    headers: { origin: WEB },
    data: {
      kind: "WARN",
      targetAccountId: first.account.id,
      reason: "Actual actor-scoped acceptance evidence.",
    },
  });
  expect(result.ok()).toBe(true);
  const action = await result.json();
  const owned = await page.request.get(`${API}/admin/trust/actions`);
  expect(owned.ok()).toBe(true);
  expect((await owned.json()).actions.map((row: { id: string }) => row.id)).toEqual([action.id]);
  await operator(page, "trust-actor-second@e2e.ayin.test");
  const foreign = await page.request.get(`${API}/admin/trust/actions`);
  expect(foreign.ok()).toBe(true);
  expect((await foreign.json()).actions).toEqual([]);
  await operator(page, "trust-actor-finance@e2e.ayin.test", "FINANCE_MANAGER");
  expect((await page.request.get(`${API}/admin/trust/actions`)).status()).toBe(403);
});
