import { test } from "node:test";
import assert from "node:assert/strict";
import { patchEnv, validateActivation } from "./runtime.mjs";
test("activation refuses unsettled work, missing closed switch and replay", () => {
  const env = { AYIN_UPLOAD_RECOVERY_V2_ENABLED: "0" };
  const baseline = {
    v2Sessions: 2,
    unknownOperations: 0,
    unacknowledgedWrites: 0,
    pendingProcessing: 0,
    pendingCleanup: 0,
  };
  assert.doesNotThrow(() => validateActivation(env, baseline, false));
  for (const key of Object.keys(baseline))
    assert.throws(
      () =>
        validateActivation(
          env,
          { ...baseline, [key]: baseline[key] + 1 },
          false,
        ),
      /BASELINE_NOT_SETTLED/,
    );
  for (const patch of [
    { AYIN_UPLOAD_RECOVERY_V2_ENABLED: "1" },
    { AYIN_UPLOAD_RECOVERY_AUDIENCE: "all" },
  ])
    assert.throws(
      () => validateActivation({ ...env, ...patch }, baseline, false),
      /ISSUANCE_NOT_CLOSED/,
    );
  assert.throws(
    () => validateActivation({}, baseline, false),
    /ISSUANCE_NOT_CLOSED/,
  );
  assert.throws(
    () => validateActivation(env, baseline, true),
    /ACTIVATION_ALREADY_RESERVED/,
  );
});
test("disable only revokes issuance and preserves unrelated configuration and debt bounds", () => {
  const before =
    "DATABASE_URL=synthetic\nAYIN_UPLOAD_RECOVERY_V2_ENABLED=1\nAYIN_UPLOAD_RECOVERY_DEBT_ACCOUNT_BYTES=43486543872\nKEEP_ME=yes\n";
  assert.equal(
    patchEnv(before, { AYIN_UPLOAD_RECOVERY_V2_ENABLED: "0" }),
    before.replace("V2_ENABLED=1", "V2_ENABLED=0"),
  );
  assert.throws(
    () => patchEnv("X=1\nexport X=2\n", { X: "3" }),
    /DUPLICATE_SETTING/,
  );
});
