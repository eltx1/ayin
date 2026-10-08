import type { Prisma } from "@ayin/db";
import { describe, expect, it, vi } from "vitest";
import {
  assertUploadByteQuota,
  assertUploadDebtByteCapacity,
  assertUploadSessionCapacity,
  conservativeMultipartExposure,
  lockUploadAccountAdmission,
  UPLOAD_ADMISSION_LIMITS,
} from "./media-upload-admission.js";

const GiB = 1024 ** 3;
function fixture() {
  const query = vi.fn();
  const aggregate = vi.fn().mockResolvedValue({ _sum: { sizeBytes: 0n } });
  const execute = vi.fn().mockResolvedValue(0);
  return {
    query,
    aggregate,
    execute,
    tx: {
      $queryRaw: query,
      $executeRaw: execute,
      mediaAsset: { aggregate },
    } as unknown as Prisma.TransactionClient,
  };
}

describe("finite source exposure accounting", () => {
  it("reserves provider-sized part slots, never the browser-declared part body", () => {
    expect(conservativeMultipartExposure(1, 5 * 1024 ** 2)).toBe(5n * BigInt(GiB));
    expect(conservativeMultipartExposure(17 * 1024 ** 2, 16 * 1024 ** 2)).toBe(10n * BigInt(GiB));
    expect(conservativeMultipartExposure(10_000, 1)).toBe(50_000n * BigInt(GiB));
  });
  it.each([
    [0, 1],
    [1, 0],
    [1.5, 1],
    [Infinity, 1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [10_001, 1],
  ])("rejects invalid/unbounded part count %s/%s", (size, part) => {
    expect(() => conservativeMultipartExposure(size, part)).toThrowError(
      expect.objectContaining({ code: "UPLOAD_PART_LIMIT" }),
    );
  });
  it("takes sorted distinct account admission locks before channel locking by caller", async () => {
    const f = fixture();
    await lockUploadAccountAdmission(f.tx, ["b", "A", "a"]);
    expect(f.execute.mock.calls.map((call) => call[1])).toEqual(["a", "b"]);
  });
});

describe("separate source and cleanup admission counts", () => {
  const empty = Object.fromEntries(Object.keys(UPLOAD_ADMISSION_LIMITS).map((name) => [name, 0n]));
  it("accepts zero active slots even when settled tombstones and accepted media exist", async () => {
    const f = fixture();
    f.query.mockResolvedValue([empty]);
    await expect(assertUploadSessionCapacity(f.tx, "account", "channel")).resolves.toBeUndefined();
  });
  it.each(Object.entries(UPLOAD_ADMISSION_LIMITS))(
    "rejects exhausted %s without borrowing active/debt capacity",
    async (name, limit) => {
      const f = fixture();
      f.query.mockResolvedValue([{ ...empty, [name]: BigInt(limit) }]);
      await expect(assertUploadSessionCapacity(f.tx, "account", "channel")).rejects.toMatchObject({
        code: "UPLOAD_ADMISSION_LIMIT",
      });
    },
  );
});

describe("physical debt byte admission", () => {
  it("keeps zero-byte allocation debt separate from whole-file bytes", async () => {
    const f = fixture();
    f.query.mockResolvedValue([{ accountBytes: 0n, channelBytes: 0n, unaccounted: 0n }]);
    await expect(
      assertUploadDebtByteCapacity(f.tx, "account", "channel", 0n, { account: 1, channel: 1 }),
    ).resolves.toBeUndefined();
  });
  it.each(["account", "channel"])(
    "retains %s debt when source acceptance did not acknowledge the write",
    async (scope) => {
      const f = fixture();
      f.query.mockResolvedValue([
        {
          accountBytes: 0n,
          channelBytes: 0n,
          unaccounted: 0n,
          [`${scope}Bytes`]: 5n * BigInt(GiB),
        },
      ]);
      await expect(
        assertUploadDebtByteCapacity(f.tx, "account", "channel", 1n, {
          account: 5 * GiB,
          channel: 5 * GiB,
        }),
      ).rejects.toMatchObject({ code: "UPLOAD_PHYSICAL_DEBT_LIMIT" });
    },
  );
  it("allows exactly the configured exposure budget, but fails closed on missing accounting", async () => {
    const f = fixture();
    f.query.mockResolvedValue([{ accountBytes: 9n, channelBytes: 19n, unaccounted: 0n }]);
    await expect(
      assertUploadDebtByteCapacity(f.tx, "account", "channel", 1n, { account: 10, channel: 20 }),
    ).resolves.toBeUndefined();
    f.query.mockResolvedValue([{ accountBytes: 0n, channelBytes: 0n, unaccounted: 1n }]);
    await expect(
      assertUploadDebtByteCapacity(f.tx, "account", "channel", 0n),
    ).rejects.toMatchObject({ code: "UPLOAD_PHYSICAL_DEBT_LIMIT" });
    f.query.mockResolvedValue([]);
    await expect(
      assertUploadDebtByteCapacity(f.tx, "account", "channel", 0n),
    ).rejects.toMatchObject({ code: "UPLOAD_PHYSICAL_DEBT_LIMIT" });
  });
});

describe("ordinary channel quota compatibility", () => {
  it("continues charging live declarations and unresolved V1 bytes exactly once", async () => {
    const f = fixture();
    f.aggregate.mockResolvedValue({ _sum: { sizeBytes: 60n } });
    f.query.mockResolvedValue([{ bytes: 30n }]);
    await expect(assertUploadByteQuota(f.tx, "channel", 10, 100)).resolves.toBeUndefined();
    await expect(assertUploadByteQuota(f.tx, "channel", 11, 100)).rejects.toMatchObject({
      code: "CHANNEL_UPLOAD_QUOTA_REACHED",
    });
  });
  it("excludes V2 grantless zero-exposure pending declarations, including crashed CREATE, from the live sum", async () => {
    const f = fixture();
    f.query.mockResolvedValue([{ bytes: 0n }]);
    await assertUploadByteQuota(f.tx, "channel", 1, 100);
    expect(f.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: {
            status: "PENDING",
            uploadSession: {
              is: {
                sourceProtocolVersion: 2,
                grantReservationCount: 0,
                lastGrantExpiresAt: null,
                providerExposureBytes: 0n,
              },
            },
          },
        }),
      }),
    );
  });
});
