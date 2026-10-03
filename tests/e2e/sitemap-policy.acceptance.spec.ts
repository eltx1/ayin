import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001";
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/sitemap-policy-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
test("Warmed sitemap index and shards immediately reflect actual rights withdrawal without stale public XML", async ({
  request,
}) => {
  const data = db("seed", {});
  const index = await request.get("/sitemap.xml");
  expect(index.ok()).toBe(true);
  expect(index.headers()["cache-control"]).toContain("no-store");
  expect(await index.text()).toContain("/sitemaps/videos/0.xml");
  const video = await request.get("/sitemaps/videos/0.xml"),
    playlist = await request.get("/sitemaps/playlists/0.xml");
  expect(video.ok()).toBe(true);
  expect(playlist.ok()).toBe(true);
  expect(video.headers()["cache-control"]).toContain("no-store");
  expect(await video.text()).toContain("/watch/" + data.videoSlug);
  expect(await playlist.text()).toContain(data.playlistSlug);
  const counts = await request.get(API + "/public/seo/sitemap-counts");
  expect(await counts.json()).toEqual({ videos: 1, channels: 1, playlists: 1 });
  db("withdraw", { videoId: data.videoId });
  const fresh = await request.get("/sitemap.xml");
  expect(fresh.ok()).toBe(true);
  const xml = await fresh.text();
  expect(xml).not.toContain("/sitemaps/videos/0.xml");
  expect(xml).not.toContain("/sitemaps/playlists/0.xml");
  expect((await request.get("/sitemaps/videos/0.xml")).status()).toBe(404);
  expect((await request.get("/sitemaps/playlists/0.xml")).status()).toBe(404);
  const actual = await request.get(API + "/public/seo/sitemap-counts");
  expect(await actual.json()).toEqual({ videos: 0, channels: 1, playlists: 0 });
  const staticXml = await request.get("/sitemaps/static.xml");
  expect(staticXml.headers()["cache-control"]).toContain("public");
  expect(await staticXml.text()).toContain("/privacy");
});
test("Sitemap shard routes reject aliases and unsupported numeric offsets", async ({ request }) => {
  db("seed", {});
  for (const shard of [
    "0junk.xml",
    "01.xml",
    "-0.xml",
    "1e2.xml",
    "0.5.xml",
    "9007199254740992.xml",
    "500001.xml",
  ])
    expect((await request.get("/sitemaps/videos/" + shard)).status()).toBe(404);
  expect((await request.get("/sitemaps/videos/0.xml")).ok()).toBe(true);
});
