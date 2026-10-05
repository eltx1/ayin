import { afterEach, describe, expect, it, vi } from "vitest";
import {
  firstStudioContentPage,
  nextStudioContentPage,
  parseStudioContentPage,
  previousStudioContentPage,
  readStudioContentPage,
  STUDIO_CONTENT_HISTORY_LIMIT,
} from "./studio-content-page";
const actor = "11111111-1111-4111-8111-111111111111",
  channel = "22222222-2222-4222-8222-222222222222";
const filters = { query: "", status: "", visibility: "" };
function row(n: number) {
  return {
    id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
    title: `Video ${n}`,
    description: null,
    status: "DRAFT",
    visibility: "PUBLIC",
    commentsEnabled: true,
    tvIncluded: true,
    metadata: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    publishedAt: null,
  };
}
function response(count = 1) {
  return {
    actorAccountId: actor,
    channel: { id: channel, name: "Creator", handle: "creator", status: "ACTIVE" },
    page: { ...filters, take: 25, cursor: null },
    videos: Array.from({ length: count }, (_, i) => row(count - i)),
    nextCursor: null as string | null,
  };
}
const identity = () => Response.json({ account: { id: actor } });
afterEach(() => vi.unstubAllGlobals());
describe("bounded Studio content page", () => {
  it("projects only validated rows and carries no invented totals", () => {
    expect(parseStudioContentPage(response(25), filters, null).videos).toHaveLength(25);
    expect(parseStudioContentPage(response(), filters, null)).not.toHaveProperty("total");
  });
  it("rejects oversized, duplicate, misordered and off-filter pages", () => {
    expect(() => parseStudioContentPage(response(26), filters, null)).toThrow();
    const duplicate = response(2);
    duplicate.videos[1] = duplicate.videos[0]!;
    expect(() => parseStudioContentPage(duplicate, filters, null)).toThrow();
    const reversed = response(2);
    reversed.videos.reverse();
    expect(() => parseStudioContentPage(reversed, filters, null)).toThrow();
    const mismatch = response();
    mismatch.page.status = "PUBLISHED";
    expect(() =>
      parseStudioContentPage(mismatch, { ...filters, status: "PUBLISHED" }, null),
    ).toThrow();
    expect(() => parseStudioContentPage(response(), filters, "wrong")).toThrow();
    expect(() => parseStudioContentPage(response(), filters, null, actor)).toThrow();
  });
  it("requires a full returned page for a next cursor and rejects malformed records", () => {
    const short = response();
    short.nextCursor = "next";
    expect(() => parseStudioContentPage(short, filters, null)).toThrow();
    const wrong = response();
    wrong.videos[0]!.title = "x".repeat(201);
    expect(() => parseStudioContentPage(wrong, filters, null)).toThrow();
    const next = response(25);
    next.nextCursor = "next";
    expect(parseStudioContentPage(next, filters, null).nextCursor).toBe("next");
  });
  it("preserves editor metadata through a bounded projection and rejects malformed metadata", () => {
    const advanced = {
      contentType: "DOCUMENTARY",
      tags: ["travel"],
      category: "EDUCATION",
      primaryLanguage: "ar",
      recordingDate: "2026-09-01",
      seriesTitle: "Around the world",
      seasonNumber: 2,
      episodeNumber: 5,
      maturityLevel: "TEEN",
      ageRestriction: "AGE_13_PLUS",
      allowedTerritories: ["GB"],
      blockedTerritories: [],
      rightsExpiresAt: "2027-01-01T00:00:00.000Z",
      geoAvailabilityMode: "INCLUDE_ONLY",
      geoCountries: ["GB"],
      chapters: [{ title: "Opening", startSeconds: 0 }],
      adBreakPreference: "CUSTOM",
      adBreakOffsetsSeconds: [60],
      rightsBasis: "LICENSED",
      rightsNote: "A saved creator note",
    };
    const result = response();
    const value = {
      ...result,
      videos: [
        {
          ...result.videos[0],
          metadata: { ...advanced, unexpectedPrivateData: "must not escape" },
        },
      ],
    };
    expect(parseStudioContentPage(value, filters, null).videos[0]!.metadata).toEqual(advanced);
    for (const patch of [
      { chapters: [{ title: "Bad", startSeconds: -1 }] },
      { tags: Array(21).fill("x") },
      { category: "UNKNOWN" },
      { allowedTerritories: ["arbitrary"] },
    ]) {
      expect(() =>
        parseStudioContentPage(
          { ...value, videos: [{ ...value.videos[0], metadata: { ...advanced, ...patch } }] },
          filters,
          null,
        ),
      ).toThrow();
    }
  });
  it("keeps only a bounded cursor window while allowing further pages and first-page reset", () => {
    let location = firstStudioContentPage(filters);
    for (let n = 1; n <= 150; n++) location = nextStudioContentPage(location, `page${n}`);
    expect(location.page).toBe(151);
    expect(location.cursors).toHaveLength(STUDIO_CONTENT_HISTORY_LIMIT);
    expect(previousStudioContentPage(location).page).toBe(150);
    expect(previousStudioContentPage(location).cursors.at(-1)).toBe("page149");
    let earliest = location;
    while (earliest.cursors.length > 1) earliest = previousStudioContentPage(earliest);
    expect(earliest.page).toBe(52);
    expect(previousStudioContentPage(earliest)).toBe(earliest);
    expect(nextStudioContentPage(earliest, "new-next").page).toBe(53);
    expect(firstStudioContentPage(location.filters)).toEqual({ filters, page: 1, cursors: [null] });
  });
  it("encodes search spaces as %20 and uses before/after account verification", async () => {
    const search = { ...filters, query: "film night & أنا" };
    const result = response();
    result.page = { ...result.page, ...search };
    const fetcher = vi
      .fn()
      .mockImplementationOnce(identity)
      .mockResolvedValueOnce(Response.json(result))
      .mockImplementationOnce(identity);
    vi.stubGlobal("fetch", fetcher);
    await readStudioContentPage(search, null, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]![0]).toContain("query=film%20night%20%26%20%D8%A3%D9%86%D8%A7");
    expect(fetcher.mock.calls[1]![1].headers["x-ayin-expected-account"]).toBe(actor);
  });
  it.each(["Film*", "Film+night", "Film~!()'&/?#=:%. -_"])(
    "preserves literal query punctuation through the scoped request: %s",
    async (query) => {
      const search = { ...filters, query };
      const value = response();
      value.page = { ...value.page, query };
      const fetcher = vi
        .fn()
        .mockImplementationOnce(identity)
        .mockResolvedValueOnce(Response.json(value))
        .mockImplementationOnce(identity);
      vi.stubGlobal("fetch", fetcher);
      await readStudioContentPage(search, null, new AbortController().signal);
      expect(fetcher).toHaveBeenCalledTimes(3);
      const requestUrl = fetcher.mock.calls[1]![0] as string;
      expect(requestUrl).not.toContain("*");
      expect(requestUrl).not.toContain("+");
      expect(new URL(requestUrl).searchParams.get("query")).toBe(query);
      if (query.includes("*")) expect(requestUrl).toContain("%2A");
    },
  );
  it("rejects changed accounts before or after reading and mismatched response actors", async () => {
    for (const mode of ["before", "after", "response"]) {
      const result = response();
      if (mode === "response") result.actorAccountId = channel;
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ account: { id: mode === "before" ? channel : actor } }),
        )
        .mockResolvedValueOnce(Response.json(result))
        .mockResolvedValueOnce(
          Response.json({ account: { id: mode === "after" ? channel : actor } }),
        );
      vi.stubGlobal("fetch", fetcher);
      await expect(
        readStudioContentPage(filters, null, new AbortController().signal, {
          accountId: actor,
          channelId: channel,
        }),
      ).rejects.toThrow();
      if (mode === "before") expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("does not accept an aborted response even if the transport ignores cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(identity)
      .mockImplementationOnce(() => {
        controller.abort();
        return Response.json(response());
      });
    vi.stubGlobal("fetch", fetcher);
    await expect(readStudioContentPage(filters, null, controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
