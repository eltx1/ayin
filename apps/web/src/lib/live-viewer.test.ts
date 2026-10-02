import { describe, expect, it } from "vitest";

import {
  liveStatusKey,
  liveWaitingKey,
  parseLiveChatPage,
  parseLiveViewerStream,
  terminalLiveStatus,
} from "./live-viewer";

const stream = {
  id: "00000000-0000-4000-8000-000000000074",
  title: "Live fixture",
  description: null,
  status: "LIVE",
  playbackUrl: "https://stream.example.test/live.m3u8",
  scheduledStartAt: null,
  chatEnabled: true,
  captions: [],
  dvrWindowSeconds: null,
  channel: {
    id: "00000000-0000-4000-8000-000000000075",
    handle: "live-fixture",
    name: "Live fixture channel",
  },
};

describe("Live Viewer contracts", () => {
  it("parses only bounded viewer-safe stream fields", () => {
    expect(
      parseLiveViewerStream({
        ...stream,
        providerStreamId: "must-be-ignored",
        ingestEndpoint: "rtmps://must-not-leak",
        createdByAccountId: "must-not-leak",
        adBreakHook: "must-not-leak",
      }),
    ).toEqual(stream);
    for (const invalid of [
      null,
      { ...stream, id: "invalid" },
      { ...stream, status: "PROVIDER_READY" },
      { ...stream, playbackUrl: "http://example.test/live.m3u8" },
      { ...stream, dvrWindowSeconds: -1 },
    ]) {
      expect(() => parseLiveViewerStream(invalid)).toThrow("INVALID_LIVE_RESPONSE");
    }
  });

  it("validates bounded public chat snapshots", () => {
    const message = {
      id: "00000000-0000-4000-8000-000000000090",
      body: "Hello live",
      createdAt: "2026-10-02T00:00:00.000Z",
    };
    expect(
      parseLiveChatPage({
        chatEnabled: true,
        messages: [{ ...message, authorProfileId: "ignored-internal-id" }],
      }),
    ).toEqual({ chatEnabled: true, messages: [message] });
    expect(() =>
      parseLiveChatPage({ chatEnabled: true, messages: [{ ...message, createdAt: "bad" }] }),
    ).toThrow("INVALID_LIVE_CHAT_RESPONSE");
    expect(() => parseLiveChatPage(null)).toThrow("INVALID_LIVE_CHAT_RESPONSE");
  });

  it("maps all viewer statuses without provider vocabulary", () => {
    expect(liveStatusKey("READY")).toBe("live.statusReady");
    expect(liveWaitingKey("READY")).toBe("live.waitReady");
    expect(terminalLiveStatus("ENDED")).toBe(true);
    expect(terminalLiveStatus("LIVE")).toBe(false);
  });
});
