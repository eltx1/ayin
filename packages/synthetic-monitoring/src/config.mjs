const DEFAULT_WEB_URL = "https://ayin.stream";
const DEFAULT_API_URL = "https://api.ayin.stream";
const DEFAULT_MEDIA_URL = "https://media.ayin.stream";

export function loadSyntheticConfig(environment = process.env) {
  const webBaseUrl = safeBaseUrl(environment.AYIN_SYNTHETIC_WEB_URL, DEFAULT_WEB_URL);
  const apiBaseUrl = safeBaseUrl(environment.AYIN_SYNTHETIC_API_URL, DEFAULT_API_URL);
  const mediaBaseUrl = safeBaseUrl(environment.AYIN_SYNTHETIC_MEDIA_BASE_URL, DEFAULT_MEDIA_URL);
  const latencyMultiplier = boundedNumber(environment.AYIN_SYNTHETIC_LATENCY_MULTIPLIER, 1, 0.5, 5);
  const timeoutMs = boundedInteger(environment.AYIN_SYNTHETIC_TIMEOUT_MS, 20_000, 1_000, 60_000);
  const maxAttempts = boundedInteger(environment.AYIN_SYNTHETIC_MAX_ATTEMPTS, 2, 1, 3);
  const confirmationDelayMs = boundedInteger(
    environment.AYIN_SYNTHETIC_CONFIRMATION_DELAY_MS,
    30_000,
    0,
    120_000,
  );
  const watchSlug = safeSlug(environment.AYIN_SYNTHETIC_WATCH_SLUG);
  const mediaObjectUrl = safeOptionalMediaUrl(
    environment.AYIN_SYNTHETIC_MEDIA_OBJECT_URL,
    mediaBaseUrl,
  );
  const thumbnailUrl = safeOptionalMediaUrl(environment.AYIN_SYNTHETIC_THUMBNAIL_URL, mediaBaseUrl);

  return {
    webBaseUrl,
    apiBaseUrl,
    mediaBaseUrl,
    timeoutMs,
    maxAttempts,
    retryDelayMs: 1_000,
    confirmationDelayMs,
    maintenanceUntil: maintenanceUntil(environment.AYIN_SYNTHETIC_MAINTENANCE_UNTIL),
    checks: buildChecks({
      webBaseUrl,
      apiBaseUrl,
      watchSlug,
      mediaObjectUrl,
      thumbnailUrl,
      latencyMultiplier,
    }),
  };
}

function buildChecks({
  webBaseUrl,
  apiBaseUrl,
  watchSlug,
  mediaObjectUrl,
  thumbnailUrl,
  latencyMultiplier,
}) {
  const latency = (milliseconds) => Math.round(milliseconds * latencyMultiplier);
  const checks = [
    {
      id: "homepage",
      label: "Production homepage",
      severity: "critical",
      url: `${webBaseUrl}/`,
      method: "GET",
      maxLatencyMs: latency(15_000),
      validator: "homepage",
    },
    {
      id: "web-health",
      label: "Web health",
      severity: "critical",
      url: `${webBaseUrl}/api/health`,
      method: "GET",
      maxLatencyMs: latency(12_000),
      validator: "webHealth",
    },
    {
      id: "api-health",
      label: "API liveness",
      severity: "critical",
      url: `${apiBaseUrl}/health`,
      method: "GET",
      maxLatencyMs: latency(12_000),
      validator: "apiHealth",
    },
    {
      id: "api-readiness",
      label: "API readiness",
      severity: "critical",
      url: `${apiBaseUrl}/ready`,
      method: "GET",
      maxLatencyMs: latency(12_000),
      validator: "apiReadiness",
    },
    {
      id: "public-discovery",
      label: "Public discovery catalog",
      severity: "major",
      url: `${apiBaseUrl}/public/discovery/home`,
      method: "GET",
      maxLatencyMs: latency(15_000),
      validator: "discovery",
    },
    {
      id: "search-baseline",
      label: "Public search baseline",
      severity: "major",
      url: `${apiBaseUrl}/public/search?q=zz-ayin-synthetic-baseline&limit=1`,
      method: "GET",
      maxLatencyMs: latency(15_000),
      validator: "search",
    },
    {
      id: "robots",
      label: "robots.txt",
      severity: "minor",
      url: `${webBaseUrl}/robots.txt`,
      method: "GET",
      maxLatencyMs: latency(15_000),
      validator: "robots",
    },
    {
      id: "sitemap",
      label: "sitemap.xml",
      severity: "major",
      url: `${webBaseUrl}/sitemap.xml`,
      method: "GET",
      maxLatencyMs: latency(15_000),
      validator: "sitemap",
    },
  ];

  if (watchSlug) {
    const encodedSlug = encodeURIComponent(watchSlug);
    checks.push(
      {
        id: "watch-page",
        label: "Known-safe watch page",
        severity: "critical",
        url: `${webBaseUrl}/watch/${encodedSlug}`,
        method: "GET",
        maxLatencyMs: latency(15_000),
        validator: "watchPage",
      },
      {
        id: "playback-api",
        label: "Known-safe playback API",
        severity: "critical",
        url: `${apiBaseUrl}/public/videos/${encodedSlug}/playback`,
        method: "GET",
        maxLatencyMs: latency(15_000),
        validator: "playback",
      },
    );
  } else {
    checks.push(skippedCheck("watch-page", "Known-safe watch page", "critical", "watch slug"));
    checks.push(skippedCheck("playback-api", "Known-safe playback API", "critical", "watch slug"));
  }

  if (mediaObjectUrl) {
    checks.push(
      {
        id: "media-head",
        label: "Known-safe media HEAD",
        severity: "major",
        url: mediaObjectUrl,
        method: "HEAD",
        maxLatencyMs: latency(12_000),
        validator: "mediaHead",
      },
      {
        id: "media-range",
        label: "Known-safe media byte range",
        severity: "critical",
        url: mediaObjectUrl,
        method: "GET",
        headers: { range: "bytes=0-1023" },
        maxLatencyMs: latency(12_000),
        validator: "mediaRange",
      },
    );
  } else {
    checks.push(skippedCheck("media-head", "Known-safe media HEAD", "major", "media URL"));
    checks.push(
      skippedCheck("media-range", "Known-safe media byte range", "critical", "media URL"),
    );
  }

  if (thumbnailUrl) {
    checks.push({
      id: "thumbnail",
      label: "Known-safe thumbnail delivery",
      severity: "major",
      url: thumbnailUrl,
      method: "HEAD",
      maxLatencyMs: latency(12_000),
      validator: "thumbnail",
    });
  } else {
    checks.push(
      skippedCheck("thumbnail", "Known-safe thumbnail delivery", "major", "thumbnail URL"),
    );
  }

  return checks;
}

function skippedCheck(id, label, severity, missingTarget) {
  return {
    id,
    label,
    severity,
    skipReason: `No dedicated safe ${missingTarget} is configured.`,
  };
}

function safeBaseUrl(rawValue, fallback) {
  const url = new URL(rawValue?.trim() || fallback);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Synthetic base URLs must be credential-free HTTPS origins.");
  }
  return url.origin;
}

function safeOptionalMediaUrl(rawValue, mediaBaseUrl) {
  if (!rawValue?.trim()) return null;
  const url = new URL(rawValue.trim());
  if (
    url.protocol !== "https:" ||
    url.origin !== mediaBaseUrl ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname === "/"
  ) {
    throw new Error("Synthetic asset URLs must be public objects on the configured media origin.");
  }
  return url.href;
}

function safeSlug(rawValue) {
  if (!rawValue?.trim()) return null;
  const slug = rawValue.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(slug)) {
    throw new Error("The synthetic watch slug is invalid.");
  }
  return slug;
}

function maintenanceUntil(rawValue) {
  if (!rawValue?.trim()) return null;
  const date = new Date(rawValue.trim());
  if (Number.isNaN(date.getTime())) {
    throw new Error("AYIN_SYNTHETIC_MAINTENANCE_UNTIL must be an ISO-8601 timestamp.");
  }
  return date.toISOString();
}

function boundedInteger(rawValue, fallback, minimum, maximum) {
  if (!rawValue?.trim()) return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Synthetic integer setting must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boundedNumber(rawValue, fallback, minimum, maximum) {
  if (!rawValue?.trim()) return fallback;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Synthetic number setting must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
