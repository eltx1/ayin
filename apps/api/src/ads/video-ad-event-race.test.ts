import { Prisma } from "@ayin/db";
import { describe, expect, it, vi } from "vitest";

import { VideoAdService, type VideoAdEventInput } from "./video-ad.service.js";

const input: VideoAdEventInput = {
  videoId: "00000000-0000-4000-8000-000000000001",
  slot: "PRE_ROLL",
  provider: "GOOGLE_IMA",
  eventType: "START",
  requestId: "synthetic-request",
  sessionId: "synthetic-session",
};
const cause = {
  kind: "UniqueConstraintViolation",
  originalCode: "23505",
  table: "AdPlacement",
  constraint: { index: "AdPlacement_key_key" },
};
const collisionMeta = { modelName: "AdPlacement", driverAdapterError: { cause } };
function unique(meta: Record<string, unknown> = collisionMeta) {
  return new Prisma.PrismaClientKnownRequestError("Synthetic unique violation", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
    meta,
  });
}
function fixture(error: unknown) {
  const placement = { id: "winning-placement" };
  const client = {
    adPlacement: {
      upsert: vi.fn().mockRejectedValue(error),
      findUnique: vi.fn().mockResolvedValue(placement),
    },
    adEvent: { create: vi.fn().mockResolvedValue({ id: "saved-event" }) },
  };
  const service = new VideoAdService(
    { client } as unknown as ConstructorParameters<typeof VideoAdService>[0],
    {} as ConstructorParameters<typeof VideoAdService>[1],
    {} as ConstructorParameters<typeof VideoAdService>[2],
    {} as ConstructorParameters<typeof VideoAdService>[3],
  );
  return { client, service, placement };
}

describe("video-ad placement initialization recovery", () => {
  it("rereads only the winning slot after the exact placement-key collision", async () => {
    const { client, service } = fixture(unique());
    expect(await service.recordEvent(input)).toEqual({ id: "saved-event" });
    expect(client.adPlacement.findUnique).toHaveBeenCalledWith({
      where: { key: "player_pre_roll" },
    });
    expect(client.adPlacement.upsert).toHaveBeenCalledTimes(1);
    expect(client.adPlacement.upsert.mock.calls[0]![0].update).toEqual({});
    expect(client.adEvent.create).toHaveBeenCalledWith({
      data: {
        placementId: "winning-placement",
        videoId: input.videoId,
        eventType: "START",
        requestId: input.requestId,
        sessionId: input.sessionId,
        metadata: { provider: "GOOGLE_IMA" },
      },
      select: { id: true },
    });
  });

  it.each([
    unique({ modelName: "AdPlacement", target: ["id"] }),
    unique({ modelName: "AdPlacement", target: ["key", "name"] }),
    unique({ modelName: "AdEvent", target: ["key"] }),
    unique({ modelName: "AdPlacement" }),
    unique({ modelName: "AdPlacement", target: ["key"] }),
    unique({ ...collisionMeta, modelName: "AdEvent" }),
    unique({ ...collisionMeta, driverAdapterError: { cause: { ...cause, table: "AdEvent" } } }),
    unique({
      ...collisionMeta,
      driverAdapterError: { cause: { ...cause, kind: "ForeignKeyConstraintViolation" } },
    }),
    unique({
      ...collisionMeta,
      driverAdapterError: { cause: { ...cause, originalCode: "23503" } },
    }),
    unique({
      ...collisionMeta,
      driverAdapterError: { cause: { ...cause, constraint: { index: "AdPlacement_pkey" } } },
    }),
    unique({
      ...collisionMeta,
      driverAdapterError: { cause: { ...cause, constraint: { fields: ["key"] } } },
    }),
    new Error("Synthetic connection failure"),
    { code: "P2002", meta: { modelName: "AdPlacement", target: ["key"] } },
  ])("does not reinterpret an unrelated or unverified placement error", async (error) => {
    const { client, service } = fixture(error);
    await expect(service.recordEvent(input)).rejects.toBe(error);
    expect(client.adPlacement.findUnique).not.toHaveBeenCalled();
    expect(client.adEvent.create).not.toHaveBeenCalled();
  });

  it("preserves the original collision if its winner no longer exists", async () => {
    const error = unique();
    const { client, service } = fixture(error);
    client.adPlacement.findUnique.mockResolvedValue(null);
    await expect(service.recordEvent(input)).rejects.toBe(error);
    expect(client.adEvent.create).not.toHaveBeenCalled();
  });

  it("surfaces a failed reread without writing an event", async () => {
    const { client, service } = fixture(unique());
    const failedRead = new Error("Synthetic read failure");
    client.adPlacement.findUnique.mockRejectedValue(failedRead);
    await expect(service.recordEvent(input)).rejects.toBe(failedRead);
    expect(client.adEvent.create).not.toHaveBeenCalled();
  });

  it("does not treat a failure from event persistence as placement initialization", async () => {
    const { client, service, placement } = fixture(null);
    client.adPlacement.upsert.mockResolvedValue(placement);
    const error = unique();
    client.adEvent.create.mockRejectedValue(error);
    await expect(service.recordEvent(input)).rejects.toBe(error);
    expect(client.adPlacement.findUnique).not.toHaveBeenCalled();
  });
});
