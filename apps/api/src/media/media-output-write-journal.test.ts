import { beforeEach, expect, it, vi } from "vitest";
import type * as Admission from "./media-upload-admission.js";
import { outputAttemptAddresses } from "./media-output-attempt.js";
import { lockOwnedMediaJob } from "./media-processing-integrity-fence.js";
import {
  assertUploadDebtByteCapacity,
  assertOutputEnvelopeRemaining,
  lockUploadAccountAdmission,
  lockUploadAdmission,
} from "./media-upload-admission.js";
import {
  freezeOutputAttempts,
  MediaOutputWriteJournalService,
} from "./media-output-write-journal.js";

vi.mock("./media-processing-integrity-fence.js", () => ({ lockOwnedMediaJob: vi.fn() }));
vi.mock("./media-privacy-account-fence.js", () => ({
  observeChannelMediaOwners: vi.fn(async () => ["owner"]),
  lockChannelMediaAccounts: vi.fn(),
  assertChannelMediaOwners: vi.fn(),
}));
vi.mock("./media-upload-admission.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Admission>()),
  assertUploadDebtByteCapacity: vi.fn(),
  lockUploadAccountAdmission: vi.fn(),
  lockUploadAdmission: vi.fn(),
  DEFAULT_UPLOAD_DEBT_BYTE_LIMITS: { account: 10 * 1024 ** 4, channel: 50 * 1024 ** 4 },
}));
const attemptId = "66666666-6666-4666-8666-666666666666";
const namespace = {
  channelId: "channel",
  videoId: "video",
  generation: 1,
  outputAttemptId: attemptId,
};
const addresses = outputAttemptAddresses(namespace);
const claim = { jobId: "job", workerId: "worker:claim", attempt: 1, outputAttemptId: attemptId };
const job = {
  id: "job",
  videoId: "video",
  generation: 1,
  video: { channelId: "channel" },
  inputIntegrityVersion: 1,
  outputProtocolVersion: 2,
  attempt: 1,
  currentOutputAttemptId: attemptId,
};

beforeEach(() => {
  vi.mocked(assertUploadDebtByteCapacity).mockReset();
  vi.mocked(lockOwnedMediaJob).mockReset();
  vi.mocked(lockOwnedMediaJob).mockResolvedValue(job as never);
});
function fixture() {
  const attempt = {
    id: attemptId,
    channelId: "channel",
    processingJobId: "job",
    claimToken: claim.workerId,
    attempt: 1,
    protocolVersion: 2,
    writesFrozenAt: null as Date | null,
    ...addresses,
  };
  const reservation = {
    id: "reservation",
    processingJobId: "job",
    channelId: "channel",
    accountId: "owner",
    envelopeBytes: 1024n,
    dispatchedBytes: 0n,
  };
  const writes = new Map<string, Record<string, unknown>>();
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "job" }]),
    mediaProcessingOutputReservation: {
      findUnique: vi.fn(async () => reservation),
      create: vi.fn(async ({ data }) => Object.assign(reservation, data)),
    },
    mediaProcessingJob: { findUnique: vi.fn(async () => job) },
    mediaProcessingOutputAttempt: {
      findUnique: vi.fn(async () => attempt),
      findMany: vi.fn(async ({ where }) =>
        attempt.protocolVersion === where.protocolVersion ? [attempt] : [],
      ),
      updateMany: vi.fn(async ({ where, data }) => {
        if (attempt.protocolVersion !== where.protocolVersion) return { count: 0 };
        attempt.writesFrozenAt ??= data.writesFrozenAt;
        return { count: 1 };
      }),
    },
    privacyMediaDeletionJob: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    mediaProcessingOutputWrite: {
      create: vi.fn(async ({ data }) => {
        if (writes.has(data.objectKey)) throw new Error("unique objectKey prohibits redispatch");
        assertOutputEnvelopeRemaining(reservation, data.expectedSizeBytes);
        reservation.dispatchedBytes += data.expectedSizeBytes;
        writes.set(data.objectKey, { ...data });
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = writes.get(where.objectKey);
        const statuses = typeof where.status === "string" ? [where.status] : where.status.in;
        if (
          !row ||
          !statuses.includes(row.status) ||
          Object.entries(where).some(([key, value]) => key !== "status" && row[key] !== value)
        )
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  const database = { client: { ...tx, $transaction: vi.fn(async (fn) => fn(tx)) } };
  return {
    attempt,
    reservation,
    writes,
    tx,
    database,
    service: new MediaOutputWriteJournalService(database as never),
  };
}
const canonical = {
  ...claim,
  objectKey: addresses.canonicalR2ObjectKey,
  expectedSizeBytes: 123,
  contentType: "video/mp4",
};

it("journals immutable exact byte/key/claim evidence only after the ordered ownership fence", async () => {
  const f = fixture();
  const dispatch = await f.service.dispatch(canonical);
  expect(f.tx.mediaProcessingOutputWrite.create).toHaveBeenCalledWith({
    data: { ...dispatch, status: "DISPATCHED" },
  });
  expect(dispatch).toMatchObject({
    processingJobId: "job",
    outputAttemptId: attemptId,
    claimToken: claim.workerId,
    expectedSizeBytes: 123n,
    contentType: "video/mp4",
  });
  expect(lockOwnedMediaJob).toHaveBeenCalledWith(
    f.tx,
    "job",
    claim.workerId,
    expect.objectContaining({
      requireInput: true,
      requireOutput: false,
      attempt: 1,
      outputAttemptId: attemptId,
    }),
  );
});

it("drains a reserved job even if issuance and new byte budgets are disabled", async () => {
  const f = fixture();
  vi.mocked(assertUploadDebtByteCapacity).mockRejectedValue(new Error("new issuance disabled"));
  const dispatch = await f.service.dispatch(canonical);
  expect(dispatch?.expectedSizeBytes).toBe(123n);
  expect(f.reservation.dispatchedBytes).toBe(123n);
  expect(lockUploadAccountAdmission).toHaveBeenCalledWith(f.tx, ["owner"]);
  expect(lockUploadAdmission).toHaveBeenCalledWith(f.tx, "channel");
  expect(assertUploadDebtByteCapacity).not.toHaveBeenCalled();
});

it("rejects measured over-envelope writes before journal commit or provider dispatch", async () => {
  const f = fixture();
  f.reservation.envelopeBytes = 122n;
  await expect(f.service.dispatch(canonical)).rejects.toMatchObject({
    code: "MEDIA_OUTPUT_ENVELOPE_EXCEEDED",
  });
  expect(f.reservation.dispatchedBytes).toBe(0n);
  expect(f.tx.mediaProcessingOutputWrite.create).not.toHaveBeenCalled();
});

it("does not refund UNKNOWN or acknowledged writes before a fresh output address", async () => {
  const f = fixture();
  f.reservation.envelopeBytes = 200n;
  const dispatch = (await f.service.dispatch(canonical))!;
  await f.service.markUnknown(dispatch);
  const thumbnail = {
    ...canonical,
    objectKey: addresses.thumbnailR2ObjectKey,
    contentType: "image/jpeg",
  };
  await expect(f.service.dispatch(thumbnail)).rejects.toMatchObject({
    code: "MEDIA_OUTPUT_ENVELOPE_EXCEEDED",
  });
  await f.service.acknowledge(dispatch);
  await expect(f.service.dispatch(thumbnail)).rejects.toMatchObject({
    code: "MEDIA_OUTPUT_ENVELOPE_EXCEEDED",
  });
  expect(f.reservation.dispatchedBytes).toBe(123n);
});

it("refuses an original source job missing its pre-grant reservation", async () => {
  const f = fixture();
  f.tx.mediaProcessingOutputReservation.findUnique.mockResolvedValue(null as never);
  await expect(f.service.dispatch(canonical)).rejects.toThrow(/pre-reserved output allowance/);
  expect(f.tx.mediaProcessingOutputWrite.create).not.toHaveBeenCalled();
  expect(assertUploadDebtByteCapacity).not.toHaveBeenCalled();
});

it("consumes a canonical-derived job's existing reservation without fresh admission", async () => {
  const f = fixture();
  vi.mocked(lockOwnedMediaJob).mockResolvedValue({
    ...job,
    inputIntegrityParentJobId: "producer",
  } as never);
  await f.service.dispatch(canonical);
  expect(assertUploadDebtByteCapacity).not.toHaveBeenCalled();
  expect(f.tx.mediaProcessingOutputReservation.create).not.toHaveBeenCalled();
  expect(f.reservation.dispatchedBytes).toBe(123n);
});

it("refuses a canonical-derived job that was not reserved at acceptance", async () => {
  const f = fixture();
  f.tx.mediaProcessingOutputReservation.findUnique.mockResolvedValue(null as never);
  vi.mocked(lockOwnedMediaJob).mockResolvedValue({
    ...job,
    inputIntegrityParentJobId: "producer",
  } as never);
  await expect(f.service.dispatch(canonical)).rejects.toThrow(/pre-reserved output allowance/);
  expect(f.tx.mediaProcessingOutputWrite.create).not.toHaveBeenCalled();
});

it.each(["frozen", "historical", "foreign claim", "lost lease"])(
  "refuses %s dispatch without recording new work",
  async (reason) => {
    const f = fixture();
    if (reason === "frozen") f.attempt.writesFrozenAt = new Date();
    if (reason === "historical") f.attempt.protocolVersion = 1;
    if (reason === "foreign claim") f.attempt.claimToken = "other";
    if (reason === "lost lease") vi.mocked(lockOwnedMediaJob).mockResolvedValue(null);
    await expect(f.service.dispatch(canonical)).rejects.toThrow();
    expect(f.tx.mediaProcessingOutputWrite.create).not.toHaveBeenCalled();
  },
);

it.each([
  ["canonical.mp4", "image/jpeg"],
  ["hls/../../foreign.ts", "video/mp2t"],
  ["hls/360p/segment-1.ts", "video/mp2t"],
  ["hls/360p/extra.m3u8", "application/vnd.apple.mpegurl"],
])("refuses unowned key/type %s %s", async (suffix, contentType) => {
  const f = fixture();
  await expect(
    f.service.dispatch({ ...canonical, objectKey: `${addresses.prefix}${suffix}`, contentType }),
  ).rejects.toThrow(/exact owned attempt/);
  expect(f.tx.mediaProcessingOutputWrite.create).not.toHaveBeenCalled();
});

it.each([
  ["canonical.mp4", "video/mp4"],
  ["thumbnail.jpg", "image/jpeg"],
  ["hls/master.m3u8", "application/vnd.apple.mpegurl"],
  ["hls/360p/index.m3u8", "application/vnd.apple.mpegurl"],
  ["hls/1080p/segment-999999.ts", "video/mp2t"],
])("journals the %s output class", async (suffix, contentType) => {
  const f = fixture();
  await expect(
    f.service.dispatch({ ...canonical, objectKey: `${addresses.prefix}${suffix}`, contentType }),
  ).resolves.toMatchObject({ contentType });
});

it("retains ambiguous dispatch debt, refuses replay, and accepts a losing worker's delayed exact ack", async () => {
  const f = fixture();
  const receipt = (await f.service.dispatch(canonical))!;
  await f.service.markUnknown(receipt);
  expect(f.writes.get(canonical.objectKey)?.status).toBe("UNKNOWN");
  await expect(f.service.dispatch(canonical)).rejects.toThrow(/redispatch/);
  f.attempt.writesFrozenAt = new Date();
  vi.mocked(lockOwnedMediaJob).mockResolvedValue(null);
  await f.service.acknowledge(receipt);
  expect(f.writes.get(canonical.objectKey)).toMatchObject({
    status: "ACKNOWLEDGED",
    acknowledgedAt: expect.any(Date),
  });
  await f.service.markUnknown(receipt);
  expect(f.writes.get(canonical.objectKey)?.status).toBe("ACKNOWLEDGED");
  expect(lockOwnedMediaJob).toHaveBeenCalledTimes(2);
});

it("cannot acknowledge a different dispatch/key and preserves residual DISPATCHED on process loss", async () => {
  const f = fixture();
  const receipt = (await f.service.dispatch(canonical))!;
  await expect(f.service.acknowledge({ ...receipt, id: "not-the-dispatch" })).rejects.toThrow(
    /exact output/,
  );
  expect(f.writes.get(canonical.objectKey)?.status).toBe("DISPATCHED");
});

it("freezes V2 attempts monotonically and preserves the original historical cleanup lane", async () => {
  const f = fixture();
  const frozenAt = new Date("2026-10-08T00:00:00Z");
  await freezeOutputAttempts(f.tx as never, ["job"], frozenAt);
  await expect(f.service.dispatch(canonical)).rejects.toThrow(/retired/);
  expect(f.tx.privacyMediaDeletionJob.createMany).toHaveBeenLastCalledWith({
    data: [
      expect.objectContaining({
        operationKey: `output-attempt:${attemptId}`,
        outputAttemptId: attemptId,
        scope: "PROCESSING_OUTPUT",
        kind: "OUTPUT_SETTLEMENT",
        outputAddresses: { version: 3, attemptIds: [attemptId] },
        cleanupContractVersion: 2,
      }),
    ],
    skipDuplicates: true,
  });
  f.attempt.protocolVersion = 1;
  f.tx.privacyMediaDeletionJob.createMany.mockClear();
  await freezeOutputAttempts(f.tx as never, ["job"], new Date());
  expect(f.attempt.writesFrozenAt).toBe(frozenAt);
  expect(f.tx.privacyMediaDeletionJob.createMany).not.toHaveBeenCalled();
});

it("keeps the verified historical V1 lane without a fabricated journal or new budget", async () => {
  const f = fixture();
  f.attempt.protocolVersion = 1;
  const legacy = { ...job, outputProtocolVersion: 1 };
  f.tx.mediaProcessingJob.findUnique.mockResolvedValue(legacy);
  vi.mocked(lockOwnedMediaJob).mockResolvedValue(legacy as never);
  await expect(f.service.dispatch(canonical)).resolves.toBeNull();
  expect(assertUploadDebtByteCapacity).not.toHaveBeenCalled();
  expect(f.tx.mediaProcessingOutputWrite.create).not.toHaveBeenCalled();
});
