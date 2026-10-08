import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [releaseSha, archiveArgument] = process.argv.slice(2);
assert.match(releaseSha ?? "", /^[0-9a-f]{40}$/i, "Expected the full validated source SHA");
assert.ok(archiveArgument, "Expected the production Web artifact path");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = resolve(archiveArgument);
const temporary = await mkdtemp(join(tmpdir(), "ayin-web-artifact-smoke-"));
const candidate = join(temporary, "candidate");
let server;
let serverExited;
let worktreeAdded = false;
let logs = "";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repository, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}

try {
  assert.equal(run("git", ["rev-parse", "HEAD"]).toLowerCase(), releaseSha.toLowerCase());
  run("git", ["worktree", "add", "--detach", candidate, releaseSha]);
  worktreeAdded = true;
  // Source/config/public files come from the exact commit in a different directory. Only dependencies
  // are shared with the already-validated CI install; target production still installs its lockfile.
  for (const relative of ["node_modules", "apps/web/node_modules"]) {
    const target = join(candidate, relative);
    await mkdir(target);
    for (const name of await readdir(join(repository, relative))) {
      await symlink(join(repository, relative, name), join(target, name));
    }
  }
  const envFile = join(temporary, "web.env");
  const environment = {
    NODE_ENV: "production",
    NEXT_PUBLIC_API_BASE_URL: "https://api.ayin.stream",
    NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayin.stream",
  };
  await writeFile(
    envFile,
    Object.entries(environment)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
    { mode: 0o600 },
  );
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(archive)) digest.update(bytes);
  run(process.execPath, [
    join(repository, "deploy/web-build-artifact.mjs"),
    "install",
    candidate,
    releaseSha,
    archive,
    digest.digest("hex"),
    envFile,
  ]);

  // Use a released ephemeral loopback port. No production host or API is contacted by this smoke.
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise((resolveClose, reject) =>
    reservation.close((error) => (error ? reject(error) : resolveClose())),
  );
  server = spawn(
    process.execPath,
    [
      join(candidate, "apps/web/node_modules/next/dist/bin/next"),
      "start",
      join(candidate, "apps/web"),
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: candidate,
      env: { PATH: process.env.PATH, ...environment, AYIN_RELEASE_SHA: releaseSha },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverExited = once(server, "exit");
  const collect = (chunk) => {
    logs = `${logs}${chunk}`.slice(-16384);
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60 && server.exitCode === null; attempt++) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      // The new process may not have bound its loopback port yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  assert.ok(ready, `Relocated Web artifact did not start: ${logs}`);
  for (const route of [
    "/",
    "/clips",
    "/upload",
    "/studio",
    "/watch/artifact-smoke",
    "/manifest.webmanifest",
  ]) {
    const response = await fetch(`${origin}${route}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, `Unexpected status for ${route}: ${response.status}`);
    const body = await response.text();
    if (route === "/") {
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /https:\/\/api\.ayin\.stream/,
      );
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /https:\/\/media\.ayin\.stream/,
      );
      assert.ok(response.headers.get("strict-transport-security"));
      const script = body.match(/src="([^"\s]*\/_next\/static\/[^"\s]+\.js[^"\s]*)"/);
      assert.ok(script, "Home page must reference its built static script");
      const assetUrl = new URL(script[1].replaceAll("&amp;", "&"), origin);
      assert.equal(assetUrl.origin, origin, "Smoke must not request external static assets");
      const asset = await fetch(assetUrl, { signal: AbortSignal.timeout(10000) });
      assert.equal(asset.status, 200, "Built static script must be deployable");
      await asset.body?.cancel();
    }
    console.log(`Relocated Web artifact: ${route} returned 200`);
  }
  // Keep the deployment source's public assets separate from the .next archive contract.
  assert.ok((await readFile(join(candidate, "apps/web/.next/BUILD_ID"), "utf8")).trim());
  console.log(`Production Web artifact startup and static-asset smoke passed for ${releaseSha}.`);
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    timer.unref();
    await serverExited;
    clearTimeout(timer);
  }
  if (worktreeAdded) run("git", ["worktree", "remove", "--force", candidate]);
  await rm(temporary, { recursive: true, force: true });
}
