import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLocalThumbnailChoices, releaseLocalThumbnailChoices } from "./local-thumbnail";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function harness(
  options: { stalled?: boolean; failSecondFrame?: boolean; portrait?: boolean } = {},
) {
  let seek = 0,
    object = 0;
  const video = {
    duration: 100,
    videoWidth: options.portrait ? 1000 : 1920,
    videoHeight: options.portrait ? 8000 : 1080,
    onloadedmetadata: null as null | (() => void),
    onerror: null as null | (() => void),
    onseeked: null as null | (() => void),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    set src(_value: string) {
      if (!options.stalled) queueMicrotask(() => this.onloadedmetadata?.());
    },
    set currentTime(_value: number) {
      seek++;
      queueMicrotask(() =>
        options.failSecondFrame && seek === 2 ? this.onerror?.() : this.onseeked?.(),
      );
    },
  };
  const canvases: Array<{ width: number; height: number }> = [];
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "video") return video;
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["frame"])),
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:frame-${++object}`);
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { video, canvases, revoke };
}
describe("local thumbnail resource bounds", () => {
  it("times out stalled metadata and releases the source URL/listeners", async () => {
    vi.useFakeTimers();
    const { video, revoke } = harness({ stalled: true });
    const operation = captureLocalThumbnailChoices(new File(["video"], "video.mp4"));
    await vi.runAllTimersAsync();
    expect(await operation).toEqual([]);
    expect(revoke).toHaveBeenCalledWith("blob:frame-1");
    expect(video.onloadedmetadata).toBeNull();
    expect(video.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("releases already captured previews when a later frame fails", async () => {
    const { revoke } = harness({ failSecondFrame: true });
    expect(await captureLocalThumbnailChoices(new File(["video"], "video.mp4"))).toEqual([]);
    expect(revoke.mock.calls.map((call) => call[0]).sort()).toEqual([
      "blob:frame-1",
      "blob:frame-2",
    ]);
  });
  it("releases produced previews when cancellation occurs before delivery", async () => {
    const { revoke } = harness();
    const controller = new AbortController();
    let object = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      object++;
      if (object === 2) controller.abort();
      return `blob:frame-${object}`;
    });
    expect(
      await captureLocalThumbnailChoices(new File(["video"], "video.mp4"), controller.signal),
    ).toEqual([]);
    expect(revoke.mock.calls.map((call) => call[0]).sort()).toEqual([
      "blob:frame-1",
      "blob:frame-2",
    ]);
  });
  it("bounds portrait canvas dimensions and keeps preview URLs until caller cleanup", async () => {
    const { canvases, revoke } = harness({ portrait: true });
    const choices = await captureLocalThumbnailChoices(new File(["video"], "video.mp4"));
    expect(choices).toHaveLength(3);
    expect(canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([
      [160, 1280],
      [160, 1280],
      [160, 1280],
    ]);
    expect(revoke.mock.calls.map((call) => call[0])).toEqual(["blob:frame-1"]);
    releaseLocalThumbnailChoices(choices);
    expect(revoke).toHaveBeenCalledTimes(4);
  });
});
