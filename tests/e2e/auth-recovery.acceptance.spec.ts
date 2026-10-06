import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  authRecoveryAr,
  authRecoveryEn,
} from "../../apps/web/src/lib/i18n/resources/auth-recovery";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const syntheticToken = "synthetic+opaque/reset=token-with-no-live-authority";
const fixture = path.resolve("tests/e2e/auth-recovery-fixture.mjs");
test.use({ serviceWorkers: "block" });

function fixtureCommand(command: "token" | "state", accountId: string) {
  return JSON.parse(
    execFileSync(process.execPath, [fixture, command, accountId], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    }),
  );
}
async function capture(page: Page, info: TestInfo, state: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await info.attach(state, {
    body: await page.screenshot({
      path: info.outputPath(`design-auth-recovery-${state}.png`),
      fullPage: true,
    }),
    contentType: "image/png",
  });
}
async function fillPassword(page: Page, password = "synthetic-new-password") {
  await page.locator('[name="password"]').fill(password);
  await page.locator('[name="confirmation"]').fill(password);
}

for (const locale of ["en", "ar"] as const) {
  const messages = locale === "ar" ? authRecoveryAr : authRecoveryEn;
  const t = (key: keyof typeof authRecoveryEn) => messages[key];
  const prefix = locale === "ar" ? "/ar" : "";
  for (const width of [390, 1440]) {
    test(`Forgot password localized validation, loading, retry and generic success ${locale} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/forgot-password?lang=${locale}`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t("authRecovery.forgotTitle"),
      );
      await expect(
        page.getByRole("link", { name: t("authRecovery.backToSignIn") }),
      ).toHaveAttribute("href", `${prefix}/login`);
      const email = page.locator('[name="email"]');
      await expect(email).toHaveAttribute("dir", "ltr");
      await expect(email).toHaveAttribute("maxlength", "320");
      await capture(page, info, `forgot-initial-${locale}-${width}`);
      const submit = page.getByRole("button", { name: t("authRecovery.send"), exact: true });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        t("authRecovery.emailInvalid"),
      );
      await expect(email).toBeFocused();
      await expect(email).toHaveAttribute("aria-invalid", "true");
      await capture(page, info, `forgot-validation-${locale}-${width}`);
      await email.fill("synthetic@example.invalid");
      let requests = 0;
      let responseStatus = 503;
      let release: (() => void) | undefined;
      let held = false;
      await page.route(`${API}/auth/forgot-password`, async (route) => {
        requests++;
        expect(route.request().postDataJSON()).toEqual({ email: "synthetic@example.invalid" });
        if (held)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await route.fulfill({
          status: responseStatus,
          contentType: "application/json",
          body: JSON.stringify(
            responseStatus === 202
              ? { accepted: true }
              : {
                  error: {
                    code: "CONTROLLED",
                    message: "Private provider diagnostic must never appear",
                  },
                },
          ),
        });
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(t("authRecovery.failed"));
      await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
      await capture(page, info, `forgot-retry-${locale}-${width}`);
      responseStatus = 202;
      held = true;
      await submit.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await expect(page.getByRole("button", { name: t("authRecovery.sending") })).toBeDisabled();
      await expect(email).toBeDisabled();
      await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
      await expect.poll(() => requests).toBe(2);
      await capture(page, info, `forgot-loading-${locale}-${width}`);
      release?.();
      await expect(page.getByRole("main").getByRole("status")).toHaveText(t("authRecovery.sent"));
      await expect(page.getByRole("main").getByRole("status")).toBeFocused();
      await expect(page.locator("form")).toHaveCount(0);
      await capture(page, info, `forgot-success-${locale}-${width}`);
    });

    test(`Reset password localized rules, mismatch, rate limit, success and navigation ${locale} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/reset-password?token=${encodeURIComponent(syntheticToken)}&lang=${locale}`);
      expect(new URL(page.url()).searchParams.get("token")).toBe(syntheticToken);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t("authRecovery.resetTitle"),
      );
      await expect(page.locator('[name="password"]')).toHaveAttribute("minlength", "10");
      await expect(page.locator('[name="password"]')).toHaveAttribute("maxlength", "128");
      await expect(page.locator('[name="password"]')).toHaveAttribute("dir", "ltr");
      await expect(page.getByText(t("authRecovery.resetIntro"))).toBeVisible();
      await capture(page, info, `reset-initial-${locale}-${width}`);
      const submit = page.getByRole("button", { name: t("authRecovery.reset"), exact: true });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        t("authRecovery.passwordInvalid"),
      );
      await expect(page.locator('[name="password"]')).toBeFocused();
      await page.locator('[name="password"]').fill("synthetic-new-password");
      await page.locator('[name="confirmation"]').fill("different-password");
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        t("authRecovery.passwordMismatch"),
      );
      await expect(page.locator('[name="confirmation"]')).toBeFocused();
      await capture(page, info, `reset-validation-${locale}-${width}`);
      await fillPassword(page, " ".repeat(10));
      let status = 429;
      let requests = 0;
      let release: (() => void) | undefined;
      await page.route(`${API}/auth/reset-password`, async (route) => {
        requests++;
        expect(route.request().postDataJSON()).toEqual({
          password: " ".repeat(10),
          token: syntheticToken,
        });
        if (status === 200)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(
            status === 200
              ? { reset: true }
              : { error: { message: "Private provider diagnostic must never appear" } },
          ),
        });
      });
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        t("authRecovery.rateLimited"),
      );
      await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
      await capture(page, info, `reset-rate-limit-${locale}-${width}`);
      status = 200;
      await submit.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await expect(page.getByRole("button", { name: t("authRecovery.resetting") })).toBeDisabled();
      await expect(page.locator('[name="password"]')).toBeDisabled();
      await expect.poll(() => requests).toBe(2);
      await capture(page, info, `reset-loading-${locale}-${width}`);
      release?.();
      await expect(page.getByRole("main").getByRole("status")).toHaveText(
        t("authRecovery.complete"),
      );
      await expect(page.getByRole("main").getByRole("status")).toBeFocused();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await expect(page.getByRole("link", { name: t("authRecovery.signIn") })).toHaveAttribute(
        "href",
        `${prefix}/login`,
      );
      await capture(page, info, `reset-success-${locale}-${width}`);
    });

    test(`Invalid and expired reset links offer canonical recovery ${locale} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      for (const query of ["", "&token=first&token=second"]) {
        await page.goto(`/reset-password?lang=${locale}${query}`);
        await expect(page.getByRole("main").getByRole("alert")).toHaveText(
          t("authRecovery.invalidLink"),
        );
        await expect(page.locator("form")).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: t("authRecovery.requestLink") }),
        ).toHaveAttribute("href", `${prefix}/forgot-password`);
      }
      await capture(page, info, `reset-invalid-${locale}-${width}`);
      await page.goto(`/reset-password?token=${encodeURIComponent(syntheticToken)}&lang=${locale}`);
      await page.route(`${API}/auth/reset-password`, (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"error":{"code":"UNAUTHORIZED","message":"This password reset link is invalid or expired."}}',
        }),
      );
      await fillPassword(page);
      await page.getByRole("button", { name: t("authRecovery.reset"), exact: true }).click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        t("authRecovery.expiredLink"),
      );
      await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      await capture(page, info, `reset-expired-${locale}-${width}`);
      await page.getByRole("link", { name: t("authRecovery.requestLink") }).click();
      await expect(page).toHaveURL(`${WEB}${prefix}/forgot-password`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        t("authRecovery.forgotTitle"),
      );
    });
  }

  test(`Actual synthetic password reset revokes sessions and consumes token ${locale}`, async ({
    page,
    request,
  }, info) => {
    const email = `recovery-${randomUUID()}@e2e.ayin.test`;
    const password = "synthetic-old-password";
    const registered = await page.request.post(`${API}/auth/register`, {
      headers: { origin: WEB },
      data: { name: "Synthetic Recovery", email, password },
    });
    expect(registered.status()).toBe(201);
    const accountId = (await registered.json()).user.account.id as string;
    const other = await request.post(`${API}/auth/login`, {
      headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
      data: { email, password },
    });
    expect(other.status()).toBe(200);
    const otherToken = (await other.json()).sessionToken as string;
    const { token } = fixtureCommand("token", accountId) as { token: string };
    const before = fixtureCommand("state", accountId);
    expect(before.sessions).toHaveLength(2);
    await page.goto(`/reset-password?token=${encodeURIComponent(token)}&lang=${locale}`);
    await fillPassword(page);
    const response = page.waitForResponse(
      (candidate) =>
        candidate.url() === `${API}/auth/reset-password` && candidate.request().method() === "POST",
    );
    await page.getByRole("button", { name: t("authRecovery.reset"), exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole("main").getByRole("status")).toHaveText(t("authRecovery.complete"));
    const after = fixtureCommand("state", accountId);
    expect(after.authVersion).toBe(before.authVersion + 1);
    expect(after.sessions).toHaveLength(2);
    expect(
      after.sessions.every(
        (session: { revokedAt: string | null; revokeReason: string }) =>
          session.revokedAt && session.revokeReason === "PASSWORD_RESET",
      ),
    ).toBe(true);
    expect((await page.request.get(`${API}/auth/me`)).status()).toBe(401);
    expect(
      (
        await request.get(`${API}/auth/me`, { headers: { authorization: `Bearer ${otherToken}` } })
      ).status(),
    ).toBe(401);
    await page.goto(`/reset-password?token=${encodeURIComponent(token)}&lang=${locale}`);
    await fillPassword(page);
    await page.getByRole("button", { name: t("authRecovery.reset"), exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      t("authRecovery.expiredLink"),
    );
    expect(
      (
        await request.post(`${API}/auth/login`, {
          headers: { origin: WEB },
          data: { email, password: "synthetic-new-password" },
        })
      ).status(),
    ).toBe(200);
    await info.attach(`synthetic-api-proof-${locale}`, {
      body: Buffer.from(
        JSON.stringify({
          beforeSessions: before.sessions.length,
          authVersionIncrement: after.authVersion - before.authVersion,
          revokedSessions: after.sessions.length,
          reuseRejected: true,
          cookieRejected: true,
          bearerRejected: true,
          newPasswordAccepted: true,
        }),
      ),
      contentType: "application/json",
    });
  });
}

test("Recovery network retries and pagehide discard secrets and stale feedback", async ({
  page,
}) => {
  await page.goto(`/reset-password?token=${encodeURIComponent(syntheticToken)}&lang=ar`);
  await fillPassword(page);
  await page.route(`${API}/auth/reset-password`, (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: authRecoveryAr["authRecovery.reset"], exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "تعذّر الاتصال بـ AYIN. حاول مرة أخرى.",
  );
  await page.unroute(`${API}/auth/reset-password`);
  let release: (() => void) | undefined;
  await page.route(`${API}/auth/reset-password`, async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({ status: 200, contentType: "application/json", body: '{"reset":true}' })
      .catch(() => undefined);
  });
  await page
    .getByRole("button", { name: authRecoveryAr["authRecovery.reset"], exact: true })
    .click();
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  await expect(page.locator('[name="password"]')).toHaveValue("");
  await expect(page.locator('[name="confirmation"]')).toHaveValue("");
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "false");
  release?.();
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  await page.getByRole("link", { name: authRecoveryAr["authRecovery.backToSignIn"] }).click();
  await expect(page).toHaveURL(`${WEB}/ar/login`);
  await page.goBack();
  await expect(page.locator('[name="password"]')).toHaveValue("");
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
});

test("Localized server validation and connection failures retry without changing password bounds", async ({
  page,
}) => {
  await page.goto("/forgot-password?lang=ar");
  const email = page.locator('[name="email"]');
  await email.fill("synthetic@example.invalid");
  let failedNetwork = false;
  await page.route(`${API}/auth/forgot-password`, (route) =>
    failedNetwork
      ? route.abort("failed")
      : route.fulfill({
          status: 400,
          contentType: "application/json",
          body: '{"error":{"code":"VALIDATION_ERROR","message":"English server validation"}}',
        }),
  );
  const send = page.getByRole("button", { name: authRecoveryAr["authRecovery.send"], exact: true });
  await send.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    authRecoveryAr["authRecovery.emailInvalid"],
  );
  await expect(email).toBeFocused();
  failedNetwork = true;
  await send.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "تعذّر الاتصال بـ AYIN. حاول مرة أخرى.",
  );
  await expect(send).toBeEnabled();

  await page.goto(`/reset-password?token=${encodeURIComponent(syntheticToken)}&lang=ar`);
  let requests = 0;
  let status = 400;
  await page.route(`${API}/auth/reset-password`, (route) => {
    requests++;
    expect(route.request().postDataJSON().password).toBe("x".repeat(128));
    return route.fulfill({
      status,
      contentType: "application/json",
      body:
        status === 200
          ? '{"reset":true}'
          : '{"error":{"code":"VALIDATION_ERROR","message":"English server validation"}}',
    });
  });
  await fillPassword(page, "x".repeat(128));
  const reset = page.getByRole("button", {
    name: authRecoveryAr["authRecovery.reset"],
    exact: true,
  });
  await reset.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    authRecoveryAr["authRecovery.resetInvalid"],
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await page.locator('[name="password"]').evaluate((input: HTMLInputElement) => {
    input.value = "x".repeat(129);
  });
  await reset.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    authRecoveryAr["authRecovery.passwordInvalid"],
  );
  expect(requests).toBe(1);
  await fillPassword(page, "x".repeat(128));
  status = 200;
  await reset.click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    authRecoveryAr["authRecovery.complete"],
  );
  expect(requests).toBe(2);
});
