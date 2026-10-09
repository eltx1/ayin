#!/usr/bin/env node
// No credentials, grant URLs, request headers, traces, screenshots or raw child
// output are written to logs/artifacts. SSH stdout is a private bounded protocol.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BUCKET,
  RUN_ID,
  PREFIX,
  FIXTURES,
  PART_BYTES,
  LINE_BYTES,
  CLEANUP_ACK,
  ProofFailure,
  checked,
  bounded,
  parseArguments,
  validateApproval,
  safeCode,
} from "./r2-owned-fixture-provider.mjs";

const FAILURE_PHASES = new Set([
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
  "browser-request",
  "browser-headers",
  "browser-response",
  "browser-reply",
  "proof-validation",
  "proof-artifact",
  "browser-close",
]);
class DriverFailure extends ProofFailure {
  constructor(phase, error, observations) {
    super(safeCode(error));
    this.phase = FAILURE_PHASES.has(phase) ? phase : "driver";
    if (observations) this.browser = safeBrowserObservations(observations);
  }
}
function safeBrowserObservations(observations) {
  const status = (value) =>
    Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
  return {
    outcome: ["http", "timeout", "network-error"].includes(observations.outcome)
      ? observations.outcome
      : null,
    pageStatus: status(observations.pageStatus),
    networkStatus: status(observations.networkStatus),
    corsOriginHeaderMatches:
      typeof observations.corsOriginHeaderMatches === "boolean"
        ? observations.corsOriginHeaderMatches
        : null,
  };
}
async function inPhase(phase, work, observations) {
  try {
    return await work();
  } catch (error) {
    throw error instanceof DriverFailure ? error : new DriverFailure(phase, error, observations);
  }
}
export function driverFailureSummary(error) {
  const summary = {
    phase:
      error instanceof DriverFailure && FAILURE_PHASES.has(error.phase) ? error.phase : "driver",
    code: safeCode(error),
  };
  if (error instanceof DriverFailure && error.browser)
    summary.browser = safeBrowserObservations(error.browser);
  return summary;
}

export const PLAN = Object.freeze([
  { fixture: "small.bin", partNumber: 1, expectedSizeBytes: 38, payloadSizeBytes: 39, offset: 0 },
  { fixture: "small.bin", partNumber: 1, expectedSizeBytes: 38, payloadSizeBytes: 38, offset: 0 },
  {
    fixture: "multipart.bin",
    partNumber: 1,
    expectedSizeBytes: PART_BYTES,
    payloadSizeBytes: PART_BYTES,
    offset: 0,
  },
  {
    fixture: "multipart.bin",
    partNumber: 2,
    expectedSizeBytes: 17,
    payloadSizeBytes: 17,
    offset: PART_BYTES,
  },
  {
    fixture: "abort.bin",
    partNumber: 1,
    expectedSizeBytes: PART_BYTES,
    payloadSizeBytes: PART_BYTES,
    offset: 0,
  },
]);
export function validateReady(message, releaseSha) {
  checked(
    message?.type === "ready" &&
      Object.keys(message).sort().join(",") === "r2Origin,releaseSha,type" &&
      message.releaseSha === releaseSha &&
      /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(message.r2Origin),
    "INVALID_REMOTE_READY",
  );
  return message.r2Origin;
}
export function validateGrant(grant, sequence, origin, now = Date.now()) {
  checked(
    Object.keys(grant ?? {})
      .sort()
      .join(",") ===
      "expectedSizeBytes,expiresAt,fixture,offset,partNumber,payloadSizeBytes,seq,type,url",
    "INVALID_GRANT_SHAPE",
  );
  checked(
    grant.type === "grant" && grant.seq === sequence && sequence >= 1 && sequence <= PLAN.length,
    "INVALID_GRANT_SEQUENCE",
  );
  for (const [field, expected] of Object.entries(PLAN[sequence - 1]))
    checked(grant[field] === expected, "OUT_OF_SCOPE_GRANT");
  checked(typeof grant.url === "string" && grant.url.length <= 8192, "INVALID_GRANT_URL");
  const url = new URL(grant.url);
  checked(
    url.origin === origin &&
      /^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(origin) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === `/${BUCKET}/${PREFIX}${grant.fixture}`,
    "OUT_OF_SCOPE_GRANT_TARGET",
  );
  const queryNames = [
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-Signature",
    "X-Amz-SignedHeaders",
    "partNumber",
    "uploadId",
  ]
    .sort()
    .join(",");
  checked(
    [...url.searchParams.keys()].sort().join(",") === queryNames &&
      url.searchParams.get("partNumber") === String(grant.partNumber) &&
      /^[\x21-\x7e]{1,1024}$/.test(url.searchParams.get("uploadId") ?? "") &&
      url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256" &&
      url.searchParams.get("X-Amz-SignedHeaders") === "content-length;host" &&
      url.searchParams.get("X-Amz-Expires") === "90" &&
      /^[a-f0-9]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? "") &&
      /^[A-Za-z0-9]{16,128}\/\d{8}\/auto\/s3\/aws4_request$/.test(
        url.searchParams.get("X-Amz-Credential") ?? "",
      ),
    "INVALID_SIGNED_GRANT",
  );
  const date = url.searchParams.get("X-Amz-Date") ?? "";
  checked(/^\d{8}T\d{6}Z$/.test(date), "INVALID_GRANT_TIME");
  const issued = Date.parse(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`,
  );
  const expires = Date.parse(grant.expiresAt);
  checked(
    Number.isFinite(expires) &&
      expires > now + 5000 &&
      expires <= now + 100_000 &&
      Math.abs(expires - issued - 90_000) < 1000,
    "EXPIRED_OR_INVALID_GRANT",
  );
  return grant;
}
export async function performBrowserPut(page, grant) {
  checked(new URL(page.url()).origin === "https://ayin.stream", "AYIN_ORIGIN_REQUIRED");
  const observations = {};
  const requestPromise = page.waitForRequest(
    (request) => request.url() === grant.url && request.method() === "PUT",
    { timeout: 45_000 },
  );
  // Consume rejected waiter even when evaluation fails before issuing the request.
  void requestPromise.catch(() => undefined);
  const result = await bounded(
    () =>
      page.evaluate(async (input) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          const bytes = Uint8Array.from(
            { length: input.payloadSizeBytes },
            (_, i) => ((input.offset + i) * 31 + 17) & 255,
          );
          const response = await fetch(input.url, {
            method: "PUT",
            body: new Blob([bytes]),
            mode: "cors",
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
          });
          let text = "",
            count = 0;
          if (response.body) {
            const reader = response.body.getReader();
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                count += next.value.byteLength;
                if (count > 16_384) throw new Error("bounded");
                text += new TextDecoder().decode(next.value);
              }
            } finally {
              void reader.cancel().catch(() => undefined);
            }
          }
          if (response.status === 200) {
            const etag = response.headers.get("etag");
            if (!etag || etag.length > 256 || !/^"[^"\s]+"$/.test(etag))
              throw new Error("visible ETag required");
          }
          return {
            type: "put-result",
            seq: input.seq,
            outcome: "http",
            status: response.status,
            errorCode: /<Code>SignatureDoesNotMatch<\/Code>/.test(text)
              ? "SignatureDoesNotMatch"
              : null,
          };
        } catch {
          return {
            type: "put-result",
            seq: input.seq,
            outcome: controller.signal.aborted ? "timeout" : "network-error",
            status: null,
            errorCode: null,
          };
        } finally {
          clearTimeout(timer);
        }
      }, grant),
    45_000,
  ).catch((error) => {
    throw new DriverFailure("browser-put", error, observations);
  });
  observations.outcome = result.outcome;
  observations.pageStatus = result.status;
  const request = await inPhase("browser-request", () => requestPromise, observations);
  await inPhase(
    "browser-headers",
    async () => {
      const headers = await bounded(() => request.allHeaders(), 5000);
      checked(
        headers["content-length"] === String(grant.payloadSizeBytes) &&
          headers.origin === "https://ayin.stream" &&
          !headers.authorization &&
          !headers.cookie &&
          request.resourceType() === "fetch" &&
          !request.redirectedFrom(),
        "BROWSER_NETWORK_HEADERS_NOT_VERIFIED",
      );
    },
    observations,
  );
  await inPhase(
    "browser-response",
    async () => {
      const response = await bounded(() => request.response(), 5000);
      if (response) {
        observations.networkStatus = response.status();
        try {
          const allowOrigin = response.headers()["access-control-allow-origin"];
          observations.corsOriginHeaderMatches =
            allowOrigin === "*" || allowOrigin === "https://ayin.stream";
        } catch {
          // Missing diagnostic headers are inconclusive and never replace validation.
        }
      }
      checked(
        response &&
          !response.fromServiceWorker() &&
          response.status() === result.status &&
          response.url() === grant.url,
        "BROWSER_NETWORK_RESPONSE_NOT_VERIFIED",
      );
    },
    observations,
  );
  // Only this allowlisted result crosses back to the credential-bearing server.
  return result;
}
export function sshArguments(options, home = homedir()) {
  validateApproval(options);
  const flags = `--execute-approved --run-id ${RUN_ID} --confirm-prefix ${PREFIX} --ack-cleanup ${CLEANUP_ACK} --release-sha ${options.releaseSha}`;
  const command = `set -eu; test "$(whoami)" = ayin; test "$HOME" = /home/ayin; test -w /home/ayin/htdocs/releases; test -w /home/ayin/env; test ! -w /home/horusapp; cd /home/ayin/htdocs/current; test "$(git rev-parse HEAD)" = '${options.releaseSha}'; exec node deploy/run-with-env.cjs /home/ayin/env/api.env node deploy/media/r2-owned-fixture-provider.mjs ${flags}`;
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
export function validatePublicProof(message, releaseSha) {
  checked(
    message?.type === "proof" &&
      message.runId === RUN_ID &&
      message.releaseSha === releaseSha &&
      message.bucket === BUCKET &&
      message.prefix === PREFIX &&
      message.observationsOnly === true &&
      message.activationEnabled === false &&
      message.maxRetainedBytes === 10_485_815 &&
      ["OBSERVATIONS_PASSED", "FAILED"].includes(message.status),
    "INVALID_REMOTE_PROOF",
  );
  checked(message.code === null || /^[A-Z_]{1,80}$/.test(message.code), "INVALID_REMOTE_PROOF");
  const stages = new Set([
    "reserved",
    "signature-capability-verified",
    "all-exact-keys-clear",
    "wrong-length-put-dispatched",
    "wrong-length-provider-rejected-with-no-part",
    "part-1-put-dispatched",
    "part-2-put-dispatched",
    "resume-authoritative-part-one-observed",
    "direct-get-sha256-and-ayin-root-verified",
    "abort-and-absence-observed",
    "owned-object-deletion-and-absence-observed",
  ]);
  checked(
    stages.has(message.stage) && Array.isArray(message.fixtures) && message.fixtures.length === 3,
    "INVALID_REMOTE_PROOF",
  );
  const fixtures = message.fixtures.map((record, i) => {
    checked(
      record.name === FIXTURES[i].name &&
        record.key === PREFIX + record.name &&
        record.size === FIXTURES[i].size &&
        typeof record.allocationKnown === "boolean" &&
        typeof record.debt === "boolean" &&
        Array.isArray(record.stages) &&
        record.stages.length <= 16 &&
        record.stages.every((stage) => stages.has(stage)),
      "INVALID_REMOTE_PROOF",
    );
    for (const state of [record.create, record.complete, record.abort, record.deletion])
      checked(
        [
          "not-dispatched",
          "dispatched-unknown",
          "acknowledged",
          "acknowledged-receipt-discarded",
        ].includes(state),
        "INVALID_REMOTE_PROOF",
      );
    return {
      name: record.name,
      key: record.key,
      size: record.size,
      allocationKnown: record.allocationKnown,
      create: record.create,
      complete: record.complete,
      abort: record.abort,
      deletion: record.deletion,
      debt: record.debt,
      stages: record.stages,
    };
  });
  if (message.status === "OBSERVATIONS_PASSED") {
    checked(
      message.code === null &&
        fixtures.every((f) => f.create === "acknowledged" && f.allocationKnown && !f.debt),
      "INCOMPLETE_SUCCESS_PROOF",
    );
    checked(
      fixtures[0].complete === "acknowledged" &&
        fixtures[1].complete === "acknowledged-receipt-discarded" &&
        fixtures[0].deletion === "acknowledged" &&
        fixtures[1].deletion === "acknowledged" &&
        fixtures[2].abort === "acknowledged" &&
        fixtures[2].complete === "not-dispatched" &&
        fixtures[2].deletion === "not-dispatched",
      "INCOMPLETE_SUCCESS_PROOF",
    );
    checked(
      fixtures[0].stages.includes("wrong-length-provider-rejected-with-no-part") &&
        fixtures[1].stages.includes("resume-authoritative-part-one-observed") &&
        fixtures
          .slice(0, 2)
          .every(
            (f) =>
              f.stages.includes("direct-get-sha256-and-ayin-root-verified") &&
              f.stages.includes("owned-object-deletion-and-absence-observed"),
          ) &&
        fixtures[2].stages.includes("abort-and-absence-observed"),
      "INCOMPLETE_SUCCESS_PROOF",
    );
  }
  // Reconstruct, rather than spread, so secret-bearing unexpected fields disappear.
  return {
    schema: 1,
    type: "proof",
    runId: RUN_ID,
    releaseSha,
    bucket: BUCKET,
    prefix: PREFIX,
    observationsOnly: true,
    activationEnabled: false,
    maxRetainedBytes: 10_485_815,
    status: message.status,
    stage: message.stage,
    code: message.code,
    fixtures,
  };
}
export async function driveProtocol(child, options, put, { timeoutMs = 600_000 } = {}) {
  validateApproval(options);
  let buffer = Buffer.alloc(0),
    origin,
    seq = 0,
    proof,
    failure = false,
    processing = false,
    stderrBytes = 0;
  let closed = false,
    closeCode,
    outstandingGrants = 0,
    phase = "remote-ready";
  const queue = [];
  let rejectProtocol, resolveProtocol;
  const result = new Promise((resolveResult, reject) => {
    resolveProtocol = resolveResult;
    rejectProtocol = reject;
  });
  const fail = (error, failedPhase = phase) => {
    if (failure) return;
    failure = true;
    child.kill("SIGTERM");
    rejectProtocol(error instanceof DriverFailure ? error : new DriverFailure(failedPhase, error));
  };
  const finish = () => {
    if (!closed || processing || queue.length || failure) return;
    if (buffer.length || !origin || !proof) {
      const code = buffer.length
        ? "STDIO_TRUNCATED_LINE"
        : !origin
          ? "REMOTE_CLOSED_BEFORE_READY"
          : "REMOTE_CLOSED_WITHOUT_PROOF";
      fail(new ProofFailure(code));
      return;
    }
    if (
      (closeCode === 0) !== (proof.status === "OBSERVATIONS_PASSED") ||
      (closeCode === 0 && seq !== PLAN.length)
    ) {
      fail(new ProofFailure("REMOTE_EXIT_PROOF_MISMATCH"), "protocol-completion");
      return;
    }
    resolveProtocol(proof);
  };
  const pump = async () => {
    if (processing || failure) return;
    processing = true;
    try {
      while (queue.length) {
        const message = queue.shift();
        // This fixed startup diagnostic is not absence evidence or permission to replay.
        if (
          origin &&
          seq === 0 &&
          !proof &&
          !closed &&
          outstandingGrants === 0 &&
          message?.type === "failure" &&
          message.code === "UNSAFE_MANIFEST_PARENT" &&
          Object.keys(message).sort().join(",") === "code,type"
        ) {
          fail(new ProofFailure("UNSAFE_MANIFEST_PARENT"), "remote-startup");
          return;
        }
        if (!origin) {
          origin = validateReady(message, options.releaseSha);
          phase = "remote-startup";
          continue;
        }
        if (message.type === "grant") {
          phase = "grant-validation";
          checked(!proof && !closed, "GRANT_AFTER_PROOF_OR_EOF");
          validateGrant(message, ++seq, origin);
          phase = "browser-put";
          const reply = await put(message);
          phase = "browser-reply";
          checked(child.stdin.writable && !failure && !closed, "REMOTE_PIPE_CLOSED");
          outstandingGrants--;
          child.stdin.write(JSON.stringify(reply) + "\n");
          phase = "protocol-input";
        } else {
          phase = "proof-validation";
          checked(!proof, "DUPLICATE_PROOF");
          proof = validatePublicProof(message, options.releaseSha);
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      processing = false;
      finish();
    }
  };
  child.on("error", (error) => fail(error, "ssh"));
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > LINE_BYTES) fail(new ProofFailure("STDIO_STDERR_LIMIT"), "protocol-input");
  });
  child.stdout.on("data", (chunk) => {
    if (failure) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > LINE_BYTES * 3) {
      fail(new ProofFailure("STDIO_BUFFER_LIMIT"), "protocol-input");
      return;
    }
    try {
      while (buffer.includes(10)) {
        const end = buffer.indexOf(10);
        checked(end > 0 && end <= LINE_BYTES, "STDIO_LINE_LIMIT");
        const message = JSON.parse(buffer.subarray(0, end).toString("utf8"));
        buffer = buffer.subarray(end + 1);
        if (message.type === "grant") {
          checked(outstandingGrants === 0, "UNSOLICITED_OR_DUPLICATE_GRANT");
          outstandingGrants++;
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
    finish();
  });
  try {
    return await bounded(() => result, timeoutMs);
  } catch (error) {
    throw error instanceof DriverFailure ? error : new DriverFailure(phase, error);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

export async function driveSsh(options, put, spawnProcess = spawn) {
  try {
    // Attach error/protocol handlers synchronously before yielding after spawn.
    const child = spawnProcess("ssh", sshArguments(options), {
      env: { PATH: process.env.PATH, HOME: homedir(), LANG: "C.UTF-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => undefined);
    return await driveProtocol(child, options, put);
  } catch (error) {
    throw error instanceof DriverFailure ? error : new DriverFailure("ssh", error);
  }
}

async function main() {
  const options = await inPhase("approval", () => parseArguments(process.argv.slice(2)));
  // Import/start Chromium only after exact approval/scope checks. No storage state.
  const { chromium } = await inPhase("browser-startup", () => import("@playwright/test"));
  const browser = await inPhase("browser-startup", () => chromium.launch({ headless: true }));
  let context, page;
  const freshOrigin = () =>
    inPhase("browser-origin", async () => {
      if (context) await context.close();
      context = await browser.newContext({ serviceWorkers: "block" });
      page = await context.newPage();
      const response = await page.goto("https://ayin.stream/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      checked(
        response?.status() === 200 && new URL(page.url()).origin === "https://ayin.stream",
        "AYIN_ORIGIN_NOT_REACHABLE",
      );
    });
  try {
    await freshOrigin();
    const proof = await driveSsh(options, async (grant) => {
      if (grant.seq === 4) await freshOrigin();
      return performBrowserPut(page, grant);
    });
    await inPhase("proof-artifact", () =>
      writeFileSync("owned-r2-proof.json", JSON.stringify(proof, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      }),
    );
    process.stdout.write(
      `Owned-fixture observations: ${proof.status}. See sanitized proof artifact.\n`,
    );
    process.exitCode = proof.status === "OBSERVATIONS_PASSED" ? 0 : 1;
  } finally {
    await inPhase("browser-close", () => browser.close());
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const failure = driverFailureSummary(error);
    const browser = failure.browser ? ` browser=${JSON.stringify(failure.browser)}` : "";
    process.stdout.write(
      `Owned-fixture acceptance stopped: phase=${failure.phase} code=${failure.code}${browser}. Review the retained remote manifest before any further action.\n`,
    );
    process.exitCode = 1;
  });
}
