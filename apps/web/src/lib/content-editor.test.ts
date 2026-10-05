import { afterEach, describe, expect, it, vi } from "vitest";
import { contentDraft, contentPayload } from "./content-editor";
import {
  getStudioContent,
  updateStudioVideo,
  removeStudioVideo,
  unpublishStudioVideo,
  removeStudioCaption,
  type StudioVideo,
} from "./studio";
import { contentEditorEn, contentEditorAr } from "./i18n/resources/content-editor";
import { enMessages } from "./i18n/resources/en";
import { navigationEn } from "./i18n/resources/navigation";
import { playlistEn } from "./i18n/resources/playlists";
import { studioFeedbackEn } from "./i18n/resources/studio-feedback";

const video: StudioVideo = {
  id: "owned-id",
  title: "Original",
  description: null,
  status: "DRAFT",
  visibility: "PRIVATE",
  commentsEnabled: true,
  tvIncluded: false,
  metadata: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  publishedAt: null,
};
afterEach(() => vi.unstubAllGlobals());

describe("focused content editing boundaries", () => {
  it("creates independent editable drafts, preserves basic values and never sends rights fields", () => {
    const draft = contentDraft(video);
    draft.title = "  Updated  ";
    draft.metadata.tags = "one, two";
    draft.metadata.rightsBasis = "LICENSED";
    draft.metadata.rightsNote = "Must stay server owned";
    const payload = contentPayload(draft);
    expect(payload).toMatchObject({
      title: "Updated",
      visibility: "PRIVATE",
      tvIncluded: false,
      commentsEnabled: true,
      description: null,
      tags: ["one", "two"],
    });
    for (const key of ["rightsBasis", "rightsNote", "rightsExpiresAt", "videoId", "status"])
      expect(payload).not.toHaveProperty(key);
    expect(video.title).toBe("Original");
    expect(contentDraft(video).metadata.tags).toBe("");
  });
  it("rejects invalid titles before making a write and retains advanced chapter validation", () => {
    for (const title of ["", "  ", "a".repeat(201)])
      expect(() => contentPayload({ ...contentDraft(video), title })).toThrow("INVALID_TITLE");
    const draft = contentDraft(video);
    draft.metadata.chapters = "not-a-timestamp Chapter";
    expect(() => contentPayload(draft)).toThrow();
    expect(contentPayload(contentDraft(video))).toHaveProperty("chapters");
  });
  it("preserves uncached ownership requests and bounded server filters with cancellation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ channel: {}, videos: [] })));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await getStudioContent(
      { query: "title & العربية", status: "REMOVED", visibility: "PRIVATE" },
      signal,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    const parsed = new URL(url);
    expect(parsed.searchParams.get("query")).toBe("title & العربية");
    expect(parsed.searchParams.get("visibility")).toBe("PRIVATE");
    expect(parsed.searchParams.get("status")).toBe("REMOVED");
    expect(parsed.searchParams.has("take")).toBe(false);
    expect(init).toMatchObject({ credentials: "include", cache: "no-store", signal });
  });
  it("distinguishes malformed/unavailable snapshots and never retries a failed write", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ videos: null })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }),
      )
      .mockRejectedValueOnce(new TypeError("Network response lost"));
    vi.stubGlobal("fetch", fetcher);
    await expect(getStudioContent()).rejects.toThrow("Invalid content response");
    await expect(getStudioContent()).rejects.toThrow();
    await expect(updateStudioVideo(video.id, { title: "Changed" })).rejects.toThrow(
      "Network response lost",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]![1]).toMatchObject({
      method: "PATCH",
      body: '{"title":"Changed"}',
      cache: "no-store",
      credentials: "include",
    });
  });
  it.each([
    [
      "remove video",
      "DELETE",
      "/creator/studio/videos/owned-id",
      () => removeStudioVideo(video.id),
    ],
    [
      "unpublish",
      "POST",
      "/creator/studio/videos/owned-id/unpublish",
      () => unpublishStudioVideo(video.id),
    ],
    [
      "remove captions",
      "DELETE",
      "/creator/studio/videos/owned-id/captions/20000000-0000-4000-8000-000000000001",
      () => removeStudioCaption(video.id, "20000000-0000-4000-8000-000000000001"),
    ],
  ] as const)(
    "sends valid JSON without weakening request headers for %s",
    async (_name, method, pathname, execute) => {
      const captions = _name === "remove captions";
      const fetcher = captions
        ? vi
            .fn()
            .mockResolvedValueOnce(
              Response.json({ account: { id: "30000000-0000-4000-8000-000000000001" } }),
            )
            .mockResolvedValueOnce(
              Response.json({ removed: true, trackId: "20000000-0000-4000-8000-000000000001" }),
            )
            .mockResolvedValueOnce(
              Response.json({ account: { id: "30000000-0000-4000-8000-000000000001" } }),
            )
        : vi.fn().mockResolvedValue(new Response("{}"));
      vi.stubGlobal("fetch", fetcher);
      await execute();
      expect(fetcher).toHaveBeenCalledTimes(captions ? 3 : 1);
      const [url, init] = fetcher.mock.calls[captions ? 1 : 0]!;
      expect(new URL(url).pathname).toBe(pathname);
      expect(init).toMatchObject({ method, body: "{}", credentials: "include", cache: "no-store" });
      expect(new Headers(init.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual({});
    },
  );

  it("adds complete noncolliding EN/AR strings", () => {
    expect(Object.keys(contentEditorEn).sort()).toEqual(Object.keys(contentEditorAr).sort());
    const existing = { ...enMessages, ...navigationEn, ...playlistEn, ...studioFeedbackEn };
    for (const key of Object.keys(contentEditorEn)) expect(existing).not.toHaveProperty(key);
    for (const text of Object.values(contentEditorAr)) expect(text.trim()).not.toBe("");
  });
});
