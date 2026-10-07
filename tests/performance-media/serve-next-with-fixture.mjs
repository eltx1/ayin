// Dedicated test process only. Never imported by the application or deployed.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  process.env.APP_ENV !== "test" ||
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  database.pathname !== "/ayin_e2e"
)
  throw new Error("Native media server requires APP_ENV=test and isolated local ayin_e2e");
const root = process.cwd(),
  web = path.join(root, "apps/web");
const directory = path.join(web, "public/__ayin_native_runtime_lab__");
const target = path.join(directory, "clips-viewport.webm");
const bytes = await readFile(path.join(root, "tests/e2e/fixtures/clips-viewport.webm"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const expected = digest(bytes);
async function cleanup() {
  // Verify ownership/content again before removing only our generated object.
  if (digest(await readFile(target)) !== expected)
    throw new Error("Synthetic media changed; cleanup refused");
  await unlink(target);
  await rmdir(directory);
  console.log(`NATIVE_LAB_MEDIA_CLEANED sha256=${expected}`);
}
// Refuse an existing directory instead of overwriting an unknown local file.
await mkdir(directory);
try {
  await writeFile(target, bytes, { flag: "wx" });
  if (digest(await readFile(target)) !== expected)
    throw new Error("Synthetic media staging mismatch");
  console.log(`NATIVE_LAB_MEDIA_READY sha256=${expected}`);
  const requireWeb = createRequire(path.join(web, "package.json"));
  const child = spawn(
    process.execPath,
    [requireWeb.resolve("next/dist/bin/next"), "start", "--hostname", "0.0.0.0"],
    { cwd: web, env: process.env, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve(signal === "SIGINT" || signal === "SIGTERM" ? 0 : (code ?? 1)),
    );
  });
  process.exitCode = code;
} finally {
  await cleanup();
}
