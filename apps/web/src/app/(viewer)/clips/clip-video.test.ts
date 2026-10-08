import { describe, expect, it, vi } from "vitest";

import { clipPlayerCopy } from "./clip-player-copy";
import { createClipPlaybackIntent, sameOriginCaptionTracks } from "./clip-video";

function harness({ delayedStart = false } = {}) {
  const policy = { current: true, autoplay: true, panelOpen: false };
  const requests: { resolve: () => void; reject: () => void }[] = [];
  const blocked = vi.fn();
  const changed = vi.fn();
  const video = {
    paused: true,
    ended: false,
    play: vi.fn(() => {
      if (!delayedStart) video.paused = false;
      return new Promise<void>((resolve, reject) =>
        requests.push({ resolve, reject: () => reject(new Error("blocked")) }),
      );
    }),
    pause: vi.fn(() => {
      video.paused = true;
      queueMicrotask(() => intent.observePause());
    }),
  };
  const intent = createClipPlaybackIntent(video, () => policy, changed, blocked);
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  return { video, policy, intent, requests, blocked, changed, flush };
}

describe("ClipVideo single-element playback intent", () => {
  it("starts only after initial policy allows autoplay and does not duplicate pending requests", () => {
    const run = harness();
    run.policy.autoplay = false;
    run.intent.sync();
    expect(run.video.play).not.toHaveBeenCalled();
    run.policy.autoplay = true;
    run.intent.sync();
    run.intent.sync();
    expect(run.video.play).toHaveBeenCalledTimes(1);
    expect(run.intent.pending()).toBe(true);
    expect(run.intent.observePlay(false)).toBe(true);
  });

  it("keeps an authored deliberate pause until explicit Play", async () => {
    const run = harness();
    run.intent.sync();
    run.requests[0]!.resolve();
    await run.flush();
    run.intent.pause();
    await run.flush();
    run.intent.sync();
    expect(run.video.play).toHaveBeenCalledTimes(1);
    run.intent.play(true);
    expect(run.video.play).toHaveBeenCalledTimes(2);
  });

  it("keeps a native deliberate pause when policy or metadata changes", async () => {
    const run = harness();
    run.intent.sync();
    run.requests[0]!.resolve();
    await run.flush();
    run.video.paused = true;
    run.intent.observePause();
    run.policy.autoplay = false;
    run.intent.sync();
    run.policy.autoplay = true;
    run.intent.sync();
    expect(run.video.play).toHaveBeenCalledTimes(1);
  });

  it("pauses for a panel and resumes only a previously playing Clip", async () => {
    const run = harness();
    run.intent.sync();
    run.policy.panelOpen = true;
    run.intent.sync();
    run.requests[0]!.resolve();
    await run.flush();
    expect(run.video.paused).toBe(true);
    run.policy.panelOpen = false;
    run.intent.sync();
    expect(run.video.play).toHaveBeenCalledTimes(2);
    expect(run.video.paused).toBe(false);
  });

  it("defers initial autoplay when a dialog is already open before the first playback", () => {
    const run = harness();
    run.policy.panelOpen = true;
    run.policy.current = false;
    run.intent.sync();
    expect(run.video.play).not.toHaveBeenCalled();
    run.policy.panelOpen = false;
    run.intent.sync();
    run.policy.current = true;
    run.intent.sync();
    expect(run.video.play).toHaveBeenCalledTimes(1);
  });

  it("stops even manual playback while the active stage is not visible", async () => {
    const run = harness();
    run.policy.autoplay = false;
    run.intent.play(true);
    run.policy.current = false;
    run.intent.sync();
    await run.flush();
    expect(run.video.paused).toBe(true);
    run.intent.play(true);
    expect(run.video.play).toHaveBeenCalledTimes(1);
  });

  it("never resumes an already paused Clip when a panel closes", () => {
    const run = harness();
    run.intent.pause();
    run.policy.panelOpen = true;
    run.intent.sync();
    run.policy.panelOpen = false;
    run.intent.sync();
    expect(run.video.play).not.toHaveBeenCalled();
  });

  it("a pending start before panel opening is not proof of playing", async () => {
    const run = harness({ delayedStart: true });
    run.intent.sync();
    run.policy.panelOpen = true;
    run.intent.sync();
    run.policy.panelOpen = false;
    run.intent.sync();
    run.video.paused = false;
    expect(run.intent.observePlay(false)).toBe(false);
    run.requests[0]!.resolve();
    await run.flush();
    expect(run.video.paused).toBe(true);
    expect(run.video.play).toHaveBeenCalledTimes(1);
  });

  it.each(["autoplay", "current"] as const)(
    "does not resume after a panel when %s is revoked",
    async (key) => {
      const run = harness();
      run.intent.sync();
      run.policy.panelOpen = true;
      run.intent.sync();
      await run.flush();
      run.policy.panelOpen = false;
      run.policy[key] = false;
      run.intent.sync();
      expect(run.video.paused).toBe(true);
      expect(run.video.play).toHaveBeenCalledTimes(1);
    },
  );

  it("turns a rejected autoplay into usable explicit Play, even with autoplay disabled", async () => {
    const run = harness();
    run.intent.sync();
    run.requests[0]!.reject();
    await run.flush();
    expect(run.intent.pending()).toBe(false);
    expect(run.blocked).toHaveBeenCalledTimes(1);
    run.intent.sync();
    expect(run.video.play).toHaveBeenCalledTimes(1);
    run.policy.autoplay = false;
    run.intent.play(true);
    expect(run.video.play).toHaveBeenCalledTimes(2);
    expect(run.intent.observePlay(false)).toBe(true);
  });

  it("revokes permission without changing the owner boundary's synchronous snapshot", async () => {
    const run = harness();
    run.intent.sync();
    run.policy.current = false;
    run.intent.revokeLease();
    expect(run.video.paused).toBe(false);
    expect(run.video.pause).not.toHaveBeenCalled();
    run.intent.dispose();
    run.requests[0]!.resolve();
    await run.flush();
    expect(run.video.paused).toBe(true);
  });

  it("fences a late play promise and native event after audience retirement", async () => {
    const run = harness({ delayedStart: true });
    run.intent.sync();
    run.policy.current = false;
    run.intent.dispose();
    run.video.paused = false;
    expect(run.intent.observePlay(true)).toBe(false);
    run.requests[0]!.resolve();
    await run.flush();
    expect(run.video.paused).toBe(true);
    expect(run.blocked).not.toHaveBeenCalled();
  });

  it("does not let an older promise pause a newer valid intent on the same element", async () => {
    const run = harness();
    run.intent.sync();
    run.intent.pause();
    await run.flush();
    run.intent.play(true);
    run.requests[0]!.resolve();
    await run.flush();
    expect(run.video.paused).toBe(false);
    expect(run.intent.pending()).toBe(true);
    run.requests[1]!.resolve();
    await run.flush();
    expect(run.intent.pending()).toBe(false);
  });

  it("honors dynamic automatic-play restrictions while preserving explicit play", async () => {
    const run = harness();
    run.intent.sync();
    run.policy.autoplay = false;
    run.intent.sync();
    await run.flush();
    expect(run.video.paused).toBe(true);
    run.intent.play(true);
    run.intent.sync();
    expect(run.video.paused).toBe(false);
  });

  it("allows platform-native Play but blocks unowned authored-mode events after pause", () => {
    const run = harness();
    run.intent.pause();
    run.policy.autoplay = false;
    run.video.paused = false;
    expect(run.intent.observePlay(false)).toBe(false);
    run.video.paused = false;
    expect(run.intent.observePlay(true)).toBe(true);
  });

  it("allows cadence checkpoints only for owned playing media, never untouched, paused, offscreen, or retired", async () => {
    const run = harness();
    const persist = vi.fn();
    const timeupdate = () => {
      if (run.intent.ownsPlayback()) persist(false);
    };
    timeupdate();
    expect(persist).not.toHaveBeenCalled();
    run.intent.sync();
    run.requests[0]!.resolve();
    await run.flush();
    timeupdate();
    expect(persist).toHaveBeenCalledExactlyOnceWith(false);
    run.policy.current = false;
    timeupdate();
    run.policy.current = true;
    run.intent.pause();
    await run.flush();
    timeupdate();
    run.intent.play(true);
    run.intent.revokeLease();
    timeupdate();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("cannot explicitly play behind a panel or without the audience/visibility lease", () => {
    const run = harness();
    run.policy.current = false;
    run.intent.play(true);
    run.policy.current = true;
    run.policy.panelOpen = true;
    run.intent.play(true);
    expect(run.video.play).not.toHaveBeenCalled();
  });
});

describe("Clip player local copy", () => {
  it("has complete English and Arabic control and recovery labels", () => {
    const english = clipPlayerCopy("en");
    const arabic = clipPlayerCopy("ar");
    expect(Object.keys(arabic)).toEqual(Object.keys(english));
    for (const value of Object.values(arabic)) expect(value).toMatch(/[\u0600-\u06ff]/);
  });
});

describe("Clip caption transport", () => {
  it("attaches only actual same-origin HTTP tracks without changing MP4 CORS", () => {
    const sources = [
      "https://ayin.stream/captions/one.vtt",
      "/captions/two.vtt",
      "https://media.ayin.stream/three.vtt",
      "data:text/vtt,WEBVTT",
      "https://ayin.stream.evil.example/four.vtt",
    ];
    const tracks = sources.map((src, index) => ({
      id: String(index),
      src,
      label: "English",
      language: "en",
      kind: "CAPTIONS" as const,
    }));
    expect(sameOriginCaptionTracks(tracks, "https://ayin.stream").map((track) => track.id)).toEqual(
      ["0", "1"],
    );
    expect(sameOriginCaptionTracks(tracks, "")).toEqual([]);
  });
});
