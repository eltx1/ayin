import {
  parseDirectAdminSession,
  sameAdminSessionScope,
  type DirectAdminSession,
} from "./admin-session-scope";
import {
  AdminWorkspaceError,
  adminWorkspaceRequest,
  boundedAdminRequest,
  adminObject as object,
  adminId as id,
  adminText as text,
  adminKnown as known,
  adminRows as rows,
  adminDate as date,
} from "./verified-admin-transport";

export type SeedChannel = { id: string; handle: string; name: string; isPlatformOwned: boolean };
export type SeedItem = {
  id: string;
  status: "DRAFT" | "UPLOADING" | "READY" | "PUBLISHED" | "FAILED" | "ROLLED_BACK";
  rightsBasis: string;
  sourceNotes: string;
  video: {
    id: string;
    slug: string;
    title: string;
    contentType: string;
    status: string;
    mediaProcessingJobs: { status: string }[];
  };
};
export type SeedBatch = {
  id: string;
  sourceLabel: string;
  status: string;
  createdAt: string;
  channel: SeedChannel;
  items: SeedItem[];
};
export type ImportPhase =
  "draft" | "uploading" | "processing" | "ready" | "published" | "failed" | "rolledBack";
export function seedPhase(item: SeedItem): ImportPhase {
  if (item.status === "ROLLED_BACK") return "rolledBack";
  if (item.status === "PUBLISHED" || item.video.status === "PUBLISHED") return "published";
  const job = item.video.mediaProcessingJobs[0];
  if (item.status === "FAILED" || job?.status === "FAILED" || job?.status === "CANCELLED")
    return "failed";
  if (job && job.status !== "READY") return "processing";
  if (item.status === "READY") return "ready";
  if (item.status === "UPLOADING") return "uploading";
  return "draft";
}
export function canRollbackSeed(batch: SeedBatch) {
  return (
    batch.status !== "ROLLED_BACK" &&
    batch.items.every((item) => item.status !== "PUBLISHED" && item.video.status !== "PUBLISHED")
  );
}
export function parseSeedChannel(value: unknown): SeedChannel {
  const r = object(value);
  if (r.isPlatformOwned !== true) throw new AdminWorkspaceError();
  return {
    id: id(r.id),
    handle: text(r.handle, 100, 1),
    name: text(r.name, 200, 1),
    isPlatformOwned: true,
  };
}
export function parseSeedItem(value: unknown): SeedItem {
  const r = object(value),
    v = object(r.video);
  return {
    id: id(r.id),
    status: known(r.status, ["DRAFT", "UPLOADING", "READY", "PUBLISHED", "FAILED", "ROLLED_BACK"]),
    rightsBasis: known(r.rightsBasis, [
      "OWNED",
      "LICENSED",
      "AUTHORIZED",
      "PUBLIC_DOMAIN",
      "OTHER",
    ]),
    sourceNotes: text(r.sourceNotes, 10000, 3),
    video: {
      id: id(v.id),
      slug: text(v.slug, 200, 1),
      title: text(v.title, 200, 1),
      contentType: known(v.contentType, ["CREATOR_VIDEO", "MOVIE", "DOCUMENTARY"]),
      status: known(v.status, [
        "DRAFT",
        "UPLOADING",
        "VALIDATING",
        "PUBLISHED",
        "SCHEDULED",
        "REMOVED",
      ]),
      mediaProcessingJobs: rows(v.mediaProcessingJobs ?? [], 1, (job) => ({
        status: known(object(job).status, [
          "INGESTING",
          "QUEUED",
          "PROCESSING",
          "UPLOADING",
          "VERIFYING",
          "READY",
          "FAILED",
          "CANCELLED",
        ]),
      })),
    },
  };
}
export function parseSeedBatch(value: unknown): SeedBatch {
  const r = object(value),
    c = object(r.channel);
  // A previously valid destination can later lose its platform-owned flag.
  if (typeof c.isPlatformOwned !== "boolean") throw new AdminWorkspaceError();
  return {
    id: id(r.id),
    sourceLabel: text(r.sourceLabel, 200, 2),
    status: known(r.status, ["DRAFT", "READY", "ROLLED_BACK"]),
    createdAt: date(r.createdAt),
    channel: {
      id: id(c.id),
      handle: text(c.handle, 100, 1),
      name: text(c.name, 200, 1),
      isPlatformOwned: c.isPlatformOwned,
    },
    items: rows(r.items, 100, parseSeedItem),
  };
}
export function parseSeedCreation(value: unknown) {
  const r = object(value),
    items = rows(r.items, 1, parseSeedItem);
  if (items.length !== 1) throw new AdminWorkspaceError();
  return { batchId: id(object(r.batch).id), item: items[0]! };
}
export const seedPost = (body: unknown = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export class SeedRequestError extends AdminWorkspaceError {
  constructor(
    readonly acknowledged: unknown,
    cause: unknown,
    writeStarted: boolean,
    readonly authorityLost = false,
  ) {
    super(
      cause instanceof AdminWorkspaceError ? cause.status : 0,
      writeStarted,
      cause instanceof AdminWorkspaceError && cause.verificationRequired,
      cause instanceof AdminWorkspaceError ? cause.code : "",
    );
  }
}
export async function seedRequest<T>(
  path: string,
  parse: (value: unknown) => T,
  actor: DirectAdminSession,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<T> {
  let acknowledged: T | null = null,
    writeStarted = false,
    authorityLost = false;
  const verify = async (signal: AbortSignal) => {
    try {
      const session = parseDirectAdminSession(
        await adminWorkspaceRequest("/admin/session", signal),
      );
      if (
        !sameAdminSessionScope(actor, session) ||
        !session.roles.some((role) =>
          ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"].includes(role),
        )
      )
        throw new AdminWorkspaceError(403);
    } catch (cause) {
      authorityLost = true;
      throw cause;
    }
  };
  try {
    return await boundedAdminRequest(signal, 15000, async (boundedSignal) => {
      await verify(boundedSignal);
      boundedSignal.throwIfAborted();
      writeStarted = Boolean(init.method);
      const raw = await adminWorkspaceRequest(path, boundedSignal, init);
      const result = parse(raw);
      if (writeStarted) acknowledged = result;
      await verify(boundedSignal);
      return result;
    });
  } catch (cause) {
    throw new SeedRequestError(acknowledged, cause, writeStarted, authorityLost);
  }
}
