import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
function fixture(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/home-builder-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  );
}

// INHERIT's first-section behavior depends on actual absence, including disabled
// rows. Preserve the seeded configuration and its children instead of assuming
// an empty database or running a global reset/seed. The ordinary E2E runner is
// serial; this fixture refuses multiple workers before changing any data.
test("home builder reviews the first inherited section and verifies automatic mode without replacing it", async ({
  page,
}, testInfo) => {
  expect(testInfo.config.workers).toBe(1);
  // Validate and capture before any application or fixture mutation. The helper
  // never falls back to DATABASE_URL or accepts a remote/production database.
  const saved = fixture("snapshot");
  let accountId: string | undefined;
  let channelId: string | undefined;
  let emptied = false;
  const failures: unknown[] = [];
  try {
    const suffix = randomUUID();
    const registration = await page.request.post(`${API}/auth/register`, {
      data: {
        name: "Home builder operator",
        email: `home-builder-${suffix}@e2e.ayin.test`,
        password: "strong-pass-123",
      },
      headers: { origin: WEB },
    });
    expect(registration.ok()).toBeTruthy();
    const { user } = (await registration.json()) as {
      user: { account: { id: string }; channel: { id: string } };
    };
    accountId = user.account.id;
    channelId = user.channel.id;
    await enrollMfa(page.request);
    fixture("grant", { accountId });
    emptied = true;
    fixture("empty");

    const createdRequests: Array<Record<string, unknown>> = [];
    const modeRequests: Array<Record<string, unknown>> = [];
    const modeReadback: string[] = [];
    page.on("request", (request) => {
      if (
        request.url() === `${API}/admin/product-controls/home-rows` &&
        request.method() === "POST"
      )
        createdRequests.push(request.postDataJSON());
      if (
        request.url() === `${API}/admin/settings/homeDiscoveryMode` &&
        request.method() === "PATCH"
      ) {
        modeRequests.push(request.postDataJSON());
        modeReadback.push("PATCH");
      }
      if (
        modeRequests.length &&
        request.url() === `${API}/admin/product-controls` &&
        request.method() === "GET"
      )
        modeReadback.push("GET");
    });

    await page.goto("/admin/product-controls?lang=en");
    const mode = page.getByRole("form", { name: "Home composition", exact: true });
    await expect(mode.getByLabel("Home composition", { exact: true })).toHaveValue("INHERIT");
    const initialResponse = await page.request.get(`${API}/admin/product-controls`);
    expect(initialResponse.status()).toBe(200);
    const initial = await initialResponse.json();
    expect(initial.rows).toEqual([]);
    expect(initial.homeDiscoveryMode).toBe("INHERIT");
    expect(initial.homeRowsRevision).toMatch(/^[a-f0-9]{64}$/);

    const sectionKey = `e2e-home-${suffix}`;
    const sectionTitle = "حكايات كاملة · Complete stories";
    const createReason = "Review the first inherited home section";
    await page.getByLabel("Audit reason", { exact: true }).fill(createReason);
    await page
      .locator("summary")
      .filter({ hasText: /^Create section$/ })
      .click();
    const creation = page.getByRole("form", { name: "Create section", exact: true });
    await creation.getByLabel("Section title", { exact: true }).fill(sectionTitle);
    await creation.getByLabel("Section key", { exact: true }).fill(sectionKey);
    await creation.getByLabel("Content source", { exact: true }).selectOption("RECENTLY_ADDED");
    await creation.getByLabel("Maximum items", { exact: true }).fill("12");
    await creation.getByLabel("Enable this section in Managed mode", { exact: true }).uncheck();
    const create = creation.getByRole("button", { name: "Create section", exact: true });
    await expect(create).toBeDisabled();
    expect(createdRequests).toHaveLength(0);
    await creation
      .getByRole("checkbox", { name: /^I understand that creating the first section switches/ })
      .check();
    await expect(create).toBeEnabled();
    const creationResponse = page.waitForResponse(
      (response) =>
        response.url() === `${API}/admin/product-controls/home-rows` &&
        response.request().method() === "POST",
    );
    await create.click();
    expect((await creationResponse).status()).toBe(201);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Section saved. Review its content and visibility below." }),
    ).toBeVisible();
    expect(createdRequests).toHaveLength(1);
    expect(createdRequests[0]).toMatchObject({
      expectedRowsRevision: initial.homeRowsRevision,
      key: sectionKey,
      title: sectionTitle,
      source: "RECENTLY_ADDED",
      enabled: false,
      maxItems: 12,
      confirmManagedTransition: true,
      reason: createReason,
    });
    const created = fixture("evidence", { accountId });
    expect(created.rows).toHaveLength(1);
    const row = created.rows[0];
    expect(row).toMatchObject({
      id: createdRequests[0]!.requestId,
      title: sectionTitle,
      enabled: false,
      maxItems: 12,
    });
    expect(created.creationAudits).toHaveLength(1);
    expect(created.creationAudits[0]).toMatchObject({
      entityId: row.id,
      reason: createReason,
      metadata: { inheritedModeChanged: true, enabled: false },
    });
    expect(created.mode).toBeNull();
    const managedHome = await page.request.get(`${API}/public/discovery/home`);
    expect(managedHome.status()).toBe(200);
    expect(await managedHome.json()).toEqual({
      mode: "MANAGED",
      status: "DISABLED",
      spotlight: null,
      rows: [],
    });

    const modeReason = "Keep the reviewed section while enabling automatic catalog";
    await page.getByLabel("Audit reason", { exact: true }).fill(modeReason);
    await mode.getByLabel("Home composition", { exact: true }).selectOption("AUTO");
    const saveMode = mode.getByRole("button", { name: "Save home composition", exact: true });
    await expect(saveMode).toBeDisabled();
    expect(modeRequests).toHaveLength(0);
    await mode
      .getByRole("checkbox", { name: "I reviewed how this changes the public home.", exact: true })
      .check();
    await expect(saveMode).toBeEnabled();
    await saveMode.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Home composition saved and verified." }),
    ).toBeVisible();
    expect(modeRequests).toEqual([{ value: "AUTO", reason: modeReason, confirmHighImpact: true }]);
    expect(modeReadback).toEqual(["PATCH", "GET"]);
    const confirmedResponse = await page.request.get(`${API}/admin/product-controls`);
    expect(confirmedResponse.status()).toBe(200);
    const confirmed = await confirmedResponse.json();
    expect(confirmed.homeDiscoveryMode).toBe("AUTO");
    expect(confirmed.rows).toHaveLength(1);
    expect(confirmed.rows[0]).toMatchObject({
      id: row.id,
      key: sectionKey,
      title: sectionTitle,
      enabled: false,
      maxItems: 12,
    });
    const afterMode = fixture("evidence", { accountId });
    expect(afterMode.rows).toEqual([row]);
    expect(afterMode.mode.value).toBe("AUTO");
    expect(afterMode.modeAudits).toHaveLength(1);
    expect(afterMode.modeAudits[0]).toMatchObject({
      reason: modeReason,
      metadata: { previousValue: "INHERIT", newValue: "AUTO", highImpact: true },
    });
    expect(afterMode.creationAudits).toHaveLength(1);
  } catch (error) {
    failures.push(error);
    try {
      await testInfo.attach("home-builder-primary-state", {
        body: await page.screenshot({ fullPage: true, timeout: 5_000 }),
        contentType: "image/png",
      });
    } catch (captureError) {
      failures.push(captureError);
    }
  } finally {
    // Attempt every restoration step without replacing the original assertion
    // with a later teardown error. Retain additional failures as CI evidence.
    for (const cleanup of [
      () => page.goto("about:blank"),
      () => {
        if (emptied) fixture("restore", saved);
      },
      () => {
        if (accountId && channelId) fixture("cleanup", { accountId, channelId });
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 1)
    await testInfo
      .attach("home-builder-additional-failures", {
        body: failures
          .slice(1)
          .map((error) => (error instanceof Error ? error.stack : String(error)))
          .join("\n\n"),
        contentType: "text/plain",
      })
      .catch((error: unknown) => failures.push(error));
  if (failures.length) throw failures[0];
});
