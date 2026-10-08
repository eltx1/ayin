import type { Prisma } from "@ayin/db";
import { beforeEach, expect, it, vi } from "vitest";
import { MediaUploadError } from "./media-upload-error.js";
import {
  isOutputAdmissionPolicyError,
  prepareDerivedOutputReservation,
} from "./media-output-reservation.js";
import { assertUploadDebtByteCapacity } from "./media-upload-admission.js";
import { assertUploadCanarySlot, requireUploadCanary } from "./media-upload-canary.js";
import { observeChannelMediaOwners } from "./media-privacy-account-fence.js";
vi.mock("./media-upload-admission.js", () => ({ assertUploadDebtByteCapacity: vi.fn() }));
vi.mock("./media-upload-canary.js", () => ({
  assertUploadCanarySlot: vi.fn(),
  requireUploadCanary: vi.fn(),
}));
vi.mock("./media-privacy-account-fence.js", () => ({ observeChannelMediaOwners: vi.fn() }));
const config = {
  recoveryCanaryAccountId: "account",
  recoveryDebtAccountBytes: 2048,
  recoveryDebtChannelBytes: 4096,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUploadCanary).mockReturnValue({
    accountId: "account",
    channelId: "channel",
    outputEnvelopeBytes: 1024,
    sourceMaxBytes: 1,
  });
  vi.mocked(observeChannelMediaOwners).mockResolvedValue(["account"]);
});
it("does not impose any V2 admission on historical derived jobs", async () => {
  await expect(
    prepareDerivedOutputReservation({} as never, undefined, "channel", {
      outputProtocolVersion: 1,
    }),
  ).resolves.toBeNull();
  expect(requireUploadCanary).not.toHaveBeenCalled();
});
it("prepares full derived allowance under only nonblocking ordered capacity locks", async () => {
  const query = vi.fn().mockResolvedValue([{ locked: true }]);
  const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
  await expect(
    prepareDerivedOutputReservation(tx, config as never, "channel", {
      outputProtocolVersion: 2,
      inputIntegritySessionId: "source",
    }),
  ).resolves.toEqual({ accountId: "account", channelId: "channel", envelopeBytes: 1024n });
  expect(query.mock.calls.map(([sql]) => sql.join("?"))).toEqual(
    expect.arrayContaining([
      expect.stringContaining("pg_try_advisory_xact_lock(86192046"),
      expect.stringContaining("pg_try_advisory_xact_lock(86192045"),
      expect.stringContaining("pg_try_advisory_xact_lock(86192044"),
    ]),
  );
  expect(assertUploadCanarySlot).toHaveBeenCalledWith(tx, "source");
  expect(assertUploadDebtByteCapacity).toHaveBeenCalledWith(tx, "account", "channel", 1024n, {
    account: 2048,
    channel: 4096,
  });
});
it.each([0, 1, 2])("aborts acceptance immediately when lock %s is occupied", async (blocked) => {
  let calls = 0;
  const query = vi.fn(async () => [{ locked: calls++ !== blocked }]);
  await expect(
    prepareDerivedOutputReservation({ $queryRaw: query } as never, config as never, "channel", {
      outputProtocolVersion: 2,
    }),
  ).rejects.toMatchObject({ code: "UPLOAD_OUTPUT_ADMISSION_BUSY" });
  expect(query).toHaveBeenCalledTimes(blocked + 1);
  expect(assertUploadDebtByteCapacity).not.toHaveBeenCalled();
});
it("requires the configured account to remain a current channel owner", async () => {
  vi.mocked(observeChannelMediaOwners).mockResolvedValue(["other"]);
  await expect(
    prepareDerivedOutputReservation({} as never, config as never, "channel", {
      outputProtocolVersion: 2,
    }),
  ).rejects.toMatchObject({ code: "UPLOAD_RECOVERY_UNSUPPORTED" });
});

it.each([
  "UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE",
  "UPLOAD_RECOVERY_UNSUPPORTED",
  "UPLOAD_OUTPUT_ADMISSION_BUSY",
  "UPLOAD_CANARY_BUSY",
  "UPLOAD_PHYSICAL_DEBT_LIMIT",
])("identifies only the expected %s admission policy as safe to skip", (code) => {
  expect(isOutputAdmissionPolicyError(new MediaUploadError(code, "policy"))).toBe(true);
  expect(isOutputAdmissionPolicyError({ code, message: "SQL or unknown error" })).toBe(false);
});
it("never swallows unrelated media errors or transaction failures", () => {
  expect(isOutputAdmissionPolicyError(new MediaUploadError("OTHER", "unexpected"))).toBe(false);
  expect(isOutputAdmissionPolicyError(new Error("transaction aborted"))).toBe(false);
});
