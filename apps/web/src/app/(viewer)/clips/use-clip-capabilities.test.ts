import { afterEach, describe, expect, it, vi } from "vitest";

import type { AyinIdentity } from "@/lib/api";
import { readClipCapabilities } from "./use-clip-capabilities";

vi.mock("@/lib/channel", () => ({
  mediaAssetUrl: (key: string) => `https://media.example.invalid/${key}`,
}));

const id = "10000000-0000-4000-8000-000000000001";
const captionId = "20000000-0000-4000-8000-000000000001";
const identity = {
  account: { id: "30000000-0000-4000-8000-000000000001" },
  profile: { id: "40000000-0000-4000-8000-000000000001" },
} as AyinIdentity;
const target = {
  id,
  slug: "eligible-clip",
  sourceObjectKey: "channels/creator/clip.mp4",
  locale: "ar" as const,
  expectedKids: false,
};
const audience = { identity, isCurrent: () => true };
const caption = {
  id: captionId,
  objectKey: "captions/clip/ar.vtt",
  mimeType: "text/vtt",
  label: "العربية",
  language: "ar",
  kind: "SUBTITLES",
  default: true,
};
function playback() {
  return {
    viewer: { isKids: false },
    video: {
      id,
      slug: target.slug,
      title: "Eligible Clip",
      source: { objectKey: target.sourceObjectKey, mimeType: "video/mp4" },
      channel: { name: "Creator", handle: "creator" },
      adaptiveSource: null,
      captions: [caption],
      chapters: [],
    },
    detail: { contentType: "CREATOR_VIDEO", commentsSlot: { enabled: true }, related: [] },
    playerPolicy: { progressSaveIntervalMs: 15000, completionThresholdPercent: 90 },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selected Clip capability lease", () => {
  it("makes one scoped Watch read and exposes only real captions and comment availability", async () => {
    const fetch = vi.fn(async () => Response.json(playback()));
    vi.stubGlobal("fetch", fetch);
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).resolves.toEqual({
      captions: [
        {
          id: captionId,
          src: "https://media.example.invalid/captions/clip/ar.vtt",
          label: "العربية",
          language: "ar",
          kind: "SUBTITLES",
          default: true,
        },
      ],
      commentsEnabled: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/public/videos/eligible-clip/playback");
    expect(new URL(url).searchParams.get("locale")).toBe("ar");
    expect(new URL(url).searchParams.get("expectedProfileId")).toBe(identity.profile.id);
    expect(init).toMatchObject({
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { "x-ayin-expected-account": identity.account.id },
    });
  });

  it("keeps native tracks and language options bounded without silently truncating", async () => {
    const body = playback();
    body.video.captions = Array.from({ length: 33 }, (_, index) => ({
      ...caption,
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0 });
  });

  it("revokes a valid same-video audience that became Kids before the read", async () => {
    const body = playback();
    body.viewer.isKids = true;
    body.detail.commentsSlot.enabled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 409, identityInvalid: true });
  });

  it("preserves verified Kids narrowing when the same video selects a newer source", async () => {
    const body = playback();
    body.viewer.isKids = true;
    body.detail.commentsSlot.enabled = false;
    body.video.source.objectKey = "playback/new-generation/fallback.mp4";
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 409, identityInvalid: true });
  });

  it("does not read before a current audience lease or for an invalid feed target", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      readClipCapabilities(
        target,
        { ...audience, isCurrent: () => false },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      readClipCapabilities({ ...target, id: "unverified" }, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["id", "slug", "source", "mime"])(
    "rejects the wrong selected-video contract: %s",
    async (mismatch) => {
      const body = playback();
      if (mismatch === "id") body.video.id = "10000000-0000-4000-8000-000000000002";
      if (mismatch === "slug") body.video.slug = "another-clip";
      if (mismatch === "source") body.video.source.objectKey = "new-generation.mp4";
      if (mismatch === "mime") body.video.source.mimeType = "text/html";
      vi.stubGlobal("fetch", async () => Response.json(body));
      await expect(
        readClipCapabilities(target, audience, new AbortController().signal),
      ).rejects.toMatchObject({ identityInvalid: false });
    },
  );

  it.each([
    [401, "UNAUTHORIZED", true],
    [409, "ACCOUNT_CHANGED", true],
    [409, "PLAYBACK_VIEWER_CHANGED", true],
    [409, "VIDEO_NOT_PLAYABLE", false],
    [500, "ACCOUNT_CHANGED", false],
  ])(
    "preserves server identity classification through capability reads: %s/%s",
    async (status, code, identityInvalid) => {
      vi.stubGlobal("fetch", async () =>
        Response.json({ error: { code } }, { status: Number(status) }),
      );
      await expect(
        readClipCapabilities(target, audience, new AbortController().signal),
      ).rejects.toMatchObject({ status, identityInvalid });
    },
  );

  it("permits Kids captions only after explicit Kids verification, with comments disabled", async () => {
    const body = playback();
    body.viewer.isKids = true;
    body.detail.commentsSlot.enabled = false;
    const fetch = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const capabilities = await readClipCapabilities(
      { ...target, expectedKids: true },
      audience,
      new AbortController().signal,
    );
    expect(capabilities.captions).toHaveLength(1);
    expect(capabilities.commentsEnabled).toBe(false);
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get("kids")).toBe("1");
    body.detail.commentsSlot.enabled = true;
    await expect(
      readClipCapabilities(
        { ...target, expectedKids: true },
        audience,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    { mimeType: "text/html" },
    { id: "not-a-track-id" },
    { objectKey: "captions/../unrelated.vtt" },
    { objectKey: "captions\\unrelated.vtt" },
    { language: "invalid language" },
    { default: "yes" },
    { label: "x".repeat(81) },
    { kind: "UNKNOWN" },
  ])("rejects malformed tracks rather than presenting a false capability: %j", async (change) => {
    const body = playback();
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...body, video: { ...body.video, captions: [{ ...caption, ...change }] } }),
    );
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0 });
  });

  it("rejects duplicated track IDs and accepts a genuinely empty caption list", async () => {
    const body = playback();
    body.video.captions = [caption, caption];
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0 });
    body.video.captions = [];
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).resolves.toEqual({ captions: [], commentsEnabled: true });
  });

  it.each(["selection", "audience"])(
    "rejects a late response after %s revocation even when fetch ignores abort",
    async (reason) => {
      let finish!: (response: Response) => void;
      let current = true;
      vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (finish = resolve)));
      const controller = new AbortController();
      const read = readClipCapabilities(
        target,
        { ...audience, isCurrent: () => current },
        controller.signal,
      );
      if (reason === "selection") controller.abort();
      else current = false;
      finish(Response.json(playback()));
      await expect(read).rejects.toBeInstanceOf(Error);
    },
  );

  it.each([200, 409])(
    "keeps the 15-second deadline active while a %s response body stalls",
    async (status) => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      vi.stubGlobal(
        "fetch",
        async () => new Response(new ReadableStream<Uint8Array>({ cancel }), { status }),
      );
      const read = readClipCapabilities(target, audience, new AbortController().signal);
      const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("bounds the detail body before exposing any captions", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...playback(), oversized: "x".repeat(513 * 1024) }),
    );
    await expect(
      readClipCapabilities(target, audience, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});
