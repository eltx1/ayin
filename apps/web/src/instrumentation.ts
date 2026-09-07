function releaseSha(): string {
  const candidate = process.env.AYIN_RELEASE_SHA?.trim();
  return candidate && /^[0-9a-f]{40}$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

function safeText(value: unknown): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "Unknown error";
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(password|token|session|secret|api[_-]?key|stream[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .slice(0, 2000);
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: "ayin-web",
      event: "web.runtime_started",
      releaseSha: releaseSha(),
    })}\n`,
  );
}

export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "ayin-web",
      event: "web.request_error",
      releaseSha: releaseSha(),
      errorName: error instanceof Error ? error.name : typeof error,
      message: safeText(error),
      method: request.method ?? null,
      path: context.routePath ?? request.path ?? null,
      routerKind: context.routerKind ?? null,
    })}\n`,
  );
}
