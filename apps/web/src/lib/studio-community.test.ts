import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseStudioCommunityPage,
  parseStudioCommunityPost,
  uploadStudioCommunityImage,
} from "./studio-community";
import { studioCommunityAr, studioCommunityEn } from "./i18n/resources/studio-community";
const id = "00000000-0000-4000-8000-000000000001";
const post = {
  id,
  type: "TEXT",
  status: "DRAFT",
  body: "مسودة",
  scheduledPublishAt: null,
  publishedAt: null,
  imageAsset: null,
  sharedVideo: null,
  pollOptions: [],
};
afterEach(() => vi.unstubAllGlobals());
describe("Studio community response boundary", () => {
  it("maps only presentation fields and preserves a bounded advancing cursor", () => {
    const result = parseStudioCommunityPage({
      items: [{ ...post, accountId: "private" }],
      nextCursor: id,
    });
    expect(result.items[0]?.body).toBe("مسودة");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.nextCursor).toBe(id);
  });
  it("rejects duplicate, excessive, malformed and nonadvancing pages", () => {
    for (const value of [
      null,
      {},
      { items: [post, post], nextCursor: null },
      { items: Array(51).fill(post), nextCursor: null },
      { items: [], nextCursor: id },
      { items: [post], nextCursor: "wrong" },
    ])
      expect(() => parseStudioCommunityPage(value)).toThrow();
    expect(() => parseStudioCommunityPage({ items: [post], nextCursor: id }, id)).toThrow();
  });
  it("fails closed on invalid posts, dates, options and statuses", () => {
    for (const value of [
      { ...post, status: "REMOVED" },
      { ...post, id: "wrong" },
      { ...post, body: "x".repeat(5001) },
      { ...post, scheduledPublishAt: "invalid" },
      {
        ...post,
        pollOptions: [
          { id, label: "A" },
          { id, label: "B" },
        ],
      },
    ])
      expect(() => parseStudioCommunityPost(value)).toThrow();
  });
  it("does not send upload bytes to an insecure or credential-bearing authorization URL", async () => {
    for (const url of [
      "http://example.test/upload",
      "https://user:secret@example.test/upload",
      "http://localhost:9999/upload",
    ]) {
      const fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ assetId: id, upload: { url, method: "PUT", headers: {} } }),
          ),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        uploadStudioCommunityImage(
          id,
          new File(["x"], "x.png", { type: "image/png" }),
          { width: 1, height: 1 },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("requires an exact validated image acknowledgement and omits cookies from storage PUT", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            assetId: id,
            upload: { url: "https://storage.example.test/file", method: "PUT", headers: {} },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assetId: id, status: "PENDING" })));
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadStudioCommunityImage(
        id,
        new File(["x"], "x.png", { type: "image/png" }),
        { width: 1, height: 1 },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Invalid image acknowledgment");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ credentials: "omit", method: "PUT" });
  });
  it("provides matching Arabic and English recovery and confirmation keys", () => {
    expect(Object.keys(studioCommunityAr).sort()).toEqual(Object.keys(studioCommunityEn).sort());
    expect(Object.values(studioCommunityAr).every(Boolean)).toBe(true);
  });
});
