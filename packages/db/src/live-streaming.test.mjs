import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/live.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260830190000_live_streaming_foundation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Task 34 live streaming foundation", () => {
  it("models scheduled live, chat and moderation without treating R2 as live output", () => {
    expect(schema).toContain("model LiveStream {");
    expect(schema).toContain("model LiveChatMessage {");
    expect(schema).toContain("model LiveModerationAction {");
    expect(schema).toContain('providerKey        String           @default("unconfigured")');
    expect(schema).toContain("streamKeyHash");
    expect(schema).toContain("adBreaksEnabled");
  });

  it("enforces ownership references and useful live indexes", () => {
    expect(migration).toContain('REFERENCES "Channel"("id")');
    expect(migration).toContain('REFERENCES "ViewerProfile"("id")');
    expect(migration).toContain("LiveStream_channelId_status_scheduledStartAt_idx");
    expect(migration).toContain("LiveChatMessage_liveStreamId_status_createdAt_idx");
  });
});
