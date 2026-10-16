import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireTestDatabase } from "../../scripts/test-database-guard.mjs";

// Test transport only: preserve the application's response headers and body.
// The dual listener also accepts existing Node helpers' HTTP requests, while
// critical browser pages and CSP-upgraded resources use real TLS.
export function createLoopbackProxy({ port, upstreamPort, key, cert }) {
  const sockets = new Set();
  const forward = (request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: upstreamPort,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          "x-forwarded-proto": request.socket.encrypted ? "https" : "http",
        },
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  };
  const plain = http.createServer(forward);
  const secure = https.createServer({ key, cert }, forward);
  const listener = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.once("readable", () => {
      const chunk = socket.read(1);
      if (!chunk) return socket.destroy();
      socket.unshift(chunk);
      // TLS handshake record vs an HTTP method. Neither listener is exposed
      // outside loopback, and upstream destinations are fixed by the harness.
      (chunk[0] === 0x16 ? secure : plain).emit("connection", socket);
    });
  });
  return {
    listen: () =>
      new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(port, "127.0.0.1", () => resolve(listener.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        listener.close(resolve);
      }),
  };
}

export function createTestCertificate() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayin-critical-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
        "-keyout",
        path.join(directory, "key.pem"),
        "-out",
        path.join(directory, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(path.join(directory, "key.pem")),
      cert: readFileSync(path.join(directory, "cert.pem")),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  requireTestDatabase();
  const certificate = createTestCertificate();
  const proxies = [
    createLoopbackProxy({ port: 3000, upstreamPort: 3010, ...certificate }),
    createLoopbackProxy({ port: 3001, upstreamPort: 3011, ...certificate }),
  ];
  await Promise.all(proxies.map((proxy) => proxy.listen()));
  console.info("Critical browser loopback HTTP/TLS transport ready on 3000 and 3001");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, async () => {
      await Promise.all(proxies.map((proxy) => proxy.close()));
    });
}
