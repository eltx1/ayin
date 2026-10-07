import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, availableParallelism, cpus, platform, totalmem } from "node:os";
import path from "node:path";

async function packageManifest(requirePackage: NodeJS.Require, name: string) {
  try {
    return requirePackage.resolve(`${name}/package.json`);
  } catch {
    // Some package exports intentionally hide package.json. Resolve the actual
    // entry, then identify its nearest owning manifest without loading its code.
    let directory = path.dirname(requirePackage.resolve(name));
    for (let level = 0; level < 8; level++) {
      const file = path.join(directory, "package.json");
      try {
        if (JSON.parse(await readFile(file, "utf8")).name === name) return file;
      } catch {
        /* Keep walking only this resolved dependency's parent directories. */
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`Could not identify the resolved ${name} manifest`);
  }
}

export async function runtimeSourceEvidence(browserVersion: string, additionalSources: string[]) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const artifacts: Record<string, string | null> = {};
  git(
    "ls-files",
    "--error-unmatch",
    ...additionalSources,
    "tests/e2e/performance-lab-provenance.ts",
    "tests/e2e/performance-lab-observer.ts",
    "tests/e2e/performance-lab-profiles.ts",
    "tests/e2e/product-performance-fixture.mjs",
  );
  for (const file of [
    "apps/web/.next/BUILD_ID",
    "apps/web/.next/build-manifest.json",
    "apps/api/dist/main.js",
    "packages/db/src/generated/prisma/internal/class.ts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    try {
      artifacts[file] = createHash("sha256")
        .update(await readFile(path.resolve(process.env.AYIN_LAB_RUNTIME_ROOT ?? ".", file)))
        .digest("hex");
    } catch {
      artifacts[file] = null;
    }
  }
  const runtimeRoot = path.resolve(process.env.AYIN_LAB_RUNTIME_ROOT ?? ".");
  const resolvedPackages: Record<string, string | null> = {};
  for (const [from, name] of [
    ["apps/web", "next"],
    ["apps/web", "react"],
    ["apps/web", "react-dom"],
    ["apps/web", "hls.js"],
    ["apps/api", "@nestjs/core"],
    ["apps/api", "fastify"],
    ["packages/db", "prisma"],
    ["packages/db", "@prisma/client"],
    ["packages/db", "@prisma/adapter-pg"],
    ["packages/db", "pg"],
    [".", "@playwright/test"],
  ]) {
    const requirePackage = createRequire(path.join(runtimeRoot, from!, "package.json"));
    try {
      resolvedPackages[name!] = JSON.parse(
        await readFile(await packageManifest(requirePackage, name!), "utf8"),
      ).version;
    } catch {
      resolvedPackages[name!] = null;
    }
  }
  // Record the security overrides from their actual transitive resolution paths.
  for (const [from, parent, name] of [
    ["apps/web", "next", "source-map-js"],
    ["packages/db", "prisma", "mysql2"],
  ]) {
    try {
      const requirePackage = createRequire(path.join(runtimeRoot, from!, "package.json"));
      const requireParent = createRequire(await packageManifest(requirePackage, parent!));
      resolvedPackages[name!] = JSON.parse(
        await readFile(await packageManifest(requireParent, name!), "utf8"),
      ).version;
    } catch {
      resolvedPackages[name!] = null;
    }
  }
  return {
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    trackedWorktreeClean: git("status", "--porcelain", "--untracked-files=no").length === 0,
    node: process.version,
    chromium: browserVersion,
    host: {
      platform: platform(),
      architecture: arch(),
      availableParallelism: availableParallelism(),
      cpuModel: cpus()[0]?.model ?? null,
      totalMemoryBytes: totalmem(),
    },
    runtime: {
      declaredBuildCommit: process.env.AYIN_LAB_RUNTIME_COMMIT ?? null,
      declaredBuildTree: process.env.AYIN_LAB_RUNTIME_TREE ?? null,
      declaredApiBuildCommit: process.env.AYIN_LAB_API_BUILD_COMMIT ?? null,
      declaredApiBuildTree: process.env.AYIN_LAB_API_BUILD_TREE ?? null,
      apiRuntimeMode: process.env.AYIN_LAB_API_RUNTIME_MODE ?? null,
      declaredApplicationScope: process.env.AYIN_LAB_RUNTIME_SCOPE ?? null,
      artifactSha256: artifacts,
      resolvedPackages,
      note: "Artifact hashes identify inspected local outputs; runtime provenance requires the separately retained build/start command. A null declaration is unverified, not an assumed source match.",
    },
  };
}
