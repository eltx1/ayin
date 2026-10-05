// Controlled local query evidence only. This never connects to a deployment.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "../packages/db/dist/index.js";
import { StudioService } from "../apps/api/dist/creator/studio.service.js";
const requireDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { PrismaPg } = requireDb("@prisma/adapter-pg");
const { Client } = requireDb("pg");
const connection = process.env.TEST_DATABASE_URL;
const url = new URL(connection ?? "https://invalid.test");
if (
  process.env.APP_ENV !== "test" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["/ayin_test", "/ayin_e2e"].includes(url.pathname) ||
  process.env.DATABASE_URL !== connection
)
  throw new Error("Query measurement requires an isolated local AYIN test database");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connection }),
  log: [{ emit: "event", level: "query" }],
});
const pg = new Client({ connectionString: connection });
const service = new StudioService({ client: prisma });
const run = randomUUID(),
  actor = randomUUID(),
  channel = randomUUID(),
  other = randomUUID();
const statements = [];
prisma.$on("query", (event) => {
  if (/FROM "public"\."Video"/.test(event.query) && /ORDER BY/.test(event.query))
    statements.push(event);
});
const report = {
  measuredAt: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  node: process.version,
  fixture: {
    channelRows: 5000,
    otherChannelRows: 50000,
    timestampTieGroupSize: 10,
    responseRows: 25,
    lookahead: 1,
  },
  notes:
    "Local PostgreSQL laboratory evidence, not production latency or field data. Same captured Prisma SQL/parameters before and after the additive channel cursor index. Five warm-cache executions per case; index-only change is rolled back.",
  cases: [],
};
try {
  await pg.connect();
  report.postgres = (await pg.query("SELECT version() AS version")).rows[0].version;
  await prisma.account.create({
    data: {
      id: actor,
      displayName: "Studio query measurement",
      email: `${run}@studio-query.invalid`,
    },
  });
  await prisma.channel.createMany({
    data: [
      { id: channel, handle: `query-${channel}`, name: "Measured channel" },
      { id: other, handle: `query-${other}`, name: "Other channel" },
    ],
  });
  await prisma.channelMember.create({
    data: { accountId: actor, channelId: channel, role: "OWNER" },
  });
  for (const [channelId, count] of [
    [channel, 5000],
    [other, 50000],
  ]) {
    await pg.query(
      `INSERT INTO "Video" ("id", "channelId", "slug", "title", "description", "status", "visibility", "updatedAt")
      SELECT gen_random_uuid(), $1::uuid, $1 || '-' || n, 'Film night ' || n, repeat('Measured description ', 10),
      CASE WHEN n % 2 = 0 THEN 'DRAFT'::"VideoStatus" ELSE 'PUBLISHED'::"VideoStatus" END,
      CASE WHEN n % 3 = 0 THEN 'PRIVATE'::"VideoVisibility" ELSE 'PUBLIC'::"VideoVisibility" END,
      timestamp '2026-09-01' + ((n / 10)::text || ' seconds')::interval
      FROM generate_series(1, $2::int) AS n`,
      [channelId, count],
    );
  }
  await pg.query('ANALYZE "Video"');
  const first = await service.content(actor, { take: 25 });
  const firstSql = statements.at(-1);
  await service.content(actor, { take: 25, cursor: first.nextCursor });
  const nextSql = statements.at(-1);
  const anchor = await prisma.video.findFirstOrThrow({
    where: { channelId: channel },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: 3999,
    select: { id: true, updatedAt: true },
  });
  const { encodeStudioContentCursor } =
    await import("../apps/api/dist/creator/studio-content-cursor.js");
  const deepCursor = encodeStudioContentCursor(anchor, {
    accountId: actor,
    channelId: channel,
    take: 25,
    query: "",
    status: "",
    visibility: "",
  });
  await service.content(actor, { take: 25, cursor: deepCursor });
  const deepSql = statements.at(-1);
  await service.content(actor, {
    take: 25,
    query: "film night",
    status: "PUBLISHED",
    visibility: "PRIVATE",
  });
  const filterSql = statements.at(-1);
  const captures = [
    { name: "first", sql: firstSql },
    { name: "second", sql: nextSql },
    { name: "deep-4000", sql: deepSql },
    { name: "filtered", sql: filterSql },
  ];
  if (captures.some(({ sql }) => !sql)) throw new Error("Actual Prisma query capture missing");
  async function measure(name, captured, index) {
    const parameters = JSON.parse(captured.params);
    const samples = [];
    for (let n = 0; n < 5; n++) {
      const start = performance.now();
      const result = await pg.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.query}`,
        parameters,
      );
      samples.push({ wallMs: performance.now() - start, plan: result.rows[0]["QUERY PLAN"][0] });
    }
    report.cases.push({ name, index, query: captured.query, parameters, samples });
  }
  await pg.query("BEGIN");
  await pg.query('DROP INDEX "video_studio_content_cursor_idx"');
  for (const { name, sql } of captures) await measure(name, sql, "before");
  await pg.query("ROLLBACK");
  for (const { name, sql } of captures) await measure(name, sql, "after");
  const output = process.argv[2] ?? "docs/evidence/studio-content-query.json";
  await mkdir(new URL(".", `file://${process.cwd()}/${output}`).pathname, { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        cases: report.cases.map(({ name, index, samples }) => ({
          name,
          index,
          executionMs: samples.map(({ plan }) => plan["Execution Time"]),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await pg.query("ROLLBACK").catch(() => undefined);
  await prisma.video.deleteMany({ where: { channelId: { in: [channel, other] } } });
  await prisma.channel.deleteMany({ where: { id: { in: [channel, other] } } });
  await prisma.account.deleteMany({ where: { id: actor } });
  await pg.end();
  await prisma.$disconnect();
}
