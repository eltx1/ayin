import { performance } from "node:perf_hooks";

const MAX_RESPONSE_BYTES = 1_048_576;
const RELEASE_SHA = /^[0-9a-f]{40}$/i;

export class SyntheticValidationError extends Error {
  constructor(message, classification = "response_validation") {
    super(message);
    this.name = "SyntheticValidationError";
    this.classification = classification;
  }
}

export class NullAlertAdapter {
  name = "none";

  async notify() {
    return { provider: this.name, attempted: false, delivered: false };
  }
}

export async function runConfirmedSyntheticChecks(config, dependencies = {}) {
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? defaultSleep;
  const now = dependencies.now ?? (() => new Date());
  const clock = dependencies.clock ?? (() => performance.now());
  const alertAdapter = dependencies.alertAdapter ?? new NullAlertAdapter();
  const startedAt = now();
  const activeChecks = config.checks.filter((check) => !check.skipReason);
  const skipped = config.checks
    .filter((check) => check.skipReason)
    .map((check) => ({
      id: check.id,
      label: check.label,
      severity: check.severity,
      status: "skipped",
      reason: check.skipReason,
      attempts: [],
    }));

  const firstResults = await Promise.all(
    activeChecks.map((check) => executeCheck(check, config, { fetchImplementation, sleep, clock })),
  );
  const firstFailures = firstResults.filter((result) => result.status === "failed");
  let confirmationResults = [];

  if (firstFailures.length > 0) {
    await sleep(config.confirmationDelayMs);
    const failedIds = new Set(firstFailures.map((result) => result.id));
    confirmationResults = await Promise.all(
      activeChecks
        .filter((check) => failedIds.has(check.id))
        .map((check) => executeCheck(check, config, { fetchImplementation, sleep, clock })),
    );
  }

  const confirmationById = new Map(confirmationResults.map((result) => [result.id, result]));
  const checks = firstResults.map((first) => {
    const confirmation = confirmationById.get(first.id);
    if (!confirmation) return first;
    if (confirmation.status === "passed") {
      return {
        ...confirmation,
        status: "recovered",
        firstFailure: failureSummary(first),
        confirmationAttempts: confirmation.attempts,
      };
    }
    return {
      ...confirmation,
      status: "failed",
      confirmed: true,
      firstFailure: failureSummary(first),
      confirmationAttempts: confirmation.attempts,
    };
  });
  checks.push(...skipped);

  const confirmedFailures = checks.filter(
    (check) => check.status === "failed" && check.confirmed === true,
  );
  const maintenanceActive = isMaintenanceActive(config.maintenanceUntil, now());
  let alert = { provider: alertAdapter.name ?? "unknown", attempted: false, delivered: false };

  if (confirmedFailures.length > 0 && !maintenanceActive) {
    alert = await alertAdapter.notify(buildAlertPayload(confirmedFailures, now()));
  }

  const releaseShas = [
    ...new Set(
      checks
        .flatMap((check) => check.attempts ?? [])
        .map((attempt) => attempt.releaseSha)
        .filter((value) => typeof value === "string" && RELEASE_SHA.test(value)),
    ),
  ];

  return {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    completedAt: now().toISOString(),
    status:
      confirmedFailures.length === 0
        ? "passed"
        : maintenanceActive
          ? "maintenance_suppressed"
          : "failed",
    maintenance: {
      active: maintenanceActive,
      until: config.maintenanceUntil,
    },
    summary: {
      passed: checks.filter((check) => check.status === "passed").length,
      recovered: checks.filter((check) => check.status === "recovered").length,
      failed: confirmedFailures.length,
      skipped: skipped.length,
    },
    releaseShas,
    checks,
    alert,
  };
}

export async function executeCheck(check, config, dependencies = {}) {
  const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? defaultSleep;
  const clock = dependencies.clock ?? (() => performance.now());
  const attempts = [];

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const started = clock();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("request timeout")),
      config.timeoutMs,
    );
    let responseMetadata = {};
    let observedLatencyMs = null;

    try {
      const response = await fetchImplementation(check.url, {
        method: check.method,
        headers: {
          accept: check.method === "HEAD" ? "*/*" : "application/json,text/html,text/plain,*/*",
          "user-agent": "AYIN-Synthetic-Monitor/1.0",
          "x-request-id": `synthetic-${crypto.randomUUID()}`,
          ...check.headers,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const body = check.method === "HEAD" ? "" : await readBoundedBody(response);
      const releaseSha = releaseFromResponse(response, body);
      responseMetadata = { status: response.status, releaseSha };
      observedLatencyMs = Math.max(0, Math.round(clock() - started));
      validateResponse(check, response, body);
      const latencyMs = observedLatencyMs;
      if (latencyMs > check.maxLatencyMs) {
        throw new SyntheticValidationError(
          `Latency ${latencyMs}ms exceeded ${check.maxLatencyMs}ms.`,
          "latency",
        );
      }
      attempts.push({ attempt, status: response.status, latencyMs, releaseSha, outcome: "passed" });
      clearTimeout(timeout);
      return {
        id: check.id,
        label: check.label,
        severity: check.severity,
        status: "passed",
        attempts,
      };
    } catch (error) {
      clearTimeout(timeout);
      const latencyMs = observedLatencyMs ?? Math.max(0, Math.round(clock() - started));
      attempts.push({
        attempt,
        ...responseMetadata,
        latencyMs,
        outcome: "failed",
        classification: classifyFailure(error),
        message: safeFailureMessage(error),
      });
      if (attempt < config.maxAttempts) await sleep(config.retryDelayMs * attempt);
    }
  }

  const lastAttempt = attempts.at(-1);
  return {
    id: check.id,
    label: check.label,
    severity: check.severity,
    status: "failed",
    classification: lastAttempt?.classification ?? "unknown",
    message: lastAttempt?.message ?? "Synthetic check failed.",
    attempts,
  };
}

function validateResponse(check, response, body) {
  const validator = validators[check.validator];
  if (!validator)
    throw new SyntheticValidationError("Unknown response validator.", "configuration");
  validator(response, body);
}

const validators = {
  homepage(response, body) {
    requireStatus(response, [200]);
    requireContentType(response, "text/html");
    require(body.length >= 500 && /<html[\s>]/i.test(body), "Homepage HTML is not usable.");
    require(/AYIN/i.test(body), "Homepage does not contain the AYIN product identity.");
  },
  webHealth(response, body) {
    requireStatus(response, [200]);
    const data = requireJson(response, body);
    require(data.service === "ayin-web" && data.status === "alive", "Web is not alive.");
    requireRelease(data.releaseSha);
  },
  apiHealth(response, body) {
    requireStatus(response, [200]);
    const data = requireJson(response, body);
    require(data.service === "ayin-api" && data.status === "alive", "API is not alive.");
    requireRelease(data.releaseSha);
  },
  apiReadiness(response, body) {
    requireStatus(response, [200]);
    const data = requireJson(response, body);
    require(data.service === "ayin-api" && data.status === "ready", "API is not ready.");
    require(data.checks && typeof data.checks === "object", "Readiness checks are missing.");
    for (const name of ["database", "configuration", "worker"]) {
      require(data.checks[name]?.status === "ok", `${name} readiness is not ok.`);
    }
    requireRelease(data.releaseSha);
  },
  discovery(response, body) {
    requireStatus(response, [200]);
    const data = requireJson(response, body);
    require(Array.isArray(data.rows), "Discovery rows are missing.");
  },
  search(response, body) {
    requireStatus(response, [200]);
    const data = requireJson(response, body);
    require(data.query ===
      "zz-ayin-synthetic-baseline", "Search query was not normalized as expected.");
    require(Array.isArray(data.items), "Search items are missing.");
    require(data.nextCursor === null ||
      typeof data.nextCursor === "string", "Search cursor is invalid.");
  },
  robots(response, body) {
    requireStatus(response, [200]);
    requireContentType(response, "text/plain");
    require(/user-agent\s*:/i.test(body), "robots.txt has no user-agent policy.");
    require(/sitemap\s*:\s*https:\/\/ayin\.stream\/sitemap\.xml/i.test(
      body,
    ), "Sitemap is missing.");
  },
  sitemap(response, body) {
    requireStatus(response, [200]);
    requireContentType(response, "xml");
    require(/<\?xml[\s\S]*<(sitemapindex|urlset)[\s>]/i.test(body), "Sitemap XML is invalid.");
    require(/https:\/\/ayin\.stream\//i.test(body), "Sitemap has no AYIN URLs.");
  },
  watchPage(response, body) {
    requireStatus(response, [200]);
    requireContentType(response, "text/html");
    require(body.length >= 500 && /<html[\s>]/i.test(body), "Watch page HTML is not usable.");
  },
  playback(response, body) {
    requireStatus(response, [200]);
    const data = requireJson(response, body);
    require(typeof data.video?.id === "string", "Playback video identity is missing.");
    require(typeof data.video?.source?.objectKey === "string", "Playback source is missing.");
    require(data.video?.source?.mimeType === "video/mp4", "Playback fallback is not MP4.");
  },
  mediaHead(response) {
    requireStatus(response, [200, 206]);
    require(/^video\//i.test(
      response.headers.get("content-type") ?? "",
    ), "Media type is not video.");
    requirePositiveLength(response);
    require(/bytes/i.test(
      response.headers.get("accept-ranges") ?? "",
    ), "Media server does not advertise byte ranges.");
  },
  mediaRange(response, body) {
    requireStatus(response, [206]);
    require(/^video\//i.test(
      response.headers.get("content-type") ?? "",
    ), "Media type is not video.");
    require(/^bytes 0-\d+\/\d+$/i.test(
      response.headers.get("content-range") ?? "",
    ), "Content-Range is invalid.");
    require(body.length > 0 && body.length <= 1024, "Media range body size is invalid.");
  },
  thumbnail(response) {
    requireStatus(response, [200]);
    require(/^image\//i.test(
      response.headers.get("content-type") ?? "",
    ), "Thumbnail type is not image.");
    requirePositiveLength(response);
  },
};

async function readBoundedBody(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new SyntheticValidationError("Response exceeded the safe body limit.", "response_size");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

function requireJson(response, body) {
  requireContentType(response, "application/json");
  try {
    return JSON.parse(body);
  } catch {
    throw new SyntheticValidationError("Response is not valid JSON.");
  }
}

function requireStatus(response, allowed) {
  if (allowed.includes(response.status)) return;
  const classification =
    response.status >= 500 ? "http_5xx" : response.status >= 400 ? "http_4xx" : "http_status";
  throw new SyntheticValidationError(`Unexpected HTTP ${response.status}.`, classification);
}

function requireContentType(response, expected) {
  require((response.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes(expected), `Expected ${expected} response.`);
}

function requirePositiveLength(response) {
  const raw = response.headers.get("content-length") ?? "";
  require(/^\d+$/.test(raw) && Number(raw) > 0, "Content-Length is missing or empty.");
}

function requireRelease(value) {
  require(typeof value === "string" && RELEASE_SHA.test(value), "Release SHA is unavailable.");
}

function require(condition, message) {
  if (!condition) throw new SyntheticValidationError(message);
}

function releaseFromResponse(response, body) {
  const header = response.headers.get("x-ayin-release")?.trim().toLowerCase();
  if (header && RELEASE_SHA.test(header)) return header;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const value = JSON.parse(body).releaseSha;
      return typeof value === "string" && RELEASE_SHA.test(value) ? value.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function classifyFailure(error) {
  if (error instanceof SyntheticValidationError) return error.classification;
  if (error?.name === "AbortError" || /timeout|aborted/i.test(error?.message ?? ""))
    return "timeout";
  const code = error?.cause?.code ?? error?.code;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns";
  if (
    ["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(
      code,
    )
  ) {
    return "tls";
  }
  return "network";
}

function safeFailureMessage(error) {
  if (error instanceof SyntheticValidationError) return error.message.slice(0, 240);
  const classification = classifyFailure(error);
  return classification === "timeout"
    ? "The request exceeded its timeout."
    : `The request failed (${classification}).`;
}

function failureSummary(result) {
  return {
    classification: result.classification,
    message: result.message,
    attempts: result.attempts,
  };
}

function buildAlertPayload(failures, now) {
  return {
    schemaVersion: 1,
    event: "ayin.synthetic.failure",
    occurredAt: now.toISOString(),
    highestSeverity: highestSeverity(failures.map((failure) => failure.severity)),
    failures: failures.map((failure) => ({
      id: failure.id,
      label: failure.label,
      severity: failure.severity,
      classification: failure.classification,
      message: failure.message,
      attempts: failure.attempts,
    })),
  };
}

function highestSeverity(severities) {
  const rank = { minor: 1, major: 2, critical: 3 };
  return severities.toSorted((left, right) => rank[right] - rank[left])[0] ?? "minor";
}

function isMaintenanceActive(until, now) {
  return Boolean(until && new Date(until).getTime() > now.getTime());
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
