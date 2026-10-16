import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Execute the actual shell script, replacing only curl with a local stateful API.
// No provider request or production credential is used.
const fakeCurl = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const method = value("--request");
const url = new URL(args.at(-1));
if (url.origin !== "https://api.cloudflare.com") process.exit(64);
const path = url.pathname;
const data = args.includes("--data") ? JSON.parse(value("--data")) : null;
const stateFile = process.env.AYIN_EDGE_TEST_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
state.calls.push({ method, path, data });
let result;
if (method === "GET" && path === "/client/v4/user/tokens/verify") {
  result = { status: "active" };
} else if (method === "GET" && path === "/client/v4/zones") {
  result = [{ id: "a".repeat(32), name: "ayin.stream" }];
} else if (method === "GET" && path.endsWith("/dns_records")) {
  const name = url.searchParams.get("name");
  if (!["ayin.stream", "api.ayin.stream"].includes(name)) process.exit(65);
  result = [{ id: name === "ayin.stream" ? "web-record" : "api-record" }];
} else if (method === "PUT" && ["/dns_records/web-record", "/dns_records/api-record"].some((suffix) => path.endsWith(suffix))) {
  result = data;
} else if (method === "PATCH" && path.includes("/settings/")) {
  const setting = path.split("/").at(-1);
  state.settings[setting] = data.value;
  result = { value: data.value };
} else if (method === "PUT" && path.endsWith("/bot_management")) {
  state.botManagement = data;
  result = data;
} else {
  process.exit(66);
}
fs.writeFileSync(stateFile, JSON.stringify(state));
process.stdout.write(JSON.stringify({ success: true, result }));
`;

for (const tlsMode of ["strict", "full"]) {
  test(`routine edge sync preserves existing ${tlsMode} TLS mode`, () => {
    const directory = mkdtempSync(join(tmpdir(), "ayin-edge-sync-test-"));
    try {
      const stateFile = join(directory, "api-state.json");
      writeFileSync(stateFile, JSON.stringify({ settings: { ssl: tlsMode }, calls: [] }));
      const curlFile = join(directory, "curl");
      writeFileSync(curlFile, fakeCurl);
      chmodSync(curlFile, 0o755);
      const result = spawnSync(
        "bash",
        [new URL("./sync-production-edge.sh", import.meta.url).pathname],
        {
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH}`,
            AYIN_CLOUDFLARE_API_TOKEN: "synthetic-edge-test-token",
            AYIN_ORIGIN_IPV4: "192.0.2.10",
            AYIN_EDGE_TEST_STATE: stateFile,
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-edge-test-token/);
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      assert.equal(state.settings.ssl, tlsMode);
      assert.deepEqual(
        state.calls.filter((call) => call.method !== "GET" && call.path.endsWith("/settings/ssl")),
        [],
        "routine DNS/edge synchronization must not write TLS policy",
      );
      assert.deepEqual(
        state.calls
          .filter((call) => call.method === "PUT" && call.path.includes("/dns_records/"))
          .map((call) => call.data),
        ["ayin.stream", "api.ayin.stream"].map((name) => ({
          type: "A",
          name,
          content: "192.0.2.10",
          ttl: 1,
          proxied: true,
        })),
      );
      assert.deepEqual(state.settings, {
        ssl: tlsMode,
        always_use_https: "on",
        browser_check: "off",
        security_level: "essentially_off",
      });
      assert.deepEqual(state.botManagement, { fight_mode: false });
      assert.match(result.stdout, /production edge sync completed successfully/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

const workflow = readFileSync(
  new URL("../../.github/workflows/cloudflare-production.yml", import.meta.url),
  "utf8",
);
const endpointStep = workflow.split("      - name: Verify public production endpoints\n")[1];
assert.ok(endpointStep, "the real endpoint verification step must exist");
const endpointScript = endpointStep
  .split("\n      - name:")[0]
  .split("        run: |\n")[1]
  .split("\n")
  .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
  .join("\n");

for (const [label, httpStatus, transportExit, expectedSuccess] of [
  ["missing object", "404", 0, true],
  ["restricted missing object", "403", 0, true],
  ["successful endpoint", "200", 0, true],
  ["server error", "500", 0, false],
  ["upstream error", "502", 0, false],
  ["connection failure", "000", 7, false],
  ["timeout after HTTP headers", "404", 28, false],
]) {
  test(`public media probe handles ${label} without reporting false success`, () => {
    const directory = mkdtempSync(join(tmpdir(), "ayin-edge-probe-test-"));
    try {
      const requestsFile = join(directory, "requests.jsonl");
      const curlFile = join(directory, "curl");
      writeFileSync(
        curlFile,
        `#!/usr/bin/env node
const fs = require("node:fs");
const url = process.argv.at(-1);
const endpoints = ["https://ayin.stream/", "https://api.ayin.stream/health", "https://api.ayin.stream/ready", "https://media.ayin.stream/__ayin_edge_verification_missing_object__"];
if (!endpoints.includes(url)) process.exit(64);
fs.appendFileSync(process.env.AYIN_EDGE_TEST_REQUESTS, JSON.stringify(url) + "\\n");
if (url === endpoints[3]) {
  process.stdout.write(process.env.AYIN_EDGE_TEST_HTTP);
  process.exit(Number(process.env.AYIN_EDGE_TEST_EXIT));
}
`,
      );
      chmodSync(curlFile, 0o755);
      const result = spawnSync("bash", ["-c", endpointScript], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          AYIN_EDGE_TEST_REQUESTS: requestsFile,
          AYIN_EDGE_TEST_HTTP: httpStatus,
          AYIN_EDGE_TEST_EXIT: String(transportExit),
        },
        encoding: "utf8",
      });
      assert.equal(result.status === 0, expectedSuccess, result.stdout + result.stderr);
      assert.equal(result.stdout.includes("endpoints are reachable"), expectedSuccess);
      assert.deepEqual(
        readFileSync(requestsFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
        [
          "https://ayin.stream/",
          "https://api.ayin.stream/health",
          "https://api.ayin.stream/ready",
          "https://media.ayin.stream/__ayin_edge_verification_missing_object__",
        ],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
