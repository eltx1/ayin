import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaScratchService,
  linuxProcessStart,
  localProcessUsesDirectory,
} from "./media-scratch.service.js";

const ready = () => Promise.resolve({ status: "READY", leaseOwner: null, leaseExpiresAt: null });
const marker = ".ayin-scratch-owner.json";
let root: string;
const children: ChildProcess[] = [];
const services: MediaScratchService[] = [];
function makeScratch() {
  const result = new MediaScratchService();
  services.push(result);
  // The filesystem tests isolate process inspection; the real open-FD guard has its own child test.
  vi.spyOn(
    result as unknown as { processUsesDirectory(path: string): Promise<boolean> },
    "processUsesDirectory",
  ).mockResolvedValue(false);
  return result;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ayin-scratch-test-"));
  vi.stubEnv("MEDIA_PROCESSING_WORKDIR", root);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const service of services.splice(0)) await service.onModuleDestroy();
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function age(directory: string) {
  const past = new Date(Date.now() - 120_000);
  await utimes(directory, past, past);
}
async function retained(scratch: MediaScratchService) {
  const directory = await scratch.create(randomUUID(), randomUUID());
  await writeFile(join(directory, "canonical.mp4"), "verified local media bytes");
  await scratch.seal(directory);
  const remove = vi.spyOn(scratch as unknown as { remove(path: string): Promise<void> }, "remove");
  remove.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
  await scratch.release(directory);
  remove.mockRestore();
  await age(directory);
  return directory;
}
async function deadOwner(directory: string, settled = false) {
  const owner = JSON.parse(await readFile(join(directory, marker), "utf8"));
  owner.localWorkSettled = settled;
  owner.pid = 2_147_483_647;
  owner.start = "1";
  await writeFile(join(directory, marker), JSON.stringify(owner));
  await age(directory);
}

describe("automatic local media scratch lifecycle", () => {
  it("removes the whole owned directory immediately, including local inputs and nested renditions", async () => {
    const scratch = makeScratch();
    const directory = await scratch.create(randomUUID(), randomUUID());
    await mkdir(join(directory, "hls"));
    await writeFile(join(directory, "hls", "1.ts"), "segment");
    await writeFile(join(directory, "input.mp4"), "source");
    await scratch.release(directory);
    expect(await readdir(root)).toEqual([]);
  });
  it("logs a failed immediate delete and retries automatically without a new upload", async () => {
    const scratch = makeScratch();
    await retained(scratch);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining("cleanup_failed"));
    await scratch.sweep(ready);
    expect(await readdir(root)).toEqual([]);
  });
  it("preserves retry authority after a partial payload deletion fails", async () => {
    const scratch = makeScratch();
    const directory = await scratch.create(randomUUID(), randomUUID());
    await writeFile(join(directory, "input.mp4"), "source media payload");
    await writeFile(join(directory, "canonical.mp4"), "canonical media payload");
    await scratch.seal(directory);
    let attempted = 0;
    const entry = vi.spyOn(
      scratch as unknown as { removeEntry(path: string): Promise<void> },
      "removeEntry",
    );
    entry.mockImplementation(async (path) => {
      if (++attempted === 2) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      await rm(path, { recursive: true, force: true });
    });
    await scratch.release(directory);
    expect(attempted).toBe(2);
    const remaining = await readdir(directory);
    expect(remaining).toContain(marker);
    expect(remaining.filter((name) => name.endsWith(".mp4"))).toHaveLength(1);
    entry.mockRestore();
    await age(directory);
    await scratch.sweep(ready);
    expect(await readdir(root)).toEqual([]);
  });
  it("never deletes active local work even when READY has already been committed", async () => {
    const scratch = makeScratch();
    const directory = await scratch.create(randomUUID(), randomUUID());
    await age(directory);
    const lookup = vi.fn(ready);
    await scratch.sweep(lookup);
    expect(await readdir(root)).toHaveLength(1);
    expect(lookup).not.toHaveBeenCalled();
    await scratch.release(directory);
  });
  it("a replacement service does not delete directories owned by a live process", async () => {
    const directory = await retained(makeScratch());
    const owner = JSON.parse(await readFile(join(directory, marker), "utf8"));
    owner.localWorkSettled = false;
    await writeFile(join(directory, marker), JSON.stringify(owner));
    await makeScratch().sweep(ready);
    expect(await readdir(directory)).toContain("canonical.mp4");
  });
  it("reclaims sealed successful work after restart even when global process inspection is denied", async () => {
    const directory = await retained(makeScratch());
    await deadOwner(directory, true);
    const replacement = makeScratch();
    const probe = vi.mocked(
      (replacement as unknown as { processUsesDirectory(path: string): Promise<boolean> })
        .processUsesDirectory,
    );
    probe.mockResolvedValue(true);
    await replacement.sweep(ready);
    expect(probe).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
  it("a durable completion seal still cannot bypass an active database lease", async () => {
    const directory = await retained(makeScratch());
    await deadOwner(directory, true);
    await makeScratch().sweep(async () => ({
      status: "PROCESSING",
      leaseOwner: "held",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }));
    expect(await readdir(root)).toHaveLength(1);
  });
  it("reclaims a crash orphan only after verifying its owner is gone and the job is inactive", async () => {
    const directory = await retained(makeScratch());
    await deadOwner(directory);
    await makeScratch().sweep(ready);
    expect(await readdir(root)).toEqual([]);
  });
  it.each([
    { status: "PROCESSING", leaseOwner: null, leaseExpiresAt: new Date(0) },
    { status: "READY", leaseOwner: "still-owned", leaseExpiresAt: null },
    { status: "READY", leaseOwner: null, leaseExpiresAt: new Date(Date.now() + 60_000) },
  ])("preserves a job that still has active processing or lease evidence %j", async (state) => {
    const directory = await retained(makeScratch());
    await deadOwner(directory);
    await makeScratch().sweep(async () => state);
    expect(await readdir(root)).toHaveLength(1);
  });
  it("database failures and missing jobs fail closed; a later successful lookup retries", async () => {
    const directory = await retained(makeScratch());
    await deadOwner(directory);
    const replacement = makeScratch();
    await replacement.sweep(async () => {
      throw new Error("database unavailable");
    });
    await replacement.sweep(async () => null);
    expect(await readdir(root)).toHaveLength(1);
    await replacement.sweep(ready);
    expect(await readdir(root)).toEqual([]);
  });
  it("does not follow directory or marker symlinks, and does not delete unknown legacy directories", async () => {
    const external = await mkdtemp(join(tmpdir(), "ayin-external-test-"));
    try {
      await writeFile(join(external, "keep.mp4"), "outside");
      await symlink(external, join(root, `${randomUUID()}-0123456789abcdef`));
      await mkdir(join(root, "legacy-unowned"));
      const directory = await retained(makeScratch());
      await deadOwner(directory);
      await rm(join(directory, marker));
      await symlink(join(external, "keep.mp4"), join(directory, marker));
      await age(directory);
      await makeScratch().sweep(ready);
      expect(await readFile(join(external, "keep.mp4"), "utf8")).toBe("outside");
      expect(await readdir(root)).toHaveLength(3);
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
  it("does not admit media work when writing its ownership marker fails", async () => {
    const scratch = makeScratch();
    vi.spyOn(
      scratch as unknown as { persistOwner(): Promise<void> },
      "persistOwner",
    ).mockRejectedValue(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    await expect(scratch.create(randomUUID(), randomUUID())).rejects.toMatchObject({
      code: "ENOSPC",
    });
    expect(await readdir(root)).toEqual([]);
  });
  it("retains malformed and other-host ownership records", async () => {
    const malformed = await retained(makeScratch()),
      foreign = await retained(makeScratch());
    await writeFile(join(malformed, marker), "not json");
    const owner = JSON.parse(await readFile(join(foreign, marker), "utf8"));
    owner.host = "another-host";
    await writeFile(join(foreign, marker), JSON.stringify(owner));
    await makeScratch().sweep(ready);
    expect(await readdir(root)).toHaveLength(2);
  });
  it("never overwrites a pre-existing claim directory and never removes arbitrary paths", async () => {
    const scratch = makeScratch(),
      job = randomUUID(),
      lease = randomUUID();
    const directory = await scratch.create(job, lease);
    await writeFile(join(directory, "keep"), "owned");
    await expect(scratch.create(job, lease)).rejects.toMatchObject({ code: "EEXIST" });
    await scratch.release(root);
    expect(await readFile(join(directory, "keep"), "utf8")).toBe("owned");
    await scratch.release(directory);
  });
  it("retains work when process inspection cannot establish safety", async () => {
    const directory = await retained(makeScratch());
    await deadOwner(directory);
    const replacement = makeScratch();
    vi.mocked(
      (replacement as unknown as { processUsesDirectory(path: string): Promise<boolean> })
        .processUsesDirectory,
    ).mockResolvedValue(true);
    await replacement.sweep(ready);
    expect(await readdir(root)).toHaveLength(1);
  });
  it("protects an orphan child holding an open media file until that child exits", async () => {
    const directory = await retained(makeScratch());
    await deadOwner(directory);
    // File path is obtained on stdin, so no argv path matching can mask a broken FD guard.
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.once('data', p => {require('fs').openSync(p.toString().trim(),'r'); process.stdout.write(require('fs').readFileSync('/proc/self/stat','utf8').split(' ')[0]);setInterval(()=>{},1000)})",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    children.push(child);
    child.stdin!.end(join(directory, "canonical.mp4"));
    const [pid] = await once(child.stdout!, "data");
    const procFixture = await mkdtemp(join(tmpdir(), "ayin-proc-test-"));
    // Expose the actual child, not fake descriptors; sandbox-wide /proc may be inaccessible.
    await symlink(`/proc/${String(pid)}`, join(procFixture, String(pid)));
    expect(await localProcessUsesDirectory(directory, procFixture)).toBe(true);
    const replacement = makeScratch();
    vi.mocked(
      (replacement as unknown as { processUsesDirectory(path: string): Promise<boolean> })
        .processUsesDirectory,
    ).mockImplementation((path) => localProcessUsesDirectory(path, procFixture));
    await replacement.sweep(ready);
    expect(await readdir(root)).toHaveLength(1);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await replacement.sweep(ready);
    expect(await readdir(root)).toEqual([]);
    await rm(procFixture, { recursive: true, force: true });
  });
  it("continues a bounded scan past retained directories without starvation", async () => {
    for (let i = 0; i < 300; i++) await mkdir(join(root, `unowned-${i}`));
    const directory = await retained(makeScratch());
    await deadOwner(directory);
    const replacement = makeScratch();
    // More entries than one scan budget; repeat bounded ticks rather than widening the budget.
    await replacement.sweep(ready);
    await replacement.sweep(ready);
    expect(await readdir(root)).toHaveLength(300);
  });
  it("parses process start identity safely when command names contain spaces and parentheses", () => {
    expect(
      linuxProcessStart(`123 (media (worker)) S ${Array(18).fill("0").join(" ")} 9988 0`),
    ).toBe("9988");
    expect(() => linuxProcessStart("invalid")).toThrow();
  });
});
