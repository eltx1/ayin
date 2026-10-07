import type { Page } from "@playwright/test";
import type { performanceLabProfiles } from "./performance-lab-profiles";

type Entry = { time: number; duration: number };
type LabState = {
  supported: string[];
  lcpMs: number | null;
  shifts: Array<{ time: number; value: number }>;
  longTasks: Entry[];
  events: Array<Entry & { name: string; interactionId: number }>;
  overflow: Record<string, number>;
};
declare global {
  interface Window {
    __ayinProductLab: LabState;
  }
}

// Only fixed labels leave this allow-list. Never retain request URLs, queries,
// headers, bodies, account identifiers, error messages or browser storage.
const apiFamilies = [
  "/auth/me",
  "/auth/profiles",
  "/product-controls",
  "/discovery/home",
  "/discovery/rows",
  "/public/discovery",
  "/public/search/suggestions",
  "/public/search",
  "/public/videos",
  "/public/movies",
  "/creator/studio/overview",
  "/creator/studio",
  "/creator/videos",
  "/creator/channels",
  "/creator/uploads",
  "/admin/session",
  "/admin/control/dashboard",
  "/admin/control/search",
  "/admin/analytics",
  "/admin/system",
  "/admin",
  "/comments",
  "/social",
  "/analytics",
  "/ads",
  "/notifications",
  "/media",
];
export function classifyRuntimeRequest(raw: string, type: string) {
  const url = new URL(raw);
  if (url.origin === "http://127.0.0.1:3001")
    return `api:${apiFamilies.find((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix + "/")) ?? "other"}`;
  if (url.hostname === "media.invalid") return "fixture-media-origin";
  if (url.origin === "http://127.0.0.1:3000") {
    if (url.searchParams.has("_rsc")) return "web:rsc";
    if (url.pathname === "/_next/image") return "web:image-optimizer";
    if (url.pathname.endsWith(".js")) return "web:script";
    if (url.pathname.endsWith(".css")) return "web:stylesheet";
    if (/\.(woff2?|ttf)$/.test(url.pathname)) return "web:font";
    if (/\.(png|svg|webp|jpe?g|ico)$/.test(url.pathname)) return "web:image";
    return type === "Document" ? "web:document" : "web:route-or-other";
  }
  return url.protocol === "blob:" || url.protocol === "data:"
    ? "inline-resource"
    : "external-resource";
}

export async function observeRuntime(page: Page, profile: (typeof performanceLabProfiles)[number]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: profile.downloadBytesPerSecond,
    uploadThroughput: profile.uploadBytesPerSecond,
    connectionType: "cellular4g",
  });
  await cdp.send("Performance.enable");
  const counters = async (): Promise<Record<string, number>> =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map(
        (entry: { name: string; value: number }) => [entry.name, entry.value],
      ),
    );
  const initial = await counters();
  type RequestRecord = {
    family: string;
    method: string;
    status: number | null;
    encodedBytes: number;
    state: "in-flight" | "finished" | "failed" | "redirected";
    failure: string | null;
    canceled: boolean;
  };
  const current = new Map<string, RequestRecord>(),
    requests: RequestRecord[] = [];
  cdp.on("Network.requestWillBeSent", (event) => {
    const preceding = current.get(event.requestId);
    if (event.redirectResponse && preceding) {
      preceding.state = "redirected";
      preceding.status = event.redirectResponse.status;
      preceding.encodedBytes = event.redirectResponse.encodedDataLength ?? 0;
    }
    const record: RequestRecord = {
      family: classifyRuntimeRequest(event.request.url, event.type ?? "Other"),
      method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
        event.request.method,
      )
        ? event.request.method
        : "OTHER",
      status: null,
      encodedBytes: 0,
      state: "in-flight",
      failure: null,
      canceled: false,
    };
    current.set(event.requestId, record);
    requests.push(record);
  });
  cdp.on("Network.responseReceived", (event) => {
    const request = current.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const request = current.get(event.requestId);
    // Chromium can finish an error document after the original request failed.
    // Keep both its failed state and its excluded completed-byte total intact.
    if (request && request.failure === null) {
      request.state = "finished";
      request.encodedBytes = event.encodedDataLength;
    }
  });
  cdp.on("Network.loadingFailed", (event) => {
    const request = current.get(event.requestId);
    if (request) {
      request.state = "failed";
      request.failure = /^net::ERR_[A-Z_]+$/.test(event.errorText)
        ? event.errorText
        : "other-network-error";
      request.canceled = event.canceled === true;
    }
  });
  await page.addInitScript(() => {
    const state: LabState = (window.__ayinProductLab = {
      supported: [...PerformanceObserver.supportedEntryTypes],
      lcpMs: null,
      shifts: [],
      longTasks: [],
      events: [],
      overflow: {},
    });
    const append = <T>(name: string, list: T[], entry: T) => {
      if (list.length < 1000) list.push(entry);
      else state.overflow[name] = (state.overflow[name] ?? 0) + 1;
    };
    const observe = (type: string, receive: (entries: PerformanceEntry[]) => void) => {
      if (!state.supported.includes(type)) return;
      new PerformanceObserver((list) => receive(list.getEntries())).observe({
        type,
        buffered: true,
        ...(type === "event" ? { durationThreshold: 16 } : {}),
      });
    };
    observe("largest-contentful-paint", (entries) => {
      for (const entry of entries) state.lcpMs = entry.startTime;
    });
    observe("layout-shift", (entries) => {
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput)
          append("shifts", state.shifts, { time: shift.startTime, value: shift.value });
      }
    });
    observe("longtask", (entries) => {
      for (const entry of entries)
        append("longTasks", state.longTasks, { time: entry.startTime, duration: entry.duration });
    });
    observe("event", (entries) => {
      for (const entry of entries) {
        const event = entry as PerformanceEntry & { interactionId: number };
        if (event.interactionId)
          append("events", state.events, {
            time: event.startTime,
            name: event.name,
            duration: event.duration,
            interactionId: event.interactionId,
          });
      }
    });
  });
  const snapshot = async () => {
    const browser = await page.evaluate(() => {
      const state = window.__ayinProductLab;
      const navigation = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      let maximum = 0,
        session = 0,
        start = 0,
        previous = 0;
      for (const shift of state.shifts) {
        if (shift.time - previous > 1000 || shift.time - start > 5000) {
          session = 0;
          start = shift.time;
        }
        session += shift.value;
        previous = shift.time;
        maximum = Math.max(maximum, session);
      }
      return {
        observedAtMs: performance.now(),
        ttfbMs: navigation.responseStart - navigation.requestStart,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
        observedLcpMs: state.lcpMs,
        observerAvailability: state.supported,
        observedClsMaxSessionWindow: state.supported.includes("layout-shift") ? maximum : null,
        longTasks: state.longTasks,
        observedEventTimingEntries: state.events,
        observerOverflow: state.overflow,
        domElements: document.querySelectorAll("*").length,
        media: [...document.querySelectorAll("video")].map((video) => ({
          readyState: video.readyState,
          networkState: video.networkState,
          errorCode: video.error?.code ?? null,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          paused: video.paused,
          currentTimeSeconds: video.currentTime,
        })),
      };
    });
    const measured = await counters();
    // Clone before crossing an await so later CDP mutations cannot rewrite a cutoff.
    const atCutoff = requests.map((request) => ({ ...request }));
    const network: Record<
      string,
      {
        requests: number;
        finished: number;
        failed: number;
        canceled: number;
        inFlight: number;
        redirected: number;
        httpErrors: number;
        encodedBytes: number;
        statuses: Record<string, number>;
        failures: Record<string, number>;
        methods: Record<string, number>;
      }
    > = {};
    for (const request of atCutoff) {
      const group = (network[request.family] ??= {
        requests: 0,
        finished: 0,
        failed: 0,
        canceled: 0,
        inFlight: 0,
        redirected: 0,
        httpErrors: 0,
        encodedBytes: 0,
        statuses: {},
        failures: {},
        methods: {},
      });
      group.requests++;
      group.finished += Number(request.state === "finished");
      group.failed += Number(request.state === "failed");
      group.canceled += Number(request.canceled);
      group.inFlight += Number(request.state === "in-flight");
      group.redirected += Number(request.state === "redirected");
      group.httpErrors += Number(request.status !== null && request.status >= 400);
      group.encodedBytes += request.encodedBytes;
      const status = request.status === null ? "no-response" : String(request.status);
      group.statuses[status] = (group.statuses[status] ?? 0) + 1;
      group.methods[request.method] = (group.methods[request.method] ?? 0) + 1;
      if (request.failure)
        group.failures[request.failure] = (group.failures[request.failure] ?? 0) + 1;
    }
    return {
      ...browser,
      network,
      cpu: Object.fromEntries(
        ["ScriptDuration", "TaskDuration", "LayoutDuration"].map((key) => [
          key,
          {
            beforeSeconds: initial[key] ?? null,
            afterSeconds: measured[key] ?? null,
            deltaMs:
              typeof initial[key] === "number" &&
              typeof measured[key] === "number" &&
              measured[key]! >= initial[key]!
                ? (measured[key]! - initial[key]!) * 1000
                : null,
          },
        ]),
      ),
      rendererJsHeapUsedBytes: measured.JSHeapUsedSize ?? null,
    };
  };
  return { snapshot, cdp, detach: () => cdp.detach() };
}
