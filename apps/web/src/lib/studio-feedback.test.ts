import { afterEach, describe, expect, it, vi } from "vitest";

import { getStudioComments, type StudioComment } from "./studio";
import { filterRecentComments } from "./studio-feedback";
import {
  createSupportTicket,
  getMySupportTickets,
  isUncertainSupportFailure,
  SupportRequestError,
  validateSupportDraft,
} from "./support";
import { studioFeedbackEn, studioFeedbackAr } from "./i18n/resources/studio-feedback";
import { enMessages } from "./i18n/resources/en";
import { navigationEn } from "./i18n/resources/navigation";
import { translate } from "./i18n/translator";

afterEach(() => vi.unstubAllGlobals());

const comments: StudioComment[] = [
  {
    id: "one",
    body: "A helpful VIDEO",
    status: "PUBLISHED",
    createdAt: "2026-01-01T00:00:00Z",
    parentId: null,
    authorProfile: { id: "reader", name: "أحمد", slug: "reader" },
    video: { id: "video", title: "Quiet Sea", commentsEnabled: true },
    _count: { reactions: 0, replies: 1, reports: 0 },
  },
  {
    id: "two",
    body: "رائع فعلًا",
    status: "HIDDEN",
    createdAt: "2026-01-02T00:00:00Z",
    parentId: null,
    authorProfile: { id: "reader2", name: "Alice", slug: "alice" },
    video: { id: "video2", title: "المدينة", commentsEnabled: false },
    _count: { reactions: 2, replies: 0, reports: 1 },
  },
];

describe("creator feedback boundaries", () => {
  it("filters only the provided snapshot without changing order or exposing hidden filters", () => {
    expect(filterRecentComments(comments, "  video  ", "ALL").map((row) => row.id)).toEqual([
      "one",
    ]);
    expect(filterRecentComments(comments, "أحمد", "ALL").map((row) => row.id)).toEqual(["one"]);
    expect(filterRecentComments(comments, "المدينة", "HIDDEN").map((row) => row.id)).toEqual([
      "two",
    ]);
    expect(filterRecentComments(comments, "المدينة", "PUBLISHED")).toEqual([]);
    expect(filterRecentComments(comments, "", "ALL")).toEqual(comments);
    expect(filterRecentComments(comments, "ＡＬＩＣＥ", "ALL").map((row) => row.id)).toEqual([
      "two",
    ]);
    expect(comments.map((row) => row.id)).toEqual(["one", "two"]);
  });

  it("retains no-store ownership requests and propagates cancellation signals", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: [], channel: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal("fetch", fetcher);
    await getStudioComments(signal);
    await getMySupportTickets(signal);
    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: "include", cache: "no-store", signal });
    }
    expect(fetcher.mock.calls[0]![0]).toContain("/creator/studio/comments");
    expect(fetcher.mock.calls[1]![0]).toContain("/support/tickets");
  });

  it("keeps failed and malformed reads distinct from genuinely empty results", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comments: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal("fetch", fetcher);
    await expect(getMySupportTickets()).rejects.toMatchObject({ status: 503 });
    await expect(getMySupportTickets()).rejects.toThrow("Invalid support response");
    await expect(getStudioComments()).rejects.toThrow("Invalid comments response");
    await expect(getMySupportTickets()).resolves.toEqual({ items: [] });
  });

  it("matches existing server length limits, including trimmed and upper-bound input", () => {
    expect(validateSupportDraft("    ", "          ")).toEqual({
      subject: true,
      description: true,
    });
    expect(validateSupportDraft("  Title  ", "  Enough detail here  ")).toEqual({
      subject: false,
      description: false,
    });
    expect(validateSupportDraft("a".repeat(200), "a".repeat(20000))).toEqual({
      subject: false,
      description: false,
    });
    expect(validateSupportDraft("a".repeat(201), "a".repeat(20001))).toEqual({
      subject: true,
      description: true,
    });
  });

  it("never retries a failed ticket write and marks unknown outcomes conservatively", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "Try later" }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const input = {
      category: "GENERAL",
      subject: "Help me",
      description: "Details of the request",
      priority: "NORMAL" as const,
    };
    await expect(createSupportTicket(input)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(input),
      credentials: "include",
      cache: "no-store",
    });
    for (const status of [400, 401, 403, 404, 409, 422, 429])
      expect(isUncertainSupportFailure(new SupportRequestError(status, "Rejected"))).toBe(false);
    for (const error of [
      new TypeError("Network failed"),
      new SupportRequestError(408, "Timeout"),
      new SupportRequestError(500, "Server failed"),
    ])
      expect(isUncertainSupportFailure(error)).toBe(true);
  });

  it("has complete feedback translations without overriding existing catalog or navigation keys", () => {
    expect(Object.keys(studioFeedbackEn).sort()).toEqual(Object.keys(studioFeedbackAr).sort());
    for (const key of Object.keys(studioFeedbackEn) as Array<keyof typeof studioFeedbackEn>) {
      expect(studioFeedbackAr[key].trim()).not.toBe("");
      expect(Object.hasOwn(enMessages, key)).toBe(false);
      expect(Object.hasOwn(navigationEn, key)).toBe(false);
    }
    expect(translate("ar", "feedback.comments")).toBe("التعليقات");
    expect(translate("en", "browse.more")).toBe("Browse more");
  });
});
