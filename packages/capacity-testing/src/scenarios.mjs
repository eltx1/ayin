import { randomUUID } from "node:crypto";

const caps = {
  smoke: { validation: 1, analytics: 2, login: 1, upload: 1 },
  normal: { validation: 5, analytics: 25, login: 5, upload: 5 },
  peak: { validation: 5, analytics: 100, login: 5, upload: 5 },
  stress: { validation: 5, analytics: 250, login: 5, upload: 5 },
  soak: { validation: 5, analytics: 500, login: 5, upload: 5 },
};

async function jsonRequest(context, path, init = {}) {
  const started = context.now();
  let response;
  try {
    response = await context.fetch(new URL(path, context.config.apiUrl), {
      ...init,
      signal: AbortSignal.timeout(context.config.timeoutMs),
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => null);
    return { response, body, latencyMs: context.now() - started };
  } catch (error) {
    return { response: null, body: null, latencyMs: context.now() - started, error };
  }
}

function result(name, request, validate, networkRequests = 1) {
  const ok = Boolean(request.response && validate(request.response, request.body));
  return {
    scenario: name,
    ok,
    latencyMs: request.latencyMs,
    networkRequests,
    classification: ok
      ? "ok"
      : request.error?.name === "TimeoutError"
        ? "timeout"
        : request.response
          ? `http_${request.response.status}`
          : "network",
  };
}

function readScenario(name, path, validate) {
  return {
    name,
    weight: 1,
    async run(context) {
      return result(name, await jsonRequest(context, path), validate);
    },
  };
}

export function buildScenarios(config, state = { assetIds: [] }) {
  const scenarios = [
    readScenario(
      "public_catalog",
      "/public/discovery/home",
      (response, body) => response.ok && body && typeof body === "object",
    ),
    readScenario(
      "search",
      `/public/search?q=${encodeURIComponent(config.searchQuery)}&limit=12`,
      (response, body) => response.ok && body && typeof body === "object",
    ),
    {
      name: "registration_validation",
      weight: 0,
      maxIterations: caps[config.profileName].validation,
      async run(context) {
        const request = await jsonRequest(context, "/auth/register", {
          method: "POST",
          body: JSON.stringify({ email: "invalid" }),
        });
        return result("registration_validation", request, (response) => response.status === 400);
      },
    },
  ];
  if (config.watchSlug) {
    scenarios.push(
      readScenario(
        "watch_metadata",
        `/public/videos/${encodeURIComponent(config.watchSlug)}/playback`,
        (response, body) => response.ok && body && typeof body === "object",
      ),
    );
  }
  if (config.loginEmail && config.loginPassword) {
    scenarios.push({
      name: "login",
      weight: 0,
      maxIterations: caps[config.profileName].login,
      async run(context) {
        const started = context.now();
        const login = await jsonRequest(context, "/auth/login", {
          method: "POST",
          headers: { "x-ayin-auth-transport": "bearer" },
          body: JSON.stringify({ email: config.loginEmail, password: config.loginPassword }),
        });
        const token = login.body?.sessionToken;
        if (!login.response?.ok || typeof token !== "string")
          return result("login", { ...login, latencyMs: context.now() - started }, () => false);
        return result("login", { ...login, latencyMs: context.now() - started }, () => true);
      },
    });
  }
  if (!config.enableMutations) return scenarios;

  scenarios.push({
    name: "analytics_batch",
    weight: 0,
    maxIterations: caps[config.profileName].analytics,
    async run(context) {
      const events = Array.from({ length: 10 }, () => ({
        clientEventId: randomUUID(),
        schemaVersion: 1,
        eventName: "APP_OPEN",
        occurredAt: new Date().toISOString(),
        sessionId: `capacity-${context.runId}`,
        source: "SERVER",
        deviceClass: "UNKNOWN",
        metadata: { capacityRunId: context.runId },
      }));
      const request = await jsonRequest(context, "/analytics/events", {
        method: "POST",
        body: JSON.stringify({ events }),
      });
      return result(
        "analytics_batch",
        request,
        (response) => response.status === 201 || response.status === 200,
      );
    },
  });

  if (config.loginEmail && config.loginPassword && config.uploadChannelId) {
    scenarios.push({
      name: "upload_session_authorization",
      weight: 0,
      maxIterations: caps[config.profileName].upload,
      async run(context) {
        const started = context.now();
        const login = await jsonRequest(context, "/auth/login", {
          method: "POST",
          headers: { "x-ayin-auth-transport": "bearer" },
          body: JSON.stringify({ email: config.loginEmail, password: config.loginPassword }),
        });
        const token = login.body?.sessionToken;
        if (!login.response?.ok || typeof token !== "string")
          return result(
            "upload_session_authorization",
            { ...login, latencyMs: context.now() - started },
            () => false,
          );
        const create = await jsonRequest(context, "/media/uploads/sessions", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({
            channelId: config.uploadChannelId,
            sizeBytes: 1_024,
            mimeType: "video/mp4",
          }),
        });
        const sessionToken = create.body?.sessionToken;
        if (!create.response?.ok || typeof sessionToken !== "string")
          return result(
            "upload_session_authorization",
            { ...create, latencyMs: context.now() - started },
            () => false,
            2,
          );
        if (typeof create.body?.assetId === "string") state.assetIds.push(create.body.assetId);
        const abort = await jsonRequest(context, "/media/uploads/sessions/abort", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionToken }),
        });
        return result(
          "upload_session_authorization",
          { ...abort, latencyMs: context.now() - started },
          (response) => response.ok,
          3,
        );
      },
    });
  }
  return scenarios;
}

export const scenarioInternals = { caps, jsonRequest };
