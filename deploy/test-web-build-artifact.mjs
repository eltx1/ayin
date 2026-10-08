import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { test } from "node:test";
import { createArtifact, installArtifact, LIMITS } from "./web-build-artifact.mjs";

const ENV = {
  NODE_ENV: "production",
  NEXT_PUBLIC_API_BASE_URL: "https://api.ayin.stream",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayin.stream",
};
const hash = (data) => createHash("sha256").update(data).digest("hex");
const exists = async (path) =>
  fs.lstat(path).then(
    () => true,
    () => false,
  );
const pad = (size) => (512 - (size % 512)) % 512;
const script = resolve("deploy/web-build-artifact.mjs");

async function put(path, data) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, data, { mode: 0o600 });
}
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
async function fixture(t) {
  const base = await fs.mkdtemp(join(tmpdir(), "ayin-web-artifact-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  const next = join(root, "apps/web/.next");
  await put(join(root, ".gitignore"), "node_modules/\n.next/\n.env*\n");
  await put(join(root, ".nvmrc"), `${process.versions.node}\n`);
  await put(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@11.24.0" }));
  await put(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await put(
    join(root, "apps/web/package.json"),
    JSON.stringify({ dependencies: { next: "16.3.8" } }),
  );
  await put(
    join(root, "apps/web/node_modules/next/package.json"),
    JSON.stringify({ version: "16.3.8" }),
  );
  await put(join(next, "BUILD_ID"), "production-build-123\n");
  for (const path of [
    "build-manifest.json",
    "prerender-manifest.json",
    "server/app-paths-manifest.json",
  ])
    await put(join(next, path), "{}\n");
  await put(
    join(next, "required-server-files.json"),
    JSON.stringify({
      config: {
        distDir: ".next",
        images: {
          remotePatterns: [
            { protocol: "https", hostname: "media.ayin.stream", port: "", pathname: "/**" },
          ],
        },
      },
    }),
  );
  await put(
    join(next, "routes-manifest.json"),
    JSON.stringify({
      headers: [
        {
          source: "/:path*",
          headers: [
            {
              key: "Content-Security-Policy",
              value:
                "connect-src 'self' https://api.ayin.stream https://media.ayin.stream; upgrade-insecure-requests",
            },
          ],
        },
      ],
    }),
  );
  await put(join(next, "static/chunks/app.js"), "console.log('production bundle');\n");
  await put(
    join(next, `server/${"a".repeat(85)}/long-${"b".repeat(80)}.js`),
    "prefix split works\n",
  );
  await put(join(next, "server/empty.js"), "");
  await put(join(next, "cache/do-not-package"), "cache secret sentinel");
  git(root, "init", "--quiet");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Artifact Tests",
    "-c",
    "user.email=artifact-tests@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const sha = git(root, "rev-parse", "HEAD");
  const archive = join(base, "web.tar.gz");
  const env = join(base, "web.env");
  await put(
    env,
    Object.entries(ENV)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  return { base, root, next, sha, archive, env };
}
async function prepared(t, environment = ENV) {
  const f = await fixture(t);
  f.result = await createArtifact(f.root, f.sha, f.archive, environment);
  f.bytes = await fs.readFile(f.archive);
  f.entries = unpack(f.bytes);
  await fs.rm(f.next, { recursive: true });
  return f;
}
function unpack(bytes) {
  const raw = gunzipSync(bytes);
  const entries = [];
  let position = 0;
  while (position + 512 <= raw.length) {
    const header = raw.subarray(position, position + 512);
    if (header.every((byte) => !byte)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString()
        .replace(/\0.*$/, "");
    const size = Number.parseInt(field(124, 12), 8);
    const prefix = field(345, 155);
    entries.push({
      path: (prefix ? `${prefix}/` : "") + field(0, 100),
      data: Buffer.from(raw.subarray(position + 512, position + 512 + size)),
      header: Buffer.from(header),
    });
    position += 512 + size + pad(size);
  }
  return entries;
}
function checksum(header) {
  header.fill(32, 148, 156);
  const value = header.reduce((sum, byte) => sum + byte, 0);
  header.write(value.toString(8).padStart(6, "0") + "\0 ", 148, 8);
}
function pack(entries, mutateHeader, tail = Buffer.alloc(1024)) {
  const parts = [];
  for (const entry of entries) {
    const header = Buffer.from(entry.header);
    header.fill(0, 0, 100);
    header.fill(0, 345, 500);
    let name = entry.path;
    let prefix = "";
    if (Buffer.byteLength(name) > 100) {
      const index = name.lastIndexOf("/");
      prefix = name.slice(0, index);
      name = name.slice(index + 1);
    }
    header.write(name, 0, 100);
    header.write(prefix, 345, 155);
    header.write(entry.data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    mutateHeader?.(header, entry);
    checksum(header);
    parts.push(header, entry.data, Buffer.alloc(pad(entry.data.length)));
  }
  return gzipSync(Buffer.concat([...parts, tail]));
}
function changeManifest(entries, change) {
  const manifest = JSON.parse(entries[0].data);
  change(manifest);
  entries[0].data = Buffer.from(JSON.stringify(manifest));
}
async function rejectsArtifact(f, bytes, pattern = /./) {
  const bad = join(f.base, "malformed.tar.gz");
  await fs.writeFile(bad, bytes);
  await assert.rejects(installArtifact(f.root, f.sha, bad, hash(bytes), f.env), pattern);
  assert.equal(await exists(f.next), false, "rejected artifact leaves no candidate build");
  assert.equal(
    await fs.readFile(join(f.root, "pnpm-lock.yaml"), "utf8"),
    "lockfileVersion: '9.0'\n",
  );
}

test("clean roundtrip preserves all files, ustar prefixes, empty files, and excludes cache", async (t) => {
  const f = await prepared(t);
  assert.equal(f.result.sha256, hash(f.bytes));
  assert(f.entries.some((entry) => entry.path.length > 100));
  assert(f.entries.every((entry) => !entry.path.startsWith(".next/cache/")));
  const result = await installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env);
  assert.equal(result.fileCount, f.entries.length - 1);
  for (const entry of f.entries.slice(1))
    assert.deepEqual(await fs.readFile(join(f.root, "apps/web", entry.path)), entry.data);
  assert.equal(await exists(join(f.next, "cache")), false);
  assert.equal(git(f.root, "status", "--porcelain"), "");
  assert.equal((await fs.stat(join(f.next, "BUILD_ID"))).mode & 0o777, 0o600);
  const list = spawnSync("tar", ["-tzf", f.archive], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert(list.stdout.includes("web-build-manifest.json"));
});

test("metadata allowlists public values and normalizes absent/empty optional keys", async (t) => {
  const f = await prepared(t, {
    ...ENV,
    NEXT_PUBLIC_SITE_URL: "",
    CI_PRIVATE_SECRET: "never serialize this",
  });
  const manifest = JSON.parse(f.entries[0].data);
  assert.equal(manifest.buildEnv.NEXT_PUBLIC_SITE_URL, "");
  assert.equal(manifest.buildEnv.NEXT_PUBLIC_WEB_BASE_URL, "");
  assert.equal(manifest.buildEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION, "");
  assert(!gunzipSync(f.bytes).includes(Buffer.from("never serialize this")));
  assert(!Object.hasOwn(manifest, "environment"));
  await installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env);
});

test("all explicit public build values must match target env", async (t) => {
  const values = {
    ...ENV,
    NEXT_PUBLIC_SITE_URL: "https://ayin.stream",
    NEXT_PUBLIC_WEB_BASE_URL: "https://ayin.stream",
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "public-verification-code",
  };
  const f = await prepared(t, values);
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /NEXT_PUBLIC_SITE_URL mismatch/,
  );
  await fs.writeFile(
    f.env,
    Object.entries(values)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n"),
  );
  await installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env);
});

test("checksum mismatch is rejected before gzip parsing or target writes", async (t) => {
  const f = await prepared(t);
  await fs.writeFile(f.archive, "not even gzip");
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /SHA256 mismatch/,
  );
  assert.equal(await exists(f.next), false);
});

for (const [name, change, pattern] of [
  [
    "source SHA",
    (m) => {
      m.sourceSha = "a".repeat(40);
    },
    /sourceSha mismatch/,
  ],
  [
    "Node version",
    (m) => {
      m.nodeVersion = "22.0.0";
    },
    /nodeVersion mismatch/,
  ],
  [
    "OS",
    (m) => {
      m.platform = "win32";
    },
    /platform mismatch/,
  ],
  [
    "architecture",
    (m) => {
      m.arch = "different";
    },
    /arch mismatch/,
  ],
  [
    "Next version",
    (m) => {
      m.nextVersion = "16.0.0";
    },
    /nextVersion mismatch/,
  ],
  [
    "pnpm version",
    (m) => {
      m.packageManager = "pnpm@1.0.0";
    },
    /packageManager mismatch/,
  ],
  [
    "lockfile digest",
    (m) => {
      m.lockfileSha256 = "0".repeat(64);
    },
    /lockfileSha256 mismatch/,
  ],
  [
    "API origin",
    (m) => {
      m.buildEnv.NEXT_PUBLIC_API_BASE_URL = "https://evil.invalid";
    },
    /API_BASE_URL mismatch/,
  ],
  [
    "media origin",
    (m) => {
      m.buildEnv.NEXT_PUBLIC_MEDIA_BASE_URL = "https://evil.invalid";
    },
    /MEDIA_BASE_URL mismatch/,
  ],
  [
    "schema",
    (m) => {
      m.schemaVersion = 2;
    },
    /manifest schema/,
  ],
  [
    "extra metadata",
    (m) => {
      m.secret = "forbidden";
    },
    /manifest schema/,
  ],
  [
    "extra env metadata",
    (m) => {
      m.buildEnv.SECRET = "forbidden";
    },
    /build environment/,
  ],
  [
    "negative size",
    (m) => {
      m.files[0].size = -1;
    },
    /file size/,
  ],
  [
    "oversized file",
    (m) => {
      m.files[0].size = LIMITS.file + 1;
    },
    /file size/,
  ],
  [
    "digest shape",
    (m) => {
      m.files[0].sha256 = "bogus";
    },
    /file size or digest/,
  ],
  [
    "duplicate manifest path",
    (m) => {
      m.files.push(m.files[0]);
    },
    /Duplicate manifest/,
  ],
  [
    "excessive file count",
    (m) => {
      m.files = Array(LIMITS.files + 1).fill(m.files[0]);
    },
    /file count/,
  ],
  [
    "byte total",
    (m) => {
      m.totalBytes += 1;
    },
    /byte total/,
  ],
  [
    "missing build ID",
    (m) => {
      const file = m.files.find((f) => f.path === ".next/BUILD_ID");
      m.files = m.files.filter((f) => f !== file);
      m.totalBytes -= file.size;
    },
    /complete production build/,
  ],
  [
    "file/directory conflict",
    (m) => {
      m.files.push({ path: ".next/server", size: 0, sha256: hash("") });
    },
    /path conflict/,
  ],
]) {
  test(`rejects manifest ${name} mismatch`, async (t) => {
    const f = await prepared(t);
    changeManifest(f.entries, change);
    await rejectsArtifact(f, pack(f.entries), pattern);
  });
}

for (const path of [
  "../outside",
  "/tmp/outside",
  ".next/../../outside",
  ".next//outside",
  ".next/./outside",
  ".next/cache/bad",
  ".next\\bad",
  "C:/outside",
  ".next/line\nbreak",
  ".next/",
]) {
  test(`rejects unsafe member path ${JSON.stringify(path)} without out-of-tree writes`, async (t) => {
    const f = await prepared(t);
    const sentinel = join(f.base, "outside");
    await fs.writeFile(sentinel, "unchanged");
    f.entries.at(-1).path = path;
    await rejectsArtifact(f, pack(f.entries), /Unsafe archive path|inside .next/);
    assert.equal(await fs.readFile(sentinel, "utf8"), "unchanged");
  });
}
for (const [name, type] of [
  ["symlink", "2"],
  ["hardlink", "1"],
  ["directory", "5"],
  ["device", "3"],
  ["FIFO", "6"],
  ["PAX", "x"],
  ["GNU long path", "L"],
  ["sparse", "S"],
]) {
  test(`rejects ${name} tar members`, async (t) => {
    const f = await prepared(t);
    await rejectsArtifact(
      f,
      pack(f.entries, (header, entry) => {
        if (entry === f.entries.at(-1)) header[156] = type.charCodeAt(0);
      }),
      /Only regular tar files/,
    );
  });
}

test("rejects duplicate, missing, extra, resized and content-drift archive files", async (t) => {
  const f = await prepared(t);
  await rejectsArtifact(f, pack([...f.entries, f.entries[1]]), /Duplicate archive path/);
  await rejectsArtifact(f, pack(f.entries.slice(0, -1)), /missing manifest files/);
  await rejectsArtifact(
    f,
    pack([...f.entries, { ...f.entries[1], path: ".next/unlisted" }]),
    /differs from manifest/,
  );
  const resized = f.entries.map((entry, index) =>
    index === 1 ? { ...entry, data: Buffer.from("changed") } : entry,
  );
  await rejectsArtifact(f, pack(resized), /differs from manifest/);
  const changed = f.entries.map((entry, index) =>
    index === 1 ? { ...entry, data: Buffer.alloc(entry.data.length, 65) } : entry,
  );
  await rejectsArtifact(f, pack(changed), /content differs from manifest/);
});

test("rejects corrupt gzip, truncated headers/bodies, invalid checksums, and invalid end records", async (t) => {
  const f = await prepared(t);
  await rejectsArtifact(f, Buffer.from("not gzip"));
  await rejectsArtifact(f, f.bytes.subarray(0, -5));
  const corruptGzip = Buffer.from(f.bytes);
  corruptGzip[corruptGzip.length - 8] ^= 1;
  await rejectsArtifact(f, corruptGzip);
  const raw = gunzipSync(f.bytes);
  await rejectsArtifact(f, gzipSync(raw.subarray(0, 100)), /Truncated tar/);
  await rejectsArtifact(f, gzipSync(raw.subarray(0, 600)), /Truncated tar/);
  const corruptHeader = Buffer.from(raw);
  corruptHeader[0] ^= 1;
  await rejectsArtifact(f, gzipSync(corruptHeader), /header checksum/);
  await rejectsArtifact(f, pack(f.entries, undefined, Buffer.alloc(0)), /Missing tar end/);
  await rejectsArtifact(f, pack(f.entries, undefined, Buffer.alloc(512)), /Missing second/);
  await rejectsArtifact(f, pack(f.entries, undefined, Buffer.alloc(21 * 512)), /Excessive tar end/);
  await rejectsArtifact(
    f,
    pack(f.entries, undefined, Buffer.concat([Buffer.alloc(1024), Buffer.alloc(512, 65)])),
    /Nonzero data after/,
  );
  await rejectsArtifact(f, pack(f.entries, undefined, Buffer.alloc(1025)), /Truncated tar/);
});

test("rejects non-ustar, base-256 sizes, link metadata, special modes and nonzero padding", async (t) => {
  const f = await prepared(t);
  await rejectsArtifact(
    f,
    pack(f.entries, (h) => {
      h[257] = 88;
    }),
    /restricted ustar/,
  );
  await rejectsArtifact(
    f,
    pack(f.entries, (h) => {
      h[124] = 128;
    }),
    /numeric field/,
  );
  await rejectsArtifact(
    f,
    pack(f.entries, (h) => {
      h.write("target", 157);
    }),
    /links are forbidden/,
  );
  await rejectsArtifact(
    f,
    pack(f.entries, (h) => {
      h.write("0004755\0", 100);
    }),
    /permission bits/,
  );
  await rejectsArtifact(
    f,
    pack(f.entries, (h) => {
      h[329] = 49;
    }),
    /device metadata/,
  );
  const raw = gunzipSync(f.bytes);
  raw[512 + f.entries[0].data.length] = 65;
  await rejectsArtifact(f, gzipSync(raw), /Nonzero tar padding/);
});

test("rejects missing, oversized and malformed manifests", async (t) => {
  const f = await prepared(t);
  await rejectsArtifact(f, pack(f.entries.slice(1)), /First archive entry/);
  const malformed = [...f.entries];
  malformed[0] = { ...malformed[0], data: Buffer.from("not JSON") };
  await rejectsArtifact(f, pack(malformed));
  await rejectsArtifact(
    f,
    pack(f.entries, (h, entry) => {
      if (entry === f.entries[0])
        h.write((LIMITS.manifest + 1).toString(8).padStart(11, "0") + "\0", 124);
    }),
    /bounded manifest/,
  );
});

test("refuses existing candidate directories and dangling symlinks without modifying them", async (t) => {
  const f = await prepared(t);
  await put(join(f.next, "keep"), "live sentinel");
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /already exists/,
  );
  assert.equal(await fs.readFile(join(f.next, "keep"), "utf8"), "live sentinel");
  await fs.rm(f.next, { recursive: true });
  await fs.symlink(join(f.base, "missing"), f.next);
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /already exists/,
  );
  assert.equal((await fs.lstat(f.next)).isSymbolicLink(), true);
});

test("refuses symlinked repository roots and Web ancestors", async (t) => {
  const f = await prepared(t);
  const linked = join(f.base, "current");
  await fs.symlink(f.root, linked);
  await assert.rejects(
    installArtifact(linked, f.sha, f.archive, f.result.sha256, f.env),
    /symlink ancestors/,
  );
  await fs.rename(join(f.root, "apps/web"), join(f.base, "web"));
  await fs.symlink(join(f.base, "web"), join(f.root, "apps/web"));
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /symlink ancestors/,
  );
  assert.equal(await exists(join(f.base, "web/.next")), false);
});

test("source SHA, source dirt and dependency drift fail closed", async (t) => {
  const f = await prepared(t);
  await assert.rejects(
    installArtifact(f.root, "a".repeat(40), f.archive, f.result.sha256, f.env),
    /Source SHA mismatch/,
  );
  await put(join(f.root, "unexpected-source.js"), "untracked");
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /checkout must be clean/,
  );
  await fs.unlink(join(f.root, "unexpected-source.js"));
  await fs.appendFile(join(f.root, "pnpm-lock.yaml"), "changed\n");
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /checkout must be clean/,
  );
  git(f.root, "checkout", "--", "pnpm-lock.yaml");
  await put(
    join(f.root, "apps/web/node_modules/next/package.json"),
    JSON.stringify({ version: "16.0.0" }),
  );
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /Installed Next version/,
  );
});

test("rejects non-production origins, NODE_ENV, unknown public keys and broad web.env permissions", async (t) => {
  const f = await fixture(t);
  for (const env of [
    { ...ENV, NODE_ENV: "development" },
    { ...ENV, NEXT_PUBLIC_API_BASE_URL: "https://api.ayin.stream/" },
    { ...ENV, NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayin.stream.evil.invalid" },
    { ...ENV, NEXT_PUBLIC_UNKNOWN: "do not leak" },
  ]) {
    await assert.rejects(
      createArtifact(f.root, f.sha, f.archive, env),
      /production|origin|Unrecognized/,
    );
    assert.equal(await exists(f.archive), false);
  }
  const result = await createArtifact(f.root, f.sha, f.archive, ENV);
  await fs.rm(f.next, { recursive: true });
  await fs.appendFile(f.env, "NEXT_PUBLIC_UNREVIEWED=value\n");
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, result.sha256, f.env),
    /Unrecognized/,
  );
  await fs.chmod(f.env, 0o644);
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, result.sha256, f.env),
    /permissions are too broad/,
  );
});

test("creation rejects symlinks/hardlinks, missing build output and implicit Next env files", async (t) => {
  const f = await fixture(t);
  const bad = join(f.next, "server/bad");
  await fs.symlink(join(f.root, ".nvmrc"), bad);
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /non-regular/);
  await fs.unlink(bad);
  await fs.link(join(f.next, "BUILD_ID"), bad);
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /non-hardlinked/);
  await fs.unlink(bad);
  await put(join(f.root, "apps/web/.env.production"), "PRIVATE_SECRET=must not enter build\n");
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /Implicit Next environment/);
  await fs.unlink(join(f.root, "apps/web/.env.production"));
  await fs.unlink(join(f.next, "BUILD_ID"));
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /ENOENT/);
  assert.equal(await exists(f.archive), false);
});

test("creation requires baked production origins and standard next start output", async (t) => {
  const f = await fixture(t);
  await put(join(f.next, "routes-manifest.json"), JSON.stringify({ headers: [] }));
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /Built CSP/);
  await put(
    join(f.next, "required-server-files.json"),
    JSON.stringify({ config: { output: "standalone", distDir: ".next" } }),
  );
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /standard next start/);
});

test("creation never overwrites an existing artifact", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.archive, "sentinel");
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /EEXIST/);
  assert.equal(await fs.readFile(f.archive, "utf8"), "sentinel");
});

test("CLI validates argument contract and emits JSON on success", async (t) => {
  const f = await fixture(t);
  const bad = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Usage:/);
  const created = spawnSync(process.execPath, [script, "create", f.root, f.sha, f.archive], {
    encoding: "utf8",
    env: { ...process.env, ...ENV },
  });
  assert.equal(created.status, 0, created.stderr);
  const result = JSON.parse(created.stdout);
  await fs.rm(f.next, { recursive: true });
  const installed = spawnSync(
    process.execPath,
    [script, "install", f.root, f.sha, f.archive, result.sha256, f.env],
    { encoding: "utf8" },
  );
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).sourceSha, f.sha);
});

test("rejects compressed and individual file size limits without reading oversized files", async (t) => {
  const f = await prepared(t);
  await fs.truncate(f.archive, LIMITS.archive + 1);
  await assert.rejects(
    installArtifact(f.root, f.sha, f.archive, f.result.sha256, f.env),
    /Compressed archive exceeds/,
  );
  assert.equal(await exists(f.next), false);
  await fs.writeFile(f.archive, "");
  await assert.rejects(installArtifact(f.root, f.sha, f.archive, hash(""), f.env), /empty/);
  await fs.unlink(f.archive);
  await fs.mkdir(f.next);
  const large = join(f.next, "oversized-file");
  await fs.writeFile(large, "");
  await fs.truncate(large, LIMITS.file + 1);
  await assert.rejects(createArtifact(f.root, f.sha, f.archive, ENV), /File exceeds size limit/);
  assert.equal(await exists(f.archive), false);
});

test("rejects manifest expanded-size budget before extraction", async (t) => {
  const f = await prepared(t);
  changeManifest(f.entries, (manifest) => {
    manifest.files = Array.from({ length: 9 }, (_, index) => ({
      path: `.next/large-${index}`,
      size: LIMITS.file,
      sha256: hash(""),
    }));
    manifest.totalBytes = 9 * LIMITS.file;
  });
  await rejectsArtifact(f, pack(f.entries), /expanded size limit/);
});

test("rejects archive symlinks, hardlinks and FIFOs without following or blocking", async (t) => {
  const f = await prepared(t);
  const alias = join(f.base, "archive-alias");
  await fs.symlink(f.archive, alias);
  await assert.rejects(
    installArtifact(f.root, f.sha, alias, f.result.sha256, f.env),
    /regular non-hardlinked/,
  );
  await fs.unlink(alias);
  await fs.link(f.archive, alias);
  await assert.rejects(
    installArtifact(f.root, f.sha, alias, f.result.sha256, f.env),
    /regular non-hardlinked/,
  );
  await fs.unlink(alias);
  execFileSync("mkfifo", [alias]);
  await assert.rejects(
    installArtifact(f.root, f.sha, alias, f.result.sha256, f.env),
    /regular non-hardlinked/,
  );
  assert.equal(await exists(f.next), false);
});

test("rejects a checkout whose Node pin differs from the executing runtime", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(join(f.root, ".nvmrc"), "0.0.0\n");
  git(f.root, "add", ".nvmrc");
  git(
    f.root,
    "-c",
    "user.name=Artifact Tests",
    "-c",
    "user.email=artifact-tests@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "wrong Node pin",
  );
  await assert.rejects(
    createArtifact(f.root, git(f.root, "rev-parse", "HEAD"), f.archive, ENV),
    /Node runtime must exactly match/,
  );
});

test("rejects unsafe manifest paths before creating the candidate directory", async (t) => {
  const f = await prepared(t);
  changeManifest(f.entries, (manifest) => {
    manifest.files[0].path = ".next/../../outside";
  });
  await rejectsArtifact(f, pack(f.entries), /Unsafe archive path/);
});

test("rejects internally rehashed build metadata drift and cleans the candidate", async (t) => {
  const f = await prepared(t);
  const route = f.entries.find((entry) => entry.path === ".next/routes-manifest.json");
  route.data = Buffer.from(JSON.stringify({ headers: [] }));
  changeManifest(f.entries, (manifest) => {
    const file = manifest.files.find((item) => item.path === route.path);
    manifest.totalBytes += route.data.length - file.size;
    file.size = route.data.length;
    file.sha256 = hash(route.data);
  });
  await rejectsArtifact(f, pack(f.entries), /Built CSP/);
});

test("rejects hidden high-bit numeric fields rather than masking them to ASCII", async (t) => {
  const f = await prepared(t);
  await rejectsArtifact(
    f,
    pack(f.entries, (header) => {
      header[124] = 0xb0;
    }),
    /numeric field/,
  );
});

test("create is deterministic and refuses archives inside the build directory", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    createArtifact(f.root, f.sha, join(f.next, "archive.tar.gz"), ENV),
    /inside build output/,
  );
  const one = await createArtifact(f.root, f.sha, f.archive, ENV);
  const two = await createArtifact(f.root, f.sha, join(f.base, "second.tar.gz"), ENV);
  assert.equal(one.sha256, two.sha256);
});
