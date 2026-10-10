import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const mode = process.argv[2];
if (
  ![
    "enable",
    "resume",
    "disable",
    "inspect",
    "verify",
    "observe",
    "retry_cleanup",
    "cancel_enable",
  ].includes(mode)
)
  throw new Error("Explicit canary mode required");
const dir = dirname(fileURLToPath(import.meta.url));
const key = join(homedir(), ".ssh/id_ed25519");
const known = join(homedir(), ".ssh/known_hosts");
if (!existsSync(key) || !existsSync(known))
  throw new Error("Existing pinned deployment identity required");
const lookup = spawnSync("ssh-keygen", ["-F", "13.52.116.200", "-f", known], {
  encoding: "utf8",
  timeout: 3000,
  maxBuffer: 16384,
  stdio: ["ignore", "pipe", "pipe"],
});
const lines = (lookup.stdout ?? "").split("\n").filter((line) => line && !line.startsWith("#"));
if (lookup.status !== 0 || lines.length !== 1 || !lines[0].includes(" ssh-ed25519 "))
  throw new Error("Pinned entry unavailable");
const fingerprint =
  "SHA256:" +
  createHash("sha256")
    .update(Buffer.from(lines[0].split(/\s+/)[2], "base64"))
    .digest("base64")
    .replace(/=+$/, "");
if (fingerprint !== "SHA256:YoUNEx7Aizhzl99TReL4kGCyUY6KopzrPuPgRmhDC0Y")
  throw new Error("Pinned identity mismatch");
const remote = `set -eu; test "$(whoami)" = ayin; test "$HOME" = /home/ayin; cd /home/ayin/htdocs/current; test "$(git rev-parse HEAD)" = ab8355f3c45e5208ef9fe6477666b8f834c231b4; exec flock -w 5 /home/ayin/.deploy.lock timeout --kill-after=5s 250s node --input-type=module - ${mode}`;
const result = spawnSync(
  "ssh",
  [
    "-T",
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `IdentityFile=${key}`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${known}`,
    "-o",
    "GlobalKnownHostsFile=/dev/null",
    "-o",
    "HostKeyAlgorithms=ssh-ed25519",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "LogLevel=ERROR",
    "-p",
    "22",
    "ayin@13.52.116.200",
    remote,
  ],
  {
    input: readFileSync(join(dir, "runtime.mjs")),
    encoding: "utf8",
    timeout: 270000,
    killSignal: "SIGKILL",
    maxBuffer: 65536,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
let proof;
try {
  proof = JSON.parse(result.stdout);
} catch {
  throw new Error("Sanitized result unavailable; do not retry activation blindly");
}
const safe = Object.entries(proof).every(
  ([key, value]) =>
    /^[a-zA-Z][a-zA-Z0-9]{0,80}$/.test(key) &&
    (typeof value === "boolean" ||
      (typeof value === "number" && Number.isSafeInteger(value)) ||
      (typeof value === "string" && /^[a-zA-Z0-9_]{1,70}$/.test(value))),
);
if (
  !safe ||
  (["verify", "observe"].includes(mode)
    ? proof.providerRequests < 0 || proof.providerRequests > (mode === "observe" ? 1 : 6)
    : proof.providerRequests !== 0) ||
  proof.deletions !== 0 ||
  (mode === "retry_cleanup" ? ![0, 1].includes(proof.databaseWrites) : proof.databaseWrites !== 0)
)
  throw new Error("Unexpected result; inspect before continuing");
process.stdout.write(JSON.stringify(proof, null, 2) + "\n");
if (result.status !== 0 || proof.status !== "VERIFIED") process.exitCode = 2;
