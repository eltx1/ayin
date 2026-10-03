import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeChannelImage,
  ChannelEditorRequestError,
  channelEditorInput,
  getChannelEditorSnapshot,
  parseEditableChannel,
  saveChannelEditor,
  validateChannelImage,
} from "./channel-editor";
const channelId = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222";
const snapshot = () => ({
  channel: { id: channelId, name: "Ayin", handle: "ayin", description: null, status: "ACTIVE" },
  appearance: { avatar: null, banner: null, accentColor: null },
  settings: null,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("owned channel editor recovery contract", () => {
  it("allows genuine missing settings and strips operator fields", () => {
    expect(parseEditableChannel({ ...snapshot(), secret: "private" }, channelId)).toEqual(
      snapshot(),
    );
  });
  it("rejects a wrong owner and unavailable fields rather than fabricating defaults", () => {
    expect(() => parseEditableChannel(snapshot(), assetId)).toThrow();
    expect(() => parseEditableChannel({ ...snapshot(), settings: {} }, channelId)).toThrow();
    expect(() =>
      parseEditableChannel(
        { ...snapshot(), channel: { ...snapshot().channel, status: "unknown" } },
        channelId,
      ),
    ).toThrow();
  });
  it("requires actual same-channel image paths and MIME", () => {
    const row = snapshot();
    const asset = {
      assetId,
      objectKey: `channels/${channelId}/channel-assets/${assetId}/avatar.png`,
      mimeType: "image/png",
    };
    expect(
      parseEditableChannel({ ...row, appearance: { ...row.appearance, avatar: asset } }, channelId)
        .appearance.avatar,
    ).toEqual(asset);
    for (const invalid of [
      { ...asset, objectKey: "../secret" },
      { ...asset, mimeType: "text/html" },
      { ...asset, objectKey: asset.objectKey.replace(channelId, assetId) },
    ])
      expect(() =>
        parseEditableChannel(
          { ...row, appearance: { ...row.appearance, avatar: invalid } },
          channelId,
        ),
      ).toThrow();
  });
  it("normalizes Unicode identity to the server contract and rejects invalid input", () => {
    expect(channelEditorInput(" AYIN   قناة ", " Ａyin ", " ", "#abcdef")).toEqual({
      name: "AYIN قناة",
      handle: "ayin",
      description: null,
      accentColor: "#ABCDEF",
    });
    for (const handle of [".bad", "bad-", "a b", "a/secret", "a".repeat(81)])
      expect(() => channelEditorInput("A", handle, "", "#abcdef")).toThrow();
  });
  it("validates image size and MIME before authorization", () => {
    expect(() =>
      validateChannelImage("avatar", new File(["x"], "x.svg", { type: "image/svg+xml" })),
    ).toThrow();
    expect(() =>
      validateChannelImage("avatar", new File([], "x.png", { type: "image/png" })),
    ).toThrow();
    expect(() =>
      validateChannelImage("avatar", { type: "image/png", size: 5 * 1024 * 1024 + 1 } as File),
    ).toThrow();
    expect(() =>
      validateChannelImage("banner", { type: "image/png", size: 10 * 1024 * 1024 } as File),
    ).not.toThrow();
  });
  it("reads actual account-selected channel with no-store and caller abort", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ channel: { id: channelId } }))
      .mockResolvedValueOnce(Response.json(snapshot()));
    vi.stubGlobal("fetch", fetch);
    expect(await getChannelEditorSnapshot(new AbortController().signal)).toEqual(snapshot());
    expect(fetch.mock.calls[1]?.[0]).toContain(`/creator/channels/${channelId}`);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it("retains denial status and does not replay malformed mutation replies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        Response.json({ ...snapshot(), channel: { ...snapshot().channel, id: assetId } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(getChannelEditorSnapshot(new AbortController().signal)).rejects.toBeInstanceOf(
      ChannelEditorRequestError,
    );
    await expect(
      saveChannelEditor(
        channelId,
        channelEditorInput("A", "ayin", "", "#123456"),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("expires reads after fifteen seconds with no retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = getChannelEditorSnapshot(new AbortController().signal);
    const result = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects unsafe upload destinations before sending the file", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          assetId,
          kind: "avatar",
          upload: {
            method: "PUT",
            url: "http://external.invalid/upload",
            headers: { "content-type": "image/png" },
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const authorized = vi.fn();
    await expect(
      changeChannelImage(
        channelId,
        "avatar",
        new File(["x"], "x.png", { type: "image/png" }),
        new AbortController().signal,
        authorized,
      ),
    ).rejects.toThrow();
    expect(authorized).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains the known asset, uses a bounded credential-free PUT and verifies completion correlation", async () => {
    const file = new File(["x"], "x.png", { type: "image/png" });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          assetId,
          kind: "avatar",
          upload: {
            method: "PUT",
            url: "https://storage.example/image",
            headers: { "content-type": "image/png" },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          appearance: {
            accentColor: null,
            banner: null,
            avatar: {
              assetId,
              objectKey: `channels/${channelId}/channel-assets/${assetId}/avatar.png`,
              mimeType: "image/png",
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const sent: unknown[] = [];
    class Xhr {
      status = 200;
      timeout = 0;
      withCredentials = true;
      onload = () => {};
      onerror = () => {};
      ontimeout = () => {};
      onabort = () => {};
      open = vi.fn();
      setRequestHeader = vi.fn();
      abort() {
        this.onabort();
      }
      send(body: unknown) {
        sent.push({ body, timeout: this.timeout, credentials: this.withCredentials });
        this.onload();
      }
    }
    vi.stubGlobal("XMLHttpRequest", Xhr);
    const authorized = vi.fn();
    expect(
      (
        await changeChannelImage(
          channelId,
          "avatar",
          file,
          new AbortController().signal,
          authorized,
        )
      ).avatar?.assetId,
    ).toBe(assetId);
    expect(authorized).toHaveBeenCalledWith(assetId);
    expect(sent).toEqual([{ body: file, timeout: 120000, credentials: false }]);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ assetId }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
