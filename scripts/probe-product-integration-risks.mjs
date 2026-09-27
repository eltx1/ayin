import vm from "node:vm";
import { readFileSync } from "node:fs";

// Read-only audit probes, not acceptance tests. Run from repo root after pnpm build.
// Controlled adapters demonstrate code behavior; no production data is accessed.
const handlers = {};
const stored = [];
const deleted = [];
const context = vm.createContext({
  URL,
  Response,
  Set,
  self: {
    location: { origin: "https://ayin.stream" },
    addEventListener: (name, fn) => (handlers[name] = fn),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  },
  caches: {
    open: async () => ({
      put: async (request, response) =>
        stored.push({ url: request.url, cacheControl: response.headers.get("cache-control") }),
      match: async () => undefined,
      addAll: async () => {},
    }),
    keys: async () => ["another-product-cache", "ayin-pwa-v1-read", "ayin-pwa-v2-read"],
    delete: async (key) => {
      deleted.push(key);
      return true;
    },
  },
  fetch: async () =>
    new Response('{"privateProfile":true}', {
      headers: { "cache-control": "private, no-store", "content-type": "application/json" },
    }),
});
vm.runInContext(readFileSync("apps/web/public/sw.js", "utf8"), context);
let pending;
handlers.fetch({
  request: { url: "https://ayin.stream/api/discovery/home", method: "GET", destination: "" },
  respondWith: (promise) => (pending = promise),
});
await pending;
handlers.activate({ waitUntil: (promise) => (pending = promise) });
await pending;

const { DiscoveryService } = await import("../apps/api/dist/discovery/discovery.service.js");
const records = ["a", "b", "c"].map((id) => ({
  id,
  slug: id,
  title: id,
  durationMs: 1000,
  channel: { name: "Creator" },
  mediaAssets: [],
}));
const database = {
  client: { video: { findMany: async ({ skip, take }) => records.slice(skip, skip + take) } },
};
const rows = {
  getEnabled: async () => ({
    id: "row",
    key: "new-on-ayin",
    source: "NEW_ON_AYIN",
    title: "New",
    maxItems: 1,
  }),
};
const policy = { filterAvailableVideoIds: async (ids) => new Set(ids) };
const discovery = new DiscoveryService(database, rows, {}, policy);
const capped = await discovery.getRow("new-on-ayin", {}, undefined, 1);
const afterCap = await discovery.getRow("new-on-ayin", {}, capped.nextCursor, 1);
policy.filterAvailableVideoIds = async () => new Set();
const filtered = await discovery.getRow("new-on-ayin", {}, undefined, 1);
console.log(
  JSON.stringify(
    {
      evidence:
        "Isolated production-code probes with controlled adapters; not a production incident or full browser verification",
      serviceWorker: { privateNoStoreResponsesStored: stored, deletedCaches: deleted },
      discovery: {
        capped: { items: capped.items.length, nextCursor: capped.nextCursor },
        afterCap: { items: afterCap.items.length, nextCursor: afterCap.nextCursor },
        filtered: {
          items: filtered.items.length,
          availability: filtered.availability,
          nextCursor: filtered.nextCursor,
        },
      },
    },
    null,
    2,
  ),
);
