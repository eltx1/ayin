import test from "node:test";
import assert from "node:assert/strict";
import { patchEnv, validateResume } from "./runtime.mjs";
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
