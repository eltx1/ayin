import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresSearchService } from "../src/search/search-postgres.service.js";

const client = createPrismaClient();
const database = { client } as never;
const search = new PostgresSearchService(database);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let channelId = "";
let exactId = "";
let prefixId = "";
let privateId = "";
let arabicId = "";

beforeAll(async () => {
  const channel = await client.channel.create({
    data: { handle: `search64-${suffix}`, name: "Search 64 Observatory", status: "ACTIVE" },
  });
  channelId = channel.id;
  const [exact, prefix, hidden, arabic] = await Promise.all([
    client.video.create({
      data: {
        channelId,
        slug: `interstellar-${suffix}`,
        title: "Interstellar",
        description: "A journey beyond the solar system",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    }),
    client.video.create({
      data: {
        channelId,
        slug: `interstellar-documentary-${suffix}`,
        title: "Interstellar Documentary",
        description: "Behind the science",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    }),
    client.video.create({
      data: {
        channelId,
        slug: `hidden-nebula-${suffix}`,
        title: "Hidden Nebula",
        status: "PUBLISHED",
        visibility: "PRIVATE",
        publishedAt: new Date(),
      },
    }),
    client.video.create({
      data: {
        channelId,
        slug: `arabic-stars-${suffix}`,
        title: "رحلة إلى النجوم",
        description: "فيلم وثائقي عن الفضاء",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    }),
  ]);
  exactId = exact.id;
  prefixId = prefix.id;
  privateId = hidden.id;
  arabicId = arabic.id;
});

afterAll(async () => {
  if (channelId) await client.video.deleteMany({ where: { channelId } });
  if (channelId) await client.channel.delete({ where: { id: channelId } });
  await client.$disconnect();
});

describe("Task 64 PostgreSQL search", () => {
  it("weights an exact title above a prefix title", async () => {
    const results = await search.searchCandidates("Interstellar", 12);
    const exact = results.find((item) => item.id === exactId);
    const prefix = results.find((item) => item.id === prefixId);
    expect(exact).toBeDefined();
    expect(prefix).toBeDefined();
    expect(exact?.score ?? 0).toBeGreaterThan(prefix?.score ?? 0);
  });

  it("supports prefix matching without a leading wildcard", async () => {
    const results = await search.searchCandidates("Inter", 12);
    expect(results.some((item) => item.id === exactId)).toBe(true);
    expect(results.some((item) => item.id === prefixId)).toBe(true);
  });

  it("uses trigram typo tolerance", async () => {
    const results = await search.searchCandidates("Interstelar", 12);
    expect(results.some((item) => item.id === exactId)).toBe(true);
  });

  it("excludes private content from search and suggestions", async () => {
    const results = await search.searchCandidates("Hidden Nebula", 12);
    const suggestions = await search.suggestCandidates("Hidden", 8);
    expect(results.some((item) => item.id === privateId)).toBe(false);
    expect(suggestions.some((item) => item.id === privateId)).toBe(false);
  });

  it("matches multilingual Unicode prefixes", async () => {
    const results = await search.searchCandidates("رحل", 12);
    expect(results.some((item) => item.id === arabicId)).toBe(true);
  });

  it("measures an index-backed prefix query plan", async () => {
    const plan = await client.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
      return transaction.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
        EXPLAIN (FORMAT JSON)
        SELECT "id"
        FROM "Video"
        WHERE lower("title") LIKE ${"inter%"} ESCAPE '\\'
        LIMIT 20
      `;
    });
    expect(JSON.stringify(plan)).toMatch(/search_video_title_(prefix|trgm)_idx/);
  });
});
