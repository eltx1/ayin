import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const hosts = ["ayin.stream", "api.ayin.stream"];

export function regionFlags(env = {}) {
  return {
    cloudflareTrustEnabled: env.AYIN_TRUST_CLOUDFLARE_REGION === "true",
    webRegionForwardingEnabled: env.AYIN_WEB_REGION_FORWARDING === "true",
    internalTokenConfigured:
      typeof env.AYIN_INTERNAL_EDGE_TOKEN === "string" &&
      env.AYIN_INTERNAL_EDGE_TOKEN.trim().length >= 32,
  };
}

export function nginxSummary(text) {
  const source = text.replace(/#[^\n]*/g, "");
  const names = [...source.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap((m) => m[1].split(/\s+/));
  return {
    referencesWeb: names.includes("ayin.stream"),
    referencesApi: names.includes("api.ayin.stream"),
    clientCertificateRequired: /\bssl_verify_client\s+on\s*;/.test(source),
    clientCertificateConfigured: /\bssl_client_certificate\s+[^;]+;/.test(source),
    deniesAllByDefault: /\bdeny\s+all\s*;/.test(source),
    allowDirectiveCount: (source.match(/\ballow\s+[^;]+;/g) || []).length,
    explicitCountryForwarding: /\bproxy_set_header\s+CF-IPCountry\s+/i.test(source),
    hasIncludes: /\binclude\s+[^;]+;/.test(source),
    ingressVerified: false,
  };
}

export function pm2Summary(processes) {
  return processes
    .filter((p) => ["ayin-web", "ayin-api"].includes(p.name))
    .map((p) => ({ service: p.name, ...regionFlags(p.pm2_env) }));
}

function origin() {
  const user = execFileSync("whoami", { encoding: "utf8" }).trim();
  if (user !== "ayin") throw new Error("Unexpected execution identity");
  const current = "/home/ayin/htdocs/current";
  const require = createRequire(pathToFileURL(current + "/deploy/env-file.cjs"));
  const { loadEnvFile } = require(current + "/deploy/env-file.cjs");
  const report = {
    kind: "ayin-region-origin-read-only",
    releaseSha: execFileSync("git", ["-C", current, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    files: regionFlags(loadEnvFile("/home/ayin/env/api.env")),
    runtime: [],
    nginx: [],
    ingressVerified: false,
  };
  try {
    report.runtime = pm2Summary(
      JSON.parse(
        execFileSync("pm2", ["jlist"], {
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
    );
  } catch {
    report.runtimeUnavailable = true;
  }
  const dir = "/etc/nginx/sites-enabled";
  try {
    for (const name of readdirSync(dir).filter((n) =>
      /^(?:api\.)?ayin\.stream(?:\.conf)?$/.test(n),
    )) {
      try {
        report.nginx.push({
          hostFile: name,
          ...nginxSummary(readFileSync(dir + "/" + name, "utf8")),
        });
      } catch {
        report.nginx.push({ hostFile: name, readable: false });
      }
    }
  } catch {
    report.nginxDirectoryUnavailable = true;
  }
  console.log(JSON.stringify(report));
}

export async function cloudflare(fetcher = fetch, token = process.env.CF_TOKEN) {
  if (!token) return { kind: "ayin-region-edge-read-only", credentialAvailable: false };
  async function get(path) {
    const response = await fetcher("https://api.cloudflare.com/client/v4" + path, {
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { status: response.status, data };
  }
  const zones = await get("/zones?name=ayin.stream&status=active");
  const matching = zones.data.result?.filter((z) => z.name === "ayin.stream");
  if (zones.status !== 200 || matching?.length !== 1 || !/^[a-f0-9]{32}$/.test(matching[0].id)) {
    return {
      kind: "ayin-region-edge-read-only",
      zoneReadStatus: zones.status,
      exactZoneResolved: false,
    };
  }
  const base = "/zones/" + matching[0].id;
  const result = {
    kind: "ayin-region-edge-read-only",
    exactZoneResolved: true,
    settings: {},
    dns: [],
    ingressVerified: false,
  };
  for (const setting of ["ip_geolocation", "ssl", "tls_client_auth"]) {
    const r = await get(base + "/settings/" + setting);
    const value = r.data.result?.value;
    result.settings[setting] = {
      status: r.status,
      value: ["on", "off", "strict", "full", "flexible"].includes(value) ? value : "unavailable",
    };
  }
  for (const host of hosts) {
    const r = await get(base + "/dns_records?name=" + host);
    result.dns.push({
      host,
      status: r.status,
      records: (Array.isArray(r.data.result) ? r.data.result : [])
        .filter((x) => x.name === host)
        .map((x) => ({ type: x.type, proxied: x.proxied === true })),
    });
  }
  const aop = await get(base + "/origin_tls_client_auth/settings");
  result.authenticatedOriginPulls = {
    status: aop.status,
    enabled: aop.data.result?.enabled === true,
  };
  const rules = await get(base + "/rulesets/phases/http_request_late_transform/entrypoint");
  result.requestHeaderRules = {
    status: rules.status,
    count: Array.isArray(rules.data.result?.rules) ? rules.data.result.rules.length : null,
  };
  return result;
}

const invoked =
  process.argv[1] === "-" ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (invoked) {
  try {
    const mode = process.argv.at(-1);
    if (mode === "--origin") origin();
    else if (mode === "--cloudflare") console.log(JSON.stringify(await cloudflare()));
    else throw new Error("Unsupported diagnostic mode");
  } catch {
    console.error(
      "AYIN region diagnostic failed; no raw environment or provider response was logged.",
    );
    process.exitCode = 1;
  }
}
