import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountScopeError, requestAccountScope } from "@/lib/account-scope";
import {
  contentReportInput,
  reportFailureIsUncertain,
  submitContentReport,
  type ReportTarget,
} from "./report-contract";
const accountId = "a0000000-0000-4000-8000-000000000001",
  changedAccount = "b0000000-0000-4000-8000-000000000002",
  targetId = "c0000000-0000-4000-8000-000000000003",
  reportId = "d0000000-0000-4000-8000-000000000004";
const actor = (id = accountId) => Response.json({ account: { id } });
afterEach(() => vi.unstubAllGlobals());
describe("account-fenced report transport", () => {
  it.each(["videoId", "commentId", "channelId"])(
    "submits one bounded %s report with a confirmed owned response",
    async (key) => {
      const target = { [key]: targetId } as ReportTarget;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(actor())
        .mockResolvedValueOnce(Response.json({ id: reportId, ...target }))
        .mockResolvedValueOnce(actor());
      vi.stubGlobal("fetch", fetcher);
      expect(await submitContentReport(target, "HARASSMENT", " Concern ")).toEqual({
        accountId,
        value: { id: reportId },
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(new URL(fetcher.mock.calls[1]![0]).pathname).toBe("/trust/reports");
      expect(fetcher.mock.calls[1]![1]).toMatchObject({
        method: "POST",
        credentials: "include",
        headers: { "x-ayin-expected-account": accountId },
        body: JSON.stringify({ ...target, reason: "HARASSMENT", details: "Concern" }),
      });
    },
  );
  it("rejects ambiguous targets, injected keys, invalid IDs, reasons and oversize text before any request", () => {
    for (const target of [
      {},
      { accountId },
      { videoId: targetId, channelId: targetId },
      { videoId: "not-id" },
    ])
      expect(() => contentReportInput(target as ReportTarget, "OTHER", "")).toThrow();
    expect(() => contentReportInput({ videoId: targetId }, "FAKE" as never, "")).toThrow();
    expect(() => contentReportInput({ videoId: targetId }, "OTHER", "a".repeat(4001))).toThrow();
  });
  it("does not replay an unconfirmed POST or show a late ACK under a changed account", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(Response.json({ id: reportId, videoId: targetId }))
      .mockResolvedValueOnce(actor(changedAccount));
    vi.stubGlobal("fetch", fetcher);
    const error = await submitContentReport({ videoId: targetId }, "OTHER", "").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(AccountScopeError);
    expect(reportFailureIsUncertain(error)).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("never submits a draft under a different account from the one that opened the form", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(actor(changedAccount));
    vi.stubGlobal("fetch", fetcher);
    const error = await submitContentReport({ commentId: targetId }, "OTHER", "Private draft", {
      expectedAccountId: accountId,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: "ACCOUNT_CHANGED", writeStarted: false });
    expect(reportFailureIsUncertain(error)).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1].headers).toMatchObject({
      "x-ayin-expected-account": accountId,
    });
  });
  it.each([400, 401, 403, 404, 409, 429])(
    "does not imply a rejected %s report was sent",
    (status) => {
      expect(reportFailureIsUncertain(new AccountScopeError(status, "REJECTED", true))).toBe(false);
    },
  );
  it.each([0, 408, 500, 503])("never auto-retries an uncertain %s report", (status) => {
    expect(reportFailureIsUncertain(new AccountScopeError(status, "FAILED", true))).toBe(true);
  });
  it("rejects an ACK for a different target without automatic retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(Response.json({ id: reportId, commentId: targetId }));
    vi.stubGlobal("fetch", fetcher);
    const error = await submitContentReport({ videoId: targetId }, "OTHER", "").catch(
      (cause: unknown) => cause,
    );
    expect(reportFailureIsUncertain(error)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["/trust/actions", "/trust/reports/other", "/trust/reports?all=true"])(
    "does not broaden account transport to %s",
    async (path) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(requestAccountScope(path, "POST", (raw) => raw)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
