import test from "node:test";
import assert from "node:assert/strict";
import {
  patchEnv,
  validateResume,
  validateCleanupRetry,
  validateCancellationSlot,
  validateCancelledFixture,
} from "./runtime.mjs";
import { createHash } from "node:crypto";
test("adds only the selected flags and preserves existing credentials and comments", () => {
  const input = '# existing\nDATABASE_URL="untouched"\nR2_SECRET_ACCESS_KEY=untouched\n';
  assert.equal(
    patchEnv(input, { AYIN_UPLOAD_RECOVERY_V2_ENABLED: "1" }),
    input + "\nAYIN_UPLOAD_RECOVERY_V2_ENABLED=1\n",
  );
});
test("disabling preserves the already reserved output and debt limits", () => {
  const input =
    "AYIN_UPLOAD_RECOVERY_V2_ENABLED=1\nAYIN_UPLOAD_RECOVERY_OUTPUT_ENVELOPE_BYTES=33554432\n";
  assert.equal(
    patchEnv(input, { AYIN_UPLOAD_RECOVERY_V2_ENABLED: "0" }),
    "AYIN_UPLOAD_RECOVERY_V2_ENABLED=0\nAYIN_UPLOAD_RECOVERY_OUTPUT_ENVELOPE_BYTES=33554432\n",
  );
});
test("rejects ambiguous duplicate environment assignments before writing", () => {
  assert.throws(() => patchEnv("FLAG=0\nexport FLAG=1\n", { FLAG: "0" }), /DUPLICATE_SETTING/);
});
test("normalizes an existing selected export but does not alter other values", () => {
  assert.equal(
    patchEnv("export FLAG='0'\r\nOTHER=\"a=b\"\r\n", { FLAG: "1" }),
    'FLAG=1\nOTHER="a=b"\n',
  );
});

function predecessor() {
  const p = "AYIN_UPLOAD_RECOVERY_";
  const approvedBounds = {
    CANARY_SOURCE_MAX_BYTES: "1048576",
    OUTPUT_ENVELOPE_BYTES: "33554432",
    DEBT_ACCOUNT_BYTES: "5402263552",
    DEBT_CHANNEL_BYTES: "5402263552",
  };
  const values = Object.fromEntries(
    Object.entries({
      V2_ENABLED: "1",
      CANARY_ACCOUNT_ID: "owner",
      CANARY_CHANNEL_ID: "channel",
      ...approvedBounds,
    }).map(([key, value]) => [p + key, value]),
  );
  const backup = "UNRELATED=preserved\n";
  const enabled = patchEnv(backup, values);
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const journal = {
    releaseSha: "ab8355f3c45e5208ef9fe6477666b8f834c231b4",
    accountId: "owner",
    channelId: "channel",
    approvedBounds,
    cleanupApproved: false,
    fixtureBytes: 478196,
    fixtureSha256: "184bb9e5d9ad3218af8c4f4552558c24c506d166c293dbbc83becd810e4db98c",
    originalEnvSha256: sha(backup),
    enabledEnvSha256: sha(enabled),
  };
  return {
    journal,
    backup,
    values,
    enabled,
    disabled: patchEnv(enabled, { [p + "V2_ENABLED"]: "0" }),
  };
}
test("resume accepts only the exact closed predecessor without mutating it", () => {
  const p = predecessor(),
    before = JSON.stringify(p);
  validateResume(p.journal, p.backup, p.disabled, p.values, false);
  assert.equal(JSON.stringify(p), before);
});
test("resume refuses replay, an open predecessor, changed settings and changed backup", () => {
  const p = predecessor();
  assert.throws(
    () => validateResume(p.journal, p.backup, p.disabled, p.values, true),
    /RESUME_ALREADY_RESERVED/,
  );
  assert.throws(
    () => validateResume(p.journal, p.backup, p.enabled, p.values, false),
    /CLOSURE_CHANGED/,
  );
  assert.throws(
    () => validateResume(p.journal, p.backup, p.disabled + "OTHER=1\n", p.values, false),
    /CLOSURE_CHANGED/,
  );
  assert.throws(
    () => validateResume(p.journal, p.backup + "#changed\n", p.disabled, p.values, false),
    /BACKUP_CHANGED/,
  );
});
test("resume refuses changed ownership, bounds, fixture and deletion scope", () => {
  for (const mutation of [
    (p) => (p.journal.accountId = "other"),
    (p) => (p.journal.approvedBounds.CANARY_SOURCE_MAX_BYTES = "2097152"),
    (p) => (p.journal.fixtureBytes = 500000),
    (p) => (p.journal.cleanupApproved = true),
  ]) {
    const p = predecessor();
    mutation(p);
    assert.throws(() => validateResume(p.journal, p.backup, p.disabled, p.values, false));
  }
});

function settledFixture() {
  return {
    newIssuanceBefore: false,
    v2SessionCount: 1,
    channelSessionCount: 1,
    sessionFingerprint: "d88f09decfb9c8be70902626236a92dec4578ee52d6b778f85b6ca2ab59868fc",
    sessionState: "COMPLETED",
    jobStatus: "READY",
    inputMatchesFixture: true,
    inputVerified: true,
    outputVerified: true,
    cleanupOutstandingCount: 1,
    cleanupOutstandingKind: "ALLOCATION",
    cleanupOutstandingStatus: "PENDING",
    cleanupCode: "INVALID_RESPONSE",
    cleanupAttempts: 5,
  };
}
test("cleanup retry admits only the exact closed, verified fixture's parser failure", () => {
  validateCleanupRetry(settledFixture(), false);
  assert.throws(() => validateCleanupRetry(settledFixture(), true), /ALREADY_RESERVED/);
  for (const patch of [
    { newIssuanceBefore: true },
    { v2SessionCount: 2 },
    { sessionFingerprint: "other" },
    { jobStatus: "QUEUED" },
    { inputMatchesFixture: false },
    { outputVerified: false },
    { cleanupOutstandingCount: 2 },
    { cleanupOutstandingKind: "OBJECT" },
    { cleanupOutstandingStatus: "PROCESSING" },
    { cleanupCode: "PROVIDER_ERROR" },
    { cleanupAttempts: 6 },
  ])
    assert.throws(() => validateCleanupRetry({ ...settledFixture(), ...patch }, false));
});

test("cancellation activation requires a fully retired predecessor and refuses replay", () => {
  const ready = {
    ...settledFixture(),
    outputReservationCount: 1,
    activeProcessingJobs: 0,
    cleanupOutstandingCount: 0,
    fixtureCleanupJobs: 3,
    cleanupDone: 3,
    unknownOperations: 0,
    unacknowledgedWrites: 0,
  };
  validateCancellationSlot(ready, false);
  assert.throws(() => validateCancellationSlot(ready, true), /ALREADY_RESERVED/);
  for (const patch of [
    { cleanupOutstandingCount: 1 },
    { cleanupDone: 2 },
    { v2SessionCount: 2 },
    { activeProcessingJobs: 1 },
    { outputReservationCount: 2 },
    { unknownOperations: 1 },
    { unacknowledgedWrites: 1 },
    { inputMatchesFixture: false },
    { newIssuanceBefore: true },
  ])
    assert.throws(() => validateCancellationSlot({ ...ready, ...patch }, false));
});

test("cancellation verification requires the pinned terminal fixture, finite evidence and zero debt", () => {
  const proof = {
    newIssuanceBefore: false,
    v2SessionCount: 2,
    channelSessionCount: 2,
    sessionFingerprint: "617d3eedbeaba057c4685e1c504871598c9e8899317585305c3d0927a108773b",
    sessionState: "ABORTED",
    sizeBytes: 478196,
    grantReservationCount: 1,
    grantWaitSeconds: 0,
    createOperations: 1,
    authorizeOperations: 1,
    resumeOperations: 0,
    completeOperations: 0,
    cancelOperations: 1,
    unknownOperations: 0,
    fixtureProcessingJobs: 0,
    activeProcessingJobs: 0,
    outputReservationCount: 2,
    fixtureOutputReservedBytes: 33554432,
    cancelOutputDispatchedBytes: 0,
    fixtureCleanupJobs: 3,
    cleanupOutstandingCount: 0,
    cancelCleanupEvidenceCount: 3,
    cancelRecheckCount: 3,
    cancelSourceRemoved: true,
    cleanupRequested: true,
    cancelGrantsRevoked: true,
    channelLiveSourceBytes: 521854,
    activeAccount: 0,
    activeChannel: 0,
    retainedDebtAccount: 0,
    retainedDebtChannel: 0,
    uncertainAccount: 0,
    uncertainChannel: 0,
    accountBytes: 0,
    channelBytes: 0,
    unaccounted: 0,
  };
  validateCancelledFixture(proof);
  for (const patch of [
    { newIssuanceBefore: true },
    { sessionFingerprint: "other" },
    { sessionState: "OPEN" },
    { v2SessionCount: 3 },
    { grantWaitSeconds: 1 },
    { cancelOperations: 0 },
    { completeOperations: 1 },
    { unknownOperations: 1 },
    { fixtureProcessingJobs: 1 },
    { cancelOutputDispatchedBytes: 1 },
    { cleanupOutstandingCount: 1 },
    { cancelCleanupEvidenceCount: 2 },
    { cancelRecheckCount: 2 },
    { cancelSourceRemoved: false },
    { cancelGrantsRevoked: false },
    { channelLiveSourceBytes: 1000050 },
    { activeAccount: 1 },
    { accountBytes: 5368709120 },
    { unaccounted: 1 },
  ])
    assert.throws(() => validateCancelledFixture({ ...proof, ...patch }));
});
