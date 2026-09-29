import { afterEach, describe, expect, it, vi } from "vitest";
import { createCreatorPlaylist, listCreatorPlaylists } from "./playlist";

afterEach(() => vi.unstubAllGlobals());
describe("playlist request boundaries", () => {
  it("preserves private network-only reads and forwards cancellation to the request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ playlists: [] })));
    vi.stubGlobal("fetch", fetcher);
    expect(await listCreatorPlaylists("owned-channel", controller.signal)).toEqual([]);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/creator/channels/owned-channel/playlists"),
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      }),
    );
  });
  it("never retries a rejected creation or invents missing capability/count fields", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Connection interrupted"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createCreatorPlaylist("owned-channel", { name: "Draft", visibility: "PRIVATE" }),
    ).rejects.toThrow("Connection interrupted");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const actual = {
      playlist: {
        id: "id",
        channelId: "owned-channel",
        name: "Draft",
        slug: "draft",
        description: null,
        systemKey: null,
        visibility: "PRIVATE",
        isProtected: false,
      },
    };
    fetcher.mockResolvedValue(new Response(JSON.stringify(actual)));
    const result = await createCreatorPlaylist("owned-channel", {
      name: "Draft",
      visibility: "PRIVATE",
    });
    expect(result).toEqual(actual);
    expect(result.playlist).not.toHaveProperty("itemCount");
    expect(result.playlist).not.toHaveProperty("capabilities");
  });
});
