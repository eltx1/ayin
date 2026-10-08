import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Vitest transforms can hide ESM decorator initialization cycles. Each entry
// gets a fresh native Node module graph after the production TypeScript build.
for (const entry of [
  "media-processing-lifecycle.service",
  "media-upload.service",
  "media-upload-admission",
  "media-output-write-journal",
]) {
  test(`compiled media imports initialize from ${entry}`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
          import assert from "node:assert/strict";
          await import("./apps/api/node_modules/reflect-metadata/Reflect.js");
          await import(${JSON.stringify(`./apps/api/dist/media/${entry}.js`)});
          const legacy = await import("./apps/api/dist/media/media-upload.service.js");
          const leaf = await import("./apps/api/dist/media/media-upload-error.js");
          assert.equal(legacy.MediaUploadError, leaf.MediaUploadError);
          const error = new leaf.MediaUploadError("EXAMPLE", "example", 409);
          assert.ok(error instanceof legacy.MediaUploadError);
          assert.equal(error.name, "MediaUploadError");
          assert.equal(error.code, "EXAMPLE");
          assert.equal(error.statusCode, 409);
        `,
      ],
      { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
  });
}
