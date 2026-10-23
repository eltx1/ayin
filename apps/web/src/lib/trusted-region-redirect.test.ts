import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ origin: "http://127.0.0.1:1" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api", () => ({
  get apiBaseUrl() {
    return state.origin;
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-ipcountry": "GB" }) }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "en" }));

import PublicChannelPage from "../app/(viewer)/c/[handle]/page";
import PublicPlaylistPage from "../app/(viewer)/c/[handle]/playlists/[slug]/page";
import { getPublicMovie } from "./movie-catalog";
import { fetchPublicDirectory } from "./public-directory";
import { getSeoVideo } from "./seo-content";
import { getPublicSeries } from "./series-catalog";
import { trustedApiRegionHeaders } from "./trusted-region";

const token = "controlled-redirect-test-token-more-than32";
const nativeFetch = globalThis.fetch;
let api: Server;
let destination: Server;
let apiReads = 0;
let destinationReads = 0;
let authenticatedApiReads = 0;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
}

beforeAll(async () => {
  destination = createServer((_request, response) => {
    destinationReads += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const destinationUrl = await listen(destination);
  api = createServer((request, response) => {
    apiReads += 1;
    if (
      request.headers["x-ayin-edge-token"] === token &&
      request.headers["x-ayin-edge-context"] === "server" &&
      request.headers["x-ayin-edge-country"] === "GB"
    )
      authenticatedApiReads += 1;
    response.writeHead(302, { location: destinationUrl + "/must-not-receive-context" });
    response.end();
  });
  state.origin = await listen(api);
});

beforeEach(() => {
  apiReads = 0;
  destinationReads = 0;
  authenticatedApiReads = 0;
  vi.stubEnv("AYIN_INTERNAL_EDGE_TOKEN", token);
  vi.stubEnv("AYIN_TRUST_CLOUDFLARE_REGION", "true");
  // Prevent an accidental test/configuration error from making any external request.
  vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) => {
    const target = url instanceof Request ? url.url : String(url);
    expect(new URL(target).origin).toBe(state.origin);
    return nativeFetch(url, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await Promise.all(
    [api, destination].filter(Boolean).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("server region bearer context cannot follow an API redirect", () => {
  const requests = [
    {
      name: "directory",
      read: async () =>
        fetchPublicDirectory("movies", "en", undefined, await trustedApiRegionHeaders()),
    },
    {
      name: "movie",
      read: async () => getPublicMovie("film", "en", await trustedApiRegionHeaders()),
    },
    {
      name: "series",
      read: async () => getPublicSeries("show", "en", await trustedApiRegionHeaders()),
    },
    { name: "SEO", read: async () => getSeoVideo("film", await trustedApiRegionHeaders()) },
    {
      name: "channel page",
      read: () =>
        PublicChannelPage({
          params: Promise.resolve({ handle: "creator" }),
          searchParams: Promise.resolve({}),
        }),
    },
    {
      name: "playlist page",
      read: () =>
        PublicPlaylistPage({
          params: Promise.resolve({ handle: "creator", slug: "collection" }),
          searchParams: Promise.resolve({}),
        }),
    },
  ];
  it.each(requests)(
    "rejects a real HTTP redirect from $name before a second origin receives it",
    async ({ read }) => {
      await expect(read()).rejects.toThrow();
      expect(apiReads).toBeGreaterThan(0);
      expect(authenticatedApiReads).toBe(apiReads);
      expect(destinationReads).toBe(0);
    },
  );
});
