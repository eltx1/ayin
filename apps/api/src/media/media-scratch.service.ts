import { constants, type Dir } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

const MARKER = ".ayin-scratch-owner.json";
const DIRECTORY = /^([a-f0-9-]{36})-([a-f0-9]{16})$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_DIRECTORIES = 256;
const MIN_RETRY_AGE_MS = 60_000;
const ACTIVE_STATUSES = new Set(["PROCESSING", "UPLOADING", "VERIFYING"]);
export const MEDIA_SCRATCH_SWEEP_MS = 5 * 60_000;

type Owner = {
  version: 1;
  jobId: string;
  claimHash: string;
  host: string;
  boot: string;
  pid: number;
  start: string;
  instance: string;
  localWorkSettled: boolean;
};
export type ScratchJobState = {
  status: string;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
};
export type ScratchJobLookup = (jobId: string) => Promise<ScratchJobState | null>;

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code : "UNVERIFIABLE";
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

// /proc/PID/stat field 22; the process name may itself contain spaces or ')'.
export function linuxProcessStart(stat: string): string {
  const value = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19];
  if (!value || !/^\d+$/.test(value)) throw new Error("Unverifiable process identity");
  return value;
}

async function linuxIdentity() {
  if (process.platform !== "linux") return null;
  const stat = await readFile("/proc/self/stat", "utf8");
  const pid = Number(stat.slice(0, stat.indexOf(" ")));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Unverifiable process identity");
  return {
    pid,
    boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
    start: linuxProcessStart(stat),
  };
}

/** Local temporary media only. Never deletes R2 objects, manifests, or database rows. */
@Injectable()
export class MediaScratchService {
  private readonly logger = new Logger(MediaScratchService.name);
  private readonly root = resolve(
    process.env.MEDIA_PROCESSING_WORKDIR?.trim() || "/tmp/ayin-media-processing",
  );
  private readonly instance = randomUUID();
  private readonly active = new Set<string>();
  private readonly owners = new Map<string, Owner>();
  private sweeping = false;
  private entries: Dir | null = null;
  private rootIdentity: string | null = null;

  constructor() {
    const configured = process.env.MEDIA_PROCESSING_WORKDIR?.trim();
    if (configured && !isAbsolute(configured))
      throw new Error("MEDIA_PROCESSING_WORKDIR must be an absolute path.");
  }

  async create(jobId: string, leaseOwner: string): Promise<string> {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(jobId)) throw new Error("Invalid scratch job identity");
    const claimHash = createHash("sha256").update(leaseOwner).digest("hex").slice(0, 16);
    const directory = join(this.root, `${jobId}-${claimHash}`);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.assertRoot();
    // Never erase a pre-existing directory just because its name matches.
    await mkdir(directory, { mode: 0o700 });
    this.active.add(directory);
    try {
      const identity = await linuxIdentity();
      if (identity) {
        const marker: Owner = {
          version: 1,
          jobId,
          claimHash,
          host: hostname(),
          ...identity,
          instance: this.instance,
          localWorkSettled: false,
        };
        await this.persistOwner(directory, marker);
        this.owners.set(directory, marker);
      }
      return directory;
    } catch (error) {
      await this.release(directory);
      throw error;
    }
  }

  /** Called only after all local media processes finish, before READY is committed. */
  async seal(directory: string): Promise<void> {
    if (!this.active.has(directory)) throw new Error("Scratch attempt is not active");
    const owner = this.owners.get(directory);
    if (!owner) {
      if (process.platform === "linux") throw new Error("Missing scratch owner");
      return;
    }
    const sealed = { ...owner, localWorkSettled: true };
    const temporary = join(directory, `.ayin-settled-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(sealed));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(directory, MARKER));
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
      this.owners.set(directory, sealed);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async release(directory: string): Promise<void> {
    if (!this.active.has(directory)) return;
    try {
      await this.remove(directory);
    } catch (error) {
      this.logger.warn(
        `media_scratch.cleanup_failed: ${errorCode(error)}; retained for verified retry.`,
      );
    } finally {
      this.active.delete(directory);
      this.owners.delete(directory);
    }
  }

  async sweep(lookup: ScratchJobLookup): Promise<void> {
    if (this.sweeping || process.platform !== "linux") return;
    this.sweeping = true;
    let removed = 0;
    let inspected = 0;
    let retained = 0;
    try {
      await this.assertRoot();
      const local = await linuxIdentity();
      if (!local) return;
      const root = await lstat(this.root);
      const identity = `${root.dev}:${root.ino}`;
      if (this.rootIdentity !== identity) await this.closeScan();
      this.rootIdentity = identity;
      this.entries ??= await opendir(this.root);
      // Retain this bounded iterator between ticks, so unknown entries cannot starve later jobs.
      while (inspected < MAX_DIRECTORIES) {
        const entry = await this.entries.read();
        if (!entry) {
          await this.closeScan();
          break;
        }
        inspected++;
        const match = DIRECTORY.exec(entry.name);
        if (!entry.isDirectory() || !match || !UUID.test(match[1]!)) {
          retained++;
          continue;
        }
        const directory = join(this.root, entry.name);
        if (this.active.has(directory)) continue;
        try {
          const initial = await lstat(directory);
          if (!initial.isDirectory() || Date.now() - initial.mtimeMs < MIN_RETRY_AGE_MS) continue;
          const owner = await this.readOwner(directory, match[1]!, match[2]!);
          if (!owner || owner.host !== hostname()) {
            retained++;
            continue;
          }
          // A live process always wins, including after READY and after a lease expires.
          if (!owner.localWorkSettled && owner.boot === local.boot) {
            if (owner.pid === local.pid && owner.start === local.start) {
              if (owner.instance !== this.instance || this.active.has(directory)) continue;
            } else {
              try {
                if (
                  linuxProcessStart(await readFile(`/proc/${owner.pid}/stat`, "utf8")) ===
                  owner.start
                )
                  continue;
              } catch (error) {
                if (!missing(error)) throw error;
              }
            }
          }
          const job = await lookup(owner.jobId);
          if (
            !job ||
            ACTIVE_STATUSES.has(job.status) ||
            job.leaseOwner ||
            (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > Date.now())
          ) {
            retained++;
            continue;
          }
          // SIGKILL can leave ffmpeg children alive: argv/cwd/open descriptors are checked too.
          if (!owner.localWorkSettled && (await this.processUsesDirectory(directory))) {
            this.logger.warn(
              "media_scratch.process_evidence_unavailable_or_in_use: retained for safe retry.",
            );
            retained++;
            continue;
          }
          const current = await lstat(directory);
          if (
            !current.isDirectory() ||
            current.ino !== initial.ino ||
            current.dev !== initial.dev ||
            this.active.has(directory)
          )
            continue;
          await this.assertRoot();
          await this.remove(directory);
          removed++;
        } catch (error) {
          if (!missing(error)) {
            retained++;
            this.logger.warn(`media_scratch.retry_deferred: ${errorCode(error)}.`);
          }
        }
      }
      if (removed || retained)
        this.logger.log(
          `media_scratch.sweep: inspected=${Math.min(inspected, MAX_DIRECTORIES)} removed=${removed} retained=${retained}`,
        );
    } catch (error) {
      await this.closeScan();
      if (!missing(error))
        this.logger.warn(
          `media_scratch.sweep_failed: ${errorCode(error)}; no unsafe cleanup attempted.`,
        );
    } finally {
      this.sweeping = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeScan();
  }

  private async closeScan() {
    const entries = this.entries;
    this.entries = null;
    if (entries) await entries.close().catch(() => undefined);
  }

  private async assertRoot() {
    if (!(await lstat(this.root)).isDirectory() || (await realpath(this.root)) !== this.root)
      throw new Error("Unsafe media scratch root");
  }

  protected async persistOwner(directory: string, owner: Owner): Promise<void> {
    const file = await open(join(directory, MARKER), "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(owner));
      await file.sync();
    } finally {
      await file.close();
    }
    // Publish no media payload until its ownership record is durably recorded.
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  }

  private async readOwner(
    directory: string,
    jobId: string,
    claimHash: string,
  ): Promise<Owner | null> {
    const file = await open(
      join(directory, MARKER),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 4096) return null;
      const owner = JSON.parse(await file.readFile("utf8")) as Owner;
      return owner.version === 1 &&
        typeof owner.localWorkSettled === "boolean" &&
        owner.jobId === jobId &&
        owner.claimHash === claimHash &&
        typeof owner.host === "string" &&
        UUID.test(owner.boot) &&
        UUID.test(owner.instance) &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        /^\d+$/.test(owner.start)
        ? owner
        : null;
    } finally {
      await file.close();
    }
  }

  protected processUsesDirectory(directory: string): Promise<boolean> {
    return localProcessUsesDirectory(directory);
  }

  protected async remove(directory: string) {
    let info;
    try {
      info = await lstat(directory);
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    if (!info.isDirectory()) throw new Error("Unsafe scratch directory");
    // Keep retry authority until EVERY payload entry is gone. Recursive rm on the
    // parent could unlink the marker first and then fail on a multi-GB media file.
    for await (const entry of await opendir(directory)) {
      if (entry.name !== MARKER) await this.removeEntry(join(directory, entry.name));
    }
    await rm(join(directory, MARKER), { force: true });
    try {
      await rmdir(directory);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }

  protected async removeEntry(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  }
}

/** Bounded, fail-closed orphan child detection for the same OS account as the media worker. */
export async function localProcessUsesDirectory(
  directory: string,
  procRoot = "/proc",
): Promise<boolean> {
  if (process.platform !== "linux" || !process.getuid) return true;
  const inside = (value: string) => value === directory || value.startsWith(directory + sep);
  const proc = await opendir(procRoot);
  let processes = 0;
  for await (const entry of proc) {
    if (!/^\d+$/.test(entry.name)) continue;
    if (++processes > 4096) return true;
    const base = join(procRoot, entry.name);
    try {
      if ((await lstat(base)).uid !== process.getuid()) continue;
      const arguments_ = (await readFile(join(base, "cmdline"), "utf8")).split("\0");
      if (arguments_.some(inside)) return true;
      try {
        if (inside(await readlink(join(base, "cwd")))) return true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      const descriptors = await opendir(join(base, "fd"));
      let count = 0;
      for await (const descriptor of descriptors) {
        if (++count > 4096) return true;
        try {
          if (inside(await readlink(join(base, "fd", descriptor.name)))) return true;
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    } catch (error) {
      if (!missing(error)) return true;
    }
  }
  return false;
}
