import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import test from "node:test";
import { createLoopbackProxy, createTestCertificate } from "../tests/e2e/critical-tls-proxy.mjs";

test("HTTP and TLS preserve CSP, cookies, request bodies and forwarding scheme", async () => {
  const csp = "default-src 'self'; script-src 'self'; upgrade-insecure-requests";
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(201, {
      "content-security-policy": csp,
      "set-cookie": "test-session=fixture; HttpOnly; SameSite=Lax",
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        method: request.method,
        path: request.url,
        origin: request.headers.origin,
        protocol: request.headers["x-forwarded-proto"],
        body: Buffer.concat(chunks).toString(),
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const proxy = createLoopbackProxy({
    port: 0,
    upstreamPort: upstream.address().port,
    ...createTestCertificate(),
  });
  const port = await proxy.listen();
  try {
    for (const [scheme, client] of [
      ["http", http],
      ["https", https],
    ]) {
      const result = await new Promise((resolve, reject) => {
        const request = client.request(
          {
            host: "127.0.0.1",
            port,
            path: "/probe?bounded=1",
            method: "POST",
            rejectUnauthorized: false,
            headers: { origin: "https://127.0.0.1:3000", "content-type": "application/json" },
          },
          async (response) => {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: JSON.parse(Buffer.concat(chunks)),
            });
          },
        );
        request.on("error", reject);
        request.end('{"fixture":true}');
      });
      assert.equal(result.status, 201);
      assert.equal(result.headers["content-security-policy"], csp);
      assert.deepEqual(result.headers["set-cookie"], [
        "test-session=fixture; HttpOnly; SameSite=Lax",
      ]);
      assert.deepEqual(result.body, {
        method: "POST",
        path: "/probe?bounded=1",
        origin: "https://127.0.0.1:3000",
        protocol: scheme,
        body: '{"fixture":true}',
      });
    }
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
