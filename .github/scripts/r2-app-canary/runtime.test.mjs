import test from "node:test";
import assert from "node:assert/strict";
import { patchEnv } from "./runtime.mjs";
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
