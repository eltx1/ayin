#!/usr/bin/env node
// One fixed continuation only. Private SSH output and browser grants never become logs.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RUN_ID,
  PREFIX,
  CLEANUP_ACK,
  LINE_BYTES,
  ProofFailure,
  checked,
  bounded,
} from "./r2-owned-fixture-provider.mjs";
import {
  PLAN as ORIGINAL_PLAN,
  validateReady,
  validateGrant,
  performBrowserPut,
  driverFailureSummary as originalFailureSummary,
} from "./r2-owned-fixture-browser.mjs";
import {
  parseContinuationArguments,
  validateContinuationApproval,
  validateContinuationProof,
  toolingFileHashes,
} from "./r2-owned-continuation-provider.mjs";

export const PLAN = Object.freeze(ORIGINAL_PLAN.slice(2));
const PHASES = new Set([
  "approval",
  "browser-startup",
  "browser-origin",
  "ssh",
  "remote-ready",
  "remote-startup",
  "protocol-input",
  "protocol-completion",
  "grant-validation",
  "browser-put",
  "browser-reply",
  "proof-validation",
  "proof-artifact",
  "browser-close",
  "whole-run",
]);
class DriverFailure extends ProofFailure {
  constructor(phase, error) {
    const summary = originalFailureSummary(error);
    super(summary.code);
    // Reuse the original browser's bounded observations without copying raw exceptions.
    this.summary =
      summary.phase !== "driver"
        ? summary
        : { phase: PHASES.has(phase) ? phase : "driver", code: summary.code };
  }
}
export function driverFailureSummary(error) {
  return error instanceof DriverFailure ? error.summary : originalFailureSummary(error);
}
async function inPhase(phase, work) {
  try {
    return await work();
  } catch (error) {
    throw error instanceof DriverFailure ? error : new DriverFailure(phase, error);
  }
}
export function validateContinuationGrant(grant, sequence, origin, now = Date.now()) {
  checked(
    Number.isInteger(sequence) && sequence >= 1 && sequence <= 3 && grant?.seq === sequence,
    "INVALID_GRANT_SEQUENCE",
  );
  validateGrant({ ...grant, seq: sequence + 2 }, sequence + 2, origin, now);
  return grant;
}
function validateReply(reply, sequence) {
  checked(
    reply?.type === "put-result" &&
      reply.seq === sequence &&
      Object.keys(reply).sort().join(",") === "errorCode,outcome,seq,status,type" &&
      ["http", "timeout", "network-error"].includes(reply.outcome) &&
      (reply.outcome === "http"
        ? Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599
        : reply.status === null) &&
      (reply.errorCode === null || reply.errorCode === "SignatureDoesNotMatch"),
    "INVALID_BROWSER_REPLY",
  );
  return reply;
}
export function sshArguments(options, home = homedir()) {
  validateContinuationApproval(options);
  const flags = `--execute-approved --execute-continuation-approved --run-id ${RUN_ID} --confirm-prefix ${PREFIX} --ack-cleanup ${CLEANUP_ACK} --release-sha ${options.releaseSha} --tooling-sha ${options.toolingSha}`;
  const command = `set -eu; test "$(whoami)" = ayin; test "$HOME" = /home/ayin; test -w /home/ayin/htdocs/releases; test -w /home/ayin/env; test ! -w /home/horusapp; cd /home/ayin/htdocs/current; test "$(git rev-parse HEAD)" = '${options.releaseSha}'; exec node deploy/run-with-env.cjs /home/ayin/env/api.env node /home/ayin/.r2-acceptance-tooling/${options.toolingSha}/r2-owned-continuation-provider.mjs ${flags}`;
  return [
    "-F",
    "/dev/null",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    `IdentityFile=${home}/.ssh/id_ed25519`,
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${home}/.ssh/known_hosts`,
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    "22",
    "ayin@13.52.116.200",
    command,
  ];
}
export async function driveProtocol(
  child,
  options,
  put,
  { timeoutMs = 600_000, signal, toolingFiles = toolingFileHashes() } = {},
) {
  validateContinuationApproval(options);
  let buffer = Buffer.alloc(0),
    origin,
    seq = 0,
    replies = 0,
    positiveReplies = 0,
    proof;
  let stopped = false,
    processing = false,
    closed = false,
    closeCode,
    receivedProof = false;
  let outstandingGrants = 0,
    stderrBytes = 0,
    phase = "remote-ready";
  const queue = [];
  let resolveProtocol, rejectProtocol;
  const result = new Promise((done, reject) => {
    resolveProtocol = done;
    rejectProtocol = reject;
  });
  const fail = (error, failedPhase = phase) => {
    if (stopped) return;
    stopped = true;
    queue.length = 0;
    buffer = Buffer.alloc(0);
    child.kill("SIGTERM");
    rejectProtocol(error instanceof DriverFailure ? error : new DriverFailure(failedPhase, error));
  };
  const finish = () => {
    if (!closed || stopped || processing || queue.length) return;
    if (buffer.length || !origin || !proof) {
      fail(
        new ProofFailure(
          buffer.length
            ? "STDIO_TRUNCATED_LINE"
            : !origin
              ? "REMOTE_CLOSED_BEFORE_READY"
              : "REMOTE_CLOSED_WITHOUT_PROOF",
        ),
      );
      return;
    }
    if (
      !Number.isInteger(closeCode) ||
      closeCode < 0 ||
      (closeCode === 0) !== (proof.status === "OBSERVATIONS_PASSED")
    ) {
      fail(new ProofFailure("REMOTE_EXIT_PROOF_MISMATCH"), "protocol-completion");
      return;
    }
    stopped = true;
    resolveProtocol(proof);
  };
  const pump = async () => {
    if (processing || stopped) return;
    processing = true;
    try {
      while (queue.length && !stopped) {
        const message = queue.shift();
        if (!origin) {
          origin = validateReady(message, options.releaseSha);
          phase = "remote-startup";
        } else if (message.type === "grant") {
          phase = "grant-validation";
          checked(!proof && !closed, "GRANT_AFTER_PROOF_OR_EOF");
          validateContinuationGrant(message, ++seq, origin);
          phase = "browser-put";
          const reply = await put(message);
          // A timeout, EOF or protocol error may have arrived while PUT was pending.
          if (stopped) return;
          phase = "browser-reply";
          checked(child.stdin.writable && !closed, "REMOTE_PIPE_CLOSED");
          validateReply(reply, seq);
          outstandingGrants--;
          replies++;
          if (reply.outcome === "http" && reply.status === 200 && reply.errorCode === null)
            positiveReplies++;
          child.stdin.write(JSON.stringify(reply) + "\n");
          phase = "protocol-input";
        } else {
          phase = "proof-validation";
          checked(!proof && outstandingGrants === 0, "UNEXPECTED_PROOF");
          proof = validateContinuationProof(
            message,
            options.releaseSha,
            options.toolingSha,
            toolingFiles,
          );
          if (proof.status === "OBSERVATIONS_PASSED")
            checked(
              seq === 3 && replies === 3 && positiveReplies === 3,
              "INCOMPLETE_CONTINUATION_GRANTS",
            );
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      processing = false;
      finish();
    }
  };
  // Install every child/stream listener synchronously before the first await.
  child.on("error", (error) => fail(error, "ssh"));
  child.stdin.on("error", () => fail(new ProofFailure("REMOTE_PIPE_CLOSED"), "browser-reply"));
  child.stdout.on("error", (error) => fail(error, "protocol-input"));
  child.stderr.on("error", (error) => fail(error, "protocol-input"));
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > LINE_BYTES) fail(new ProofFailure("STDIO_STDERR_LIMIT"), "protocol-input");
  });
  child.stdout.on("data", (chunk) => {
    if (stopped) return;
    if (buffer.length + chunk.length > LINE_BYTES * 3) {
      fail(new ProofFailure("STDIO_BUFFER_LIMIT"), "protocol-input");
      return;
    }
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    try {
      while (buffer.includes(10)) {
        const end = buffer.indexOf(10);
        checked(end > 0 && end <= LINE_BYTES, "STDIO_LINE_LIMIT");
        const message = JSON.parse(buffer.subarray(0, end).toString("utf8"));
        buffer = buffer.subarray(end + 1);
        checked(
          message && typeof message === "object" && !Array.isArray(message),
          "INVALID_REMOTE_MESSAGE",
        );
        checked(!receivedProof, "MESSAGE_AFTER_PROOF");
        if (message.type === "grant") {
          checked(outstandingGrants === 0, "UNSOLICITED_OR_DUPLICATE_GRANT");
          outstandingGrants++;
        } else if (message.type === "continuation-proof") {
          checked(outstandingGrants === 0, "PROOF_BEFORE_BROWSER_REPLY");
          receivedProof = true;
        }
        queue.push(message);
        checked(queue.length <= 3, "STDIO_QUEUE_LIMIT");
      }
      checked(buffer.length <= LINE_BYTES, "STDIO_LINE_LIMIT");
      void pump();
    } catch (error) {
      fail(error, "protocol-input");
    }
  });
  child.on("close", (code) => {
    closed = true;
    closeCode = code;
    if (outstandingGrants) fail(new ProofFailure("REMOTE_PIPE_CLOSED"), "browser-reply");
    else finish();
  });
  const abort = () => fail(new ProofFailure("BOUNDED_TIMEOUT"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, Math.min(timeoutMs, 600_000));
  try {
    return await result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}
export async function driveSsh(options, put, spawnProcess = spawn, limits = {}) {
  return inPhase("ssh", () => {
    const toolingFiles = toolingFileHashes();
    const child = spawnProcess("ssh", sshArguments(options), {
      env: { PATH: process.env.PATH, HOME: homedir(), LANG: "C.UTF-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return driveProtocol(child, options, put, { ...limits, toolingFiles });
  });
}
export async function runBrowserContinuation(
  options,
  chromium,
  { spawnProcess = spawn, timeoutMs = 600_000 } = {},
) {
  validateContinuationApproval(options);
  return inPhase("whole-run", () =>
    bounded(
      async (signal) => {
        const browser = await inPhase("browser-startup", () => chromium.launch({ headless: true }));
        const stopBrowser = () => {
          void browser.close().catch(() => undefined);
        };
        signal.addEventListener("abort", stopBrowser, { once: true });
        let context, page;
        const active = () => checked(!signal.aborted, "BOUNDED_TIMEOUT");
        const freshOrigin = () =>
          inPhase("browser-origin", async () => {
            active();
            if (context) await context.close();
            active();
            context = await browser.newContext({ serviceWorkers: "block" });
            active();
            page = await context.newPage();
            active();
            const response = await page.goto("https://ayin.stream/", {
              waitUntil: "domcontentloaded",
              timeout: 30_000,
            });
            active();
            checked(
              response?.status() === 200 && new URL(page.url()).origin === "https://ayin.stream",
              "AYIN_ORIGIN_NOT_REACHABLE",
            );
          });
        try {
          active();
          await freshOrigin();
          return await driveSsh(
            options,
            async (grant) => {
              active();
              if (grant.seq === 2) await freshOrigin();
              active();
              return performBrowserPut(page, grant);
            },
            spawnProcess,
            { signal },
          );
        } finally {
          signal.removeEventListener("abort", stopBrowser);
          await inPhase("browser-close", () => bounded(() => browser.close(), 10_000));
        }
      },
      Math.min(timeoutMs, 600_000),
    ),
  );
}
async function main() {
  const options = await inPhase("approval", () =>
    parseContinuationArguments(process.argv.slice(2)),
  );
  const { chromium } = await inPhase("browser-startup", () => import("@playwright/test"));
  const proof = await runBrowserContinuation(options, chromium);
  await inPhase("proof-artifact", () =>
    writeFileSync("owned-r2-continuation-proof.json", JSON.stringify(proof, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    }),
  );
  process.stdout.write(
    `Remaining-fixture continuation: ${proof.status}; original acceptance remains FAILED. See sanitized continuation proof artifact.\n`,
  );
  process.exitCode = proof.status === "OBSERVATIONS_PASSED" ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const failure = driverFailureSummary(error);
    const browser = failure.browser ? ` browser=${JSON.stringify(failure.browser)}` : "";
    process.stdout.write(
      `Owned-fixture continuation stopped: phase=${failure.phase} code=${failure.code}${browser}. Original acceptance remains FAILED; review retained manifests before further action.\n`,
    );
    process.exitCode = 1;
  });
}
