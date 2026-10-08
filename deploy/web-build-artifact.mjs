#!/usr/bin/env node
// Single-use CI artifact transport. This never changes services, env files, or release links.
// The trusted SHA256 must arrive independently of the archive (from the gated CI job).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import envFile from "./env-file.cjs";

export const LIMITS = Object.freeze({
  archive: 512 * 1024 * 1024,
  expanded: 1024 * 1024 * 1024,
  file: 128 * 1024 * 1024,
  manifest: 8 * 1024 * 1024,
  files: 20000,
});
const MANIFEST = "web-build-manifest.json";
const PUBLIC_KEYS = [
  "NEXT_PUBLIC_API_BASE_URL",
  "NEXT_PUBLIC_MEDIA_BASE_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_WEB_BASE_URL",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
];
const REQUIRED_FILES = [
  ".next/BUILD_ID",
  ".next/build-manifest.json",
  ".next/routes-manifest.json",
  ".next/prerender-manifest.json",
  ".next/required-server-files.json",
  ".next/server/app-paths-manifest.json",
];
const hasControlCharacters = (value) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const fail = (message) => {
  throw new Error(message);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sameKeys = (value, keys) =>
  plainObject(value) && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
const validDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function buildEnvironment(environment) {
  check(environment.NODE_ENV === "production", "NODE_ENV must be production");
  for (const key of Object.keys(environment)) {
    check(
      !key.startsWith("NEXT_PUBLIC_") || PUBLIC_KEYS.includes(key),
      "Unrecognized public build environment key",
    );
  }
  const result = { NODE_ENV: "production" };
  for (const key of PUBLIC_KEYS) {
    const value = environment[key] ?? "";
    check(
      typeof value === "string" && value.length <= 4096 && !hasControlCharacters(value),
      `Invalid ${key}`,
    );
    result[key] = value;
  }
  check(
    result.NEXT_PUBLIC_API_BASE_URL === "https://api.ayin.stream",
    "API build origin must be https://api.ayin.stream",
  );
  check(
    result.NEXT_PUBLIC_MEDIA_BASE_URL === "https://media.ayin.stream",
    "Media build origin must be https://media.ayin.stream",
  );
  return result;
}

async function realDirectory(path) {
  const stat = await fs.lstat(path);
  check(
    stat.isDirectory() && !stat.isSymbolicLink() && (await fs.realpath(path)) === resolve(path),
    "Repository/build directory must be a real directory without symlink ancestors",
  );
}

async function regularFile(path) {
  const before = await fs.lstat(path);
  check(before.isFile() && before.nlink === 1, "Only regular non-hardlinked files are allowed");
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    check(stat.isFile() && stat.nlink === 1, "Only regular non-hardlinked files are allowed");
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function hashFile(path, max = LIMITS.file) {
  const { handle, stat } = await regularFile(path);
  try {
    check(stat.size <= max, "File exceeds size limit");
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      size += chunk.length;
      check(size <= max, "File exceeds size limit");
      hash.update(chunk);
    }
    check(size === stat.size, "File changed while reading");
    return { size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function sourceIdentity(repoRoot, sourceSha) {
  check(
    /^[0-9a-f]{40}$/.test(sourceSha),
    "Source SHA must be a lowercase full 40-character commit id",
  );
  await realDirectory(repoRoot);
  await realDirectory(join(repoRoot, "apps"));
  await realDirectory(join(repoRoot, "apps/web"));
  const gitEnv = { ...process.env };
  for (const key of Object.keys(gitEnv)) if (key.startsWith("GIT_")) delete gitEnv[key];
  const git = (...args) =>
    execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      env: gitEnv,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  check(git("rev-parse", "--show-toplevel") === repoRoot, "Repository root mismatch");
  check(git("rev-parse", "HEAD") === sourceSha, "Source SHA mismatch");
  check(
    git("status", "--porcelain", "--untracked-files=normal") === "",
    "Source checkout must be clean",
  );
  // Next automatically reads these files; CI must not have hidden build-time inputs.
  for (const base of [repoRoot, join(repoRoot, "apps/web")]) {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      try {
        await fs.lstat(join(base, name));
        fail("Implicit Next environment files are forbidden");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  const nodeVersion = (await fs.readFile(join(repoRoot, ".nvmrc"), "utf8"))
    .trim()
    .replace(/^v/, "");
  check(
    /^\d+\.\d+\.\d+$/.test(nodeVersion) && nodeVersion === process.versions.node,
    "Node runtime must exactly match .nvmrc",
  );
  const pkg = JSON.parse(await fs.readFile(join(repoRoot, "apps/web/package.json"), "utf8"));
  const installed = JSON.parse(
    await fs.readFile(join(repoRoot, "apps/web/node_modules/next/package.json"), "utf8"),
  );
  check(
    /^\d+\.\d+\.\d+$/.test(pkg.dependencies?.next) && installed.version === pkg.dependencies.next,
    "Installed Next version must match the exact source pin",
  );
  const rootPkg = JSON.parse(await fs.readFile(join(repoRoot, "package.json"), "utf8"));
  check(/^pnpm@\d+\.\d+\.\d+$/.test(rootPkg.packageManager), "An exact pnpm version is required");
  return {
    sourceSha,
    nodeVersion,
    platform: process.platform,
    arch: process.arch,
    nextVersion: installed.version,
    packageManager: rootPkg.packageManager,
    lockfileSha256: (await hashFile(join(repoRoot, "pnpm-lock.yaml"))).sha256,
  };
}

function safePath(path) {
  check(
    typeof path === "string" &&
      path.length > 0 &&
      Buffer.byteLength(path) <= 256 &&
      !/[\\:]/.test(path) &&
      !hasControlCharacters(path),
    "Unsafe archive path",
  );
  const segments = path.split("/");
  check(
    segments.every((part) => part && part !== "." && part !== ".."),
    "Unsafe archive path",
  );
  check(
    path.startsWith(".next/") && segments.length >= 2 && segments[1] !== "cache",
    "Archive path must be inside .next and outside cache",
  );
  return path;
}

async function inventory(webRoot) {
  await realDirectory(join(webRoot, ".next"));
  const files = [];
  let totalBytes = 0;
  async function walk(relative) {
    for (const entry of (await fs.readdir(join(webRoot, relative), { withFileTypes: true })).sort(
      (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )) {
      const path = `${relative}/${entry.name}`;
      if (path === ".next/cache") continue;
      safePath(path);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      check(entry.isFile() && !entry.isSymbolicLink(), "Build output contains a non-regular file");
      check(files.length < LIMITS.files, "Too many build files");
      const digest = await hashFile(join(webRoot, path));
      totalBytes += digest.size;
      check(
        totalBytes <= LIMITS.expanded - LIMITS.manifest - (LIMITS.files + 1) * 1024,
        "Build output exceeds expanded size limit",
      );
      files.push({ path, ...digest });
    }
  }
  await walk(".next");
  return { files, totalBytes };
}

async function checkBuild(nextRoot) {
  for (const path of REQUIRED_FILES) {
    const stat = await fs.lstat(join(nextRoot, path.slice(".next/".length)));
    check(
      stat.isFile() && stat.size > 0 && stat.size <= LIMITS.file,
      "Incomplete Next production build",
    );
  }
  const buildId = await fs.readFile(join(nextRoot, "BUILD_ID"), "utf8");
  check(/^[A-Za-z0-9_-]{1,200}\n?$/.test(buildId), "Invalid Next BUILD_ID");
  const required = JSON.parse(
    await fs.readFile(join(nextRoot, "required-server-files.json"), "utf8"),
  );
  check(
    required.config?.distDir === ".next" && !required.config?.output,
    "Artifact must use the standard next start runtime",
  );
  const media = required.config?.images?.remotePatterns;
  check(
    Array.isArray(media) &&
      media.some(
        (p) =>
          p.protocol === "https" &&
          p.hostname === "media.ayin.stream" &&
          !p.port &&
          p.pathname === "/**",
      ),
    "Built media configuration is not production",
  );
  const routes = JSON.parse(await fs.readFile(join(nextRoot, "routes-manifest.json"), "utf8"));
  const csp = routes.headers
    ?.find((entry) => entry.source === "/:path*")
    ?.headers?.find((header) => header.key.toLowerCase() === "content-security-policy")?.value;
  const directives =
    typeof csp === "string" ? csp.split(";").map((part) => part.trim().split(/\s+/)) : [];
  const connect = directives.find(([name]) => name === "connect-src") ?? [];
  check(
    connect.includes("https://api.ayin.stream") &&
      connect.includes("https://media.ayin.stream") &&
      directives.some(([name]) => name === "upgrade-insecure-requests"),
    "Built CSP does not contain production origins",
  );
}

function octal(buffer, offset, length, value) {
  const digits = value.toString(8);
  check(digits.length < length, "Tar numeric field overflow");
  buffer.write(digits.padStart(length - 1, "0") + "\0", offset, length, "ascii");
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const split = [...path.matchAll(/\//g)]
      .map((match) => match.index)
      .reverse()
      .find(
        (index) =>
          Buffer.byteLength(path.slice(0, index)) <= 155 &&
          Buffer.byteLength(path.slice(index + 1)) <= 100,
      );
    check(split !== undefined, "Path cannot be represented by restricted ustar");
    prefix = path.slice(0, split);
    name = path.slice(split + 1);
  }
  header.write(name, 0, 100, "utf8");
  octal(header, 100, 8, 0o644);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write(prefix, 345, 155, "utf8");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}
const padding = (size) => (512 - (size % 512)) % 512;

export async function createArtifact(repo, sourceSha, archive, environment = process.env) {
  const repoRoot = resolve(repo);
  const archivePath = resolve(archive);
  check(
    !archivePath.startsWith(`${join(repoRoot, "apps/web/.next")}/`),
    "Archive cannot be inside build output",
  );
  const buildEnv = buildEnvironment(environment);
  const identity = await sourceIdentity(repoRoot, sourceSha);
  const webRoot = join(repoRoot, "apps/web");
  const listing = await inventory(webRoot);
  await checkBuild(join(webRoot, ".next"));
  const manifest = { schemaVersion: 1, ...identity, buildEnv, ...listing };
  validateManifest(manifest, identity, buildEnv);
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  check(manifestBytes.length <= LIMITS.manifest, "Manifest exceeds size limit");
  async function* tar() {
    yield tarHeader(MANIFEST, manifestBytes.length);
    yield manifestBytes;
    yield Buffer.alloc(padding(manifestBytes.length));
    for (const file of listing.files) {
      yield tarHeader(file.path, file.size);
      const { handle } = await regularFile(join(webRoot, file.path));
      try {
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
          bytes += chunk.length;
          check(bytes <= file.size, "Build output changed during packaging");
          hash.update(chunk);
          yield chunk;
        }
        check(
          bytes === file.size && hash.digest("hex") === file.sha256,
          "Build output changed during packaging",
        );
      } finally {
        await handle.close();
      }
      yield Buffer.alloc(padding(file.size));
    }
    yield Buffer.alloc(1024);
  }
  const output = await fs.open(archivePath, "wx", 0o600);
  try {
    let bytes = 0;
    const bound = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > LIMITS.archive ? new Error("Compressed archive exceeds size limit") : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.from(tar()),
      createGzip({ level: 6 }),
      bound,
      createWriteStream(archivePath, { fd: output.fd, autoClose: false }),
    );
    check(
      JSON.stringify(await inventory(webRoot)) === JSON.stringify(listing),
      "Build output changed during packaging",
    );
    check(
      JSON.stringify(await sourceIdentity(repoRoot, sourceSha)) === JSON.stringify(identity),
      "Source identity changed during packaging",
    );
  } catch (error) {
    await fs.unlink(archivePath);
    throw error;
  } finally {
    await output.close();
  }
  return {
    archivePath,
    sha256: (await hashFile(archivePath, LIMITS.archive)).sha256,
    sourceSha,
    fileCount: listing.files.length,
    totalBytes: listing.totalBytes,
  };
}

function parseHeader(header) {
  const string = (offset, length) => {
    const raw = header.subarray(offset, offset + length);
    const end = raw.indexOf(0);
    check(end < 0 || raw.subarray(end).every((byte) => byte === 0), "Invalid tar string field");
    return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? raw : raw.subarray(0, end));
  };
  const number = (offset, length) => {
    check(
      header.subarray(offset, offset + length).every((byte) => byte < 128),
      "Invalid tar numeric field",
    );
    const field = header.subarray(offset, offset + length).toString("ascii");
    check(/^[0-7]+[\0 ]*$/.test(field), "Invalid tar numeric field");
    const value = Number.parseInt(field, 8);
    check(Number.isSafeInteger(value), "Invalid tar numeric value");
    return value;
  };
  check(
    header.subarray(257, 263).equals(Buffer.from("ustar\0")) &&
      header.subarray(263, 265).toString() === "00",
    "Only restricted ustar archives are accepted",
  );
  const checksum = header.reduce(
    (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
    0,
  );
  check(number(148, 8) === checksum, "Invalid tar header checksum");
  check(
    header[156] === 48 || header[156] === 0,
    "Only regular tar files are accepted; links and special entries are forbidden",
  );
  check(
    header.subarray(157, 257).every((byte) => byte === 0),
    "Tar links are forbidden",
  );
  check(
    header.subarray(500).every((byte) => byte === 0),
    "Unexpected tar header extension",
  );
  check(number(100, 8) <= 0o777, "Special tar permission bits are forbidden");
  number(108, 8);
  number(116, 8);
  number(136, 12);
  for (const offset of [329, 337])
    check(
      header.subarray(offset, offset + 8).every((byte) => byte === 0 || byte === 48 || byte === 32),
      "Tar device metadata is forbidden",
    );
  const prefix = string(345, 155);
  const name = string(0, 100);
  return { path: prefix ? `${prefix}/${name}` : name, size: number(124, 12) };
}

// Reads at most a zlib chunk plus the requested field. Expanded-byte accounting
// includes headers, file padding, and the tail, preventing compressed-size bombs.
class TarReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.chunk = Buffer.alloc(0);
    this.expanded = 0;
  }
  async take(length, allowEnd = false) {
    const parts = [];
    let remaining = length;
    while (remaining > 0) {
      if (!this.chunk.length) {
        const next = await this.iterator.next();
        if (next.done) {
          if (allowEnd && remaining === length) return null;
          fail("Truncated tar archive");
        }
        this.expanded += next.value.length;
        check(this.expanded <= LIMITS.expanded, "Expanded archive exceeds size limit");
        this.chunk = next.value;
      }
      const count = Math.min(remaining, this.chunk.length);
      parts.push(this.chunk.subarray(0, count));
      this.chunk = this.chunk.subarray(count);
      remaining -= count;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, length);
  }
}

function validateManifest(manifest, identity, buildEnv) {
  check(
    sameKeys(manifest, [
      "schemaVersion",
      ...Object.keys(identity),
      "buildEnv",
      "files",
      "totalBytes",
    ]) && manifest.schemaVersion === 1,
    "Invalid artifact manifest schema",
  );
  for (const [key, value] of Object.entries(identity))
    check(manifest[key] === value, `Artifact ${key} mismatch`);
  check(sameKeys(manifest.buildEnv, Object.keys(buildEnv)), "Invalid artifact build environment");
  for (const [key, value] of Object.entries(buildEnv))
    check(manifest.buildEnv[key] === value, `Artifact ${key} mismatch`);
  check(
    Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length <= LIMITS.files,
    "Invalid manifest file count",
  );
  const files = new Map();
  let total = 0;
  for (const file of manifest.files) {
    check(sameKeys(file, ["path", "size", "sha256"]), "Invalid manifest file entry");
    safePath(file.path);
    check(!files.has(file.path), "Duplicate manifest path");
    check(
      Number.isSafeInteger(file.size) &&
        file.size >= 0 &&
        file.size <= LIMITS.file &&
        validDigest(file.sha256),
      "Invalid manifest file size or digest",
    );
    files.set(file.path, file);
    total += file.size;
    check(total <= LIMITS.expanded, "Manifest exceeds expanded size limit");
  }
  for (const path of files.keys()) {
    let parent = dirname(path);
    while (parent !== ".next") {
      check(!files.has(parent), "Manifest has a file/directory path conflict");
      parent = dirname(parent);
    }
  }
  check(total === manifest.totalBytes, "Manifest byte total mismatch");
  check(
    REQUIRED_FILES.every((path) => files.has(path)) &&
      [...files.keys()].some((path) => path.startsWith(".next/static/")),
    "Manifest lacks a complete production build",
  );
  return files;
}

async function mustNotExist(path) {
  try {
    await fs.lstat(path);
    fail("Candidate .next already exists; refusing to overwrite it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function installArtifact(repo, sourceSha, archive, expectedSha256, webEnvPath) {
  check(validDigest(expectedSha256), "Expected archive SHA256 must be lowercase hexadecimal");
  const repoRoot = resolve(repo);
  const archivePath = resolve(archive);
  const { handle, stat } = await regularFile(archivePath);
  let staging;
  let compressed;
  let decoded;
  let decoding;
  const target = join(repoRoot, "apps/web/.next");
  try {
    check(
      stat.size > 0 && stat.size <= LIMITS.archive,
      "Compressed archive exceeds size limit or is empty",
    );
    const digest = createHash("sha256");
    let compressedBytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      compressedBytes += chunk.length;
      check(compressedBytes <= LIMITS.archive, "Compressed archive exceeds size limit");
      digest.update(chunk);
    }
    check(
      compressedBytes === stat.size && digest.digest("hex") === expectedSha256,
      "Artifact SHA256 mismatch",
    );
    // No decompression or filesystem writes happen before the trusted hash check.
    await mustNotExist(target);
    const identity = await sourceIdentity(repoRoot, sourceSha);
    envFile.assertPrivateFilePermissions(webEnvPath);
    const buildEnv = buildEnvironment(envFile.loadEnvFile(webEnvPath));
    const secondDigest = createHash("sha256");
    let rereadBytes = 0;
    compressed = handle.createReadStream({ autoClose: false, start: 0 });
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        rereadBytes += chunk.length;
        secondDigest.update(chunk);
        callback(
          rereadBytes > LIMITS.archive ? new Error("Compressed archive exceeds size limit") : null,
          chunk,
        );
      },
    });
    decoded = createGunzip();
    decoding = pipeline(compressed, meter, decoded);
    // Attach a rejection handler now; the parser can reject before the pipeline does.
    decoding.catch(() => {});
    const reader = new TarReader(decoded);
    const first = parseHeader(await reader.take(512));
    check(
      first.path === MANIFEST && first.size > 0 && first.size <= LIMITS.manifest,
      "First archive entry must be a bounded manifest",
    );
    const manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await reader.take(first.size)),
    );
    check(
      (await reader.take(padding(first.size))).every((byte) => byte === 0),
      "Nonzero tar padding",
    );
    const files = validateManifest(manifest, identity, buildEnv);
    // This candidate is not active. Exclusive mkdir refuses even a dangling symlink.
    await fs.mkdir(target, { mode: 0o700 });
    staging = target;
    const seen = new Set();
    let tailBlocks = 0;
    while (true) {
      const header = await reader.take(512, true);
      check(header !== null, "Missing tar end records");
      if (header.every((byte) => byte === 0)) {
        tailBlocks = 1;
        let tail;
        while ((tail = await reader.take(512, true)) !== null) {
          check(
            tail.every((byte) => byte === 0),
            "Nonzero data after tar end record",
          );
          check(++tailBlocks <= 20, "Excessive tar end padding");
        }
        check(tailBlocks >= 2, "Missing second tar end record");
        break;
      }
      const entry = parseHeader(header);
      safePath(entry.path);
      check(!seen.has(entry.path), "Duplicate archive path");
      const file = files.get(entry.path);
      check(file && file.size === entry.size, "Archive member differs from manifest");
      seen.add(entry.path);
      const destination = join(staging, entry.path.slice(".next/".length));
      await fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const output = await fs.open(destination, "wx", 0o600);
      try {
        const hash = createHash("sha256");
        for (let remaining = entry.size; remaining > 0;) {
          const chunk = await reader.take(Math.min(remaining, 65536));
          hash.update(chunk);
          await output.writeFile(chunk);
          remaining -= chunk.length;
        }
        check(hash.digest("hex") === file.sha256, "Archive file content differs from manifest");
      } finally {
        await output.close();
      }
      check(
        (await reader.take(padding(entry.size))).every((byte) => byte === 0),
        "Nonzero tar padding",
      );
    }
    await decoding;
    check(
      rereadBytes === stat.size && secondDigest.digest("hex") === expectedSha256,
      "Artifact changed while installing",
    );
    check(seen.size === files.size, "Archive is missing manifest files");
    await checkBuild(staging);
    check(
      JSON.stringify(await sourceIdentity(repoRoot, sourceSha)) === JSON.stringify(identity),
      "Source identity changed while installing",
    );
    staging = undefined;
    return {
      sourceSha,
      sha256: expectedSha256,
      fileCount: files.size,
      totalBytes: manifest.totalBytes,
    };
  } finally {
    compressed?.destroy();
    decoded?.destroy();
    if (decoding) await decoding.catch(() => {});
    await handle.close();
    if (staging) await fs.rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create" && args.length === 3) return createArtifact(...args);
  if (command === "install" && args.length === 5) return installArtifact(...args);
  fail(
    "Usage: web-build-artifact.mjs create <repoRoot> <sha> <archivePath> | install <repoRoot> <sha> <archivePath> <expectedSha256> <webEnvFile>",
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`Web artifact rejected: ${error.message}`);
      process.exitCode = 1;
    });
}
