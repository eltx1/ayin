import { describe, expect, it } from "vitest";
import { parseViewerCommentAck, parseViewerCommentPage } from "./viewer-comments";
import { viewerCommentsAr, viewerCommentsEn } from "./i18n/resources/viewer-comments";
const id = "00000000-0000-4000-8000-000000000201";
const item = {
  id,
  body: "A real comment",
  createdAt: "2026-10-03T00:00:00Z",
  authorProfile: { name: "محمد", slug: "mohamed" },
  likeCount: 2,
  replies: [],
};
const page = { enabled: true, items: [item], nextCursor: 30 };
describe("Viewer comments response boundary", () => {
  it("preserves public display data and advancing pagination without retaining private fields", () => {
    const result = parseViewerCommentPage({
      ...page,
      items: [{ ...item, authorProfileId: "private", accountId: "private" }],
    });
    expect(result.items[0]?.authorProfile.name).toBe("محمد");
    expect(result.nextCursor).toBe(30);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("rejects malformed pages, counts and nonadvancing pagination", () => {
    for (const value of [
      null,
      {},
      { ...page, items: null },
      { ...page, nextCursor: 0 },
      { ...page, nextCursor: 1.5 },
      { ...page, items: [{ ...item, likeCount: -1 }] },
      { ...page, items: [{ ...item, createdAt: "invalid" }] },
    ])
      expect(() => parseViewerCommentPage(value)).toThrow();
    expect(() => parseViewerCommentPage(page, 30)).toThrow();
  });
  it("enforces server bounds and one-level replies instead of unbounded recursive input", () => {
    expect(() => parseViewerCommentPage({ ...page, items: Array(51).fill(item) })).toThrow();
    expect(() =>
      parseViewerCommentPage({ ...page, items: [{ ...item, replies: Array(21).fill(item) }] }),
    ).toThrow();
    const reply = { ...item, id: "00000000-0000-4000-8000-000000000202", replies: [item] };
    expect(() =>
      parseViewerCommentPage({ ...page, items: [{ ...item, replies: [reply] }] }),
    ).toThrow();
    expect(() => parseViewerCommentPage({ ...page, items: [item, item] })).toThrow();
    expect(() => parseViewerCommentPage({ ...page, enabled: false })).toThrow();
  });
  it("requires a valid root-comment acknowledgement before clearing a draft", () => {
    expect(
      parseViewerCommentAck({ id, body: "Confirmed", parentId: null, createdAt: item.createdAt })
        .body,
    ).toBe("Confirmed");
    expect(() =>
      parseViewerCommentAck({ id, body: "Confirmed", parentId: id, createdAt: item.createdAt }),
    ).toThrow();
    expect(() =>
      parseViewerCommentAck({
        id: "wrong",
        body: "Confirmed",
        parentId: null,
        createdAt: item.createdAt,
      }),
    ).toThrow();
  });
  it("keeps EN/AR vocabulary complete", () => {
    expect(Object.keys(viewerCommentsAr).sort()).toEqual(Object.keys(viewerCommentsEn).sort());
  });
});
