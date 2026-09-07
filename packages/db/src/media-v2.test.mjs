import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../prisma/media-v2.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260907005600_media_architecture_v2/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Task 39 media architecture V2 persistence", () => {
  it("models durable generation and rendition lifecycle state", () => {
    expect(schema).toContain("model MediaPlaybackGeneration {");
    expect(schema).toContain("model MediaPlaybackRendition {");
    expect(schema).toContain(
      "processingVersion    Int                           @default(2)",
    );
    expect(schema).toContain("fallbackStatus       MediaPlaybackOutputStatus");
    expect(schema).toContain("hlsMasterStatus      MediaPlaybackOutputStatus");
    expect(schema).toContain("playlistR2ObjectKey");
    expect(schema).toContain("segmentR2Prefix");
  });

  it("enforces deterministic generation/rendition identities and object-key uniqueness", () => {
    expect(schema).toContain("@@unique([videoId, generation])");
    expect(schema).toContain("@@unique([playbackGenerationId, identity])");
    expect(schema).toContain(
      "fallbackR2ObjectKey  String                        @unique",
    );
    expect(schema).toContain(
      "hlsMasterR2ObjectKey String                        @unique",
    );
    expect(schema).toContain(
      "playlistR2ObjectKey  String                    @unique",
    );
    expect(schema).toContain(
      "segmentR2Prefix      String                    @unique",
    );
  });

  it("keeps the migration additive and leaves live V1 media tables untouched", () => {
    expect(migration).toContain('CREATE TABLE "MediaPlaybackGeneration"');
    expect(migration).toContain('CREATE TABLE "MediaPlaybackRendition"');
    expect(migration).toContain(
      'REFERENCES "MediaPlaybackGeneration"("id") ON DELETE CASCADE',
    );
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i);
    expect(migration).not.toContain('ALTER TABLE "Video"');
    expect(migration).not.toContain('ALTER TABLE "MediaAsset"');
    expect(migration).not.toContain('ALTER TABLE "MediaProcessingJob"');
  });
});
