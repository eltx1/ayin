import { describe, expect, it } from "vitest";
import { readBoundedAccountJson, requestAccountScope } from "./account-scope";
const signal = () => new AbortController().signal;
describe("bounded private JSON success body reader", () => {
  it("retains actual JSON across split UTF8 bytes", async () => {
    const bytes = new TextEncoder().encode('{"name":"أبي"}');
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
    );
    expect(await readBoundedAccountJson(response, signal(), 128)).toEqual({ name: "أبي" });
  });
  it("cancels an oversized declared body before consuming chunks", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-length": "129" } },
    );
    await expect(readBoundedAccountJson(response, signal(), 128)).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
    expect(cancelled).toBe(true);
  });
  it("bounds actual bytes even when the declared length is missing or falsely small", async () => {
    for (const headers of [{}, { "content-length": "1" }]) {
      const response = new Response('"' + "أ".repeat(70) + '"', { headers });
      await expect(readBoundedAccountJson(response, signal(), 128)).rejects.toMatchObject({
        code: "RESPONSE_TOO_LARGE",
      });
    }
  });
  it("rejects malformed UTF8 and malformed JSON", async () => {
    for (const body of [Uint8Array.of(255), new TextEncoder().encode("{broken")])
      await expect(readBoundedAccountJson(new Response(body), signal(), 128)).rejects.toThrow();
  });
  it("parent abort cancels a stalled body and returns no partial facts", async () => {
    let cancelled = false;
    const controller = new AbortController();
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    );
    const pending = readBoundedAccountJson(response, controller.signal, 128);
    const rejection = expect(pending).rejects.toThrow();
    controller.abort();
    await rejection;
    expect(cancelled).toBe(true);
  });
  it("rejects invalid limits before reading or making scoped requests", async () => {
    for (const maxResponseBytes of [0, 127, NaN, Infinity, 10 * 1024 * 1024 + 1]) {
      await expect(
        readBoundedAccountJson(new Response("{}"), signal(), maxResponseBytes),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(
        requestAccountScope("/privacy/export", "GET", (value) => value, { maxResponseBytes }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
  });
});
