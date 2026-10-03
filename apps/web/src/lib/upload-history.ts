import { apiBaseUrl } from "./api";
import { uploadId, uploadRecord } from "./quick-upload-contract";
import { UploadProtocolError } from "./upload-session";

export const uploadHistoryStatuses = [
  "UPLOADING",
  "VALIDATING",
  "DRAFT",
  "PUBLISHED",
  "SCHEDULED",
] as const;
export type UploadHistoryStatus = (typeof uploadHistoryStatuses)[number];
export class UploadHistoryError extends Error {
  constructor(readonly status: number) {
    super("Upload history could not be verified");
  }
}
function text(v: unknown, max: number) {
  if (typeof v !== "string" || v.length > max || !v.trim()) throw new UploadProtocolError();
  return v;
}
function count(v: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max)
    throw new UploadProtocolError();
  return v;
}
function known<const T extends readonly string[]>(v: unknown, values: T): T[number] {
  if (typeof v !== "string" || !values.includes(v)) throw new UploadProtocolError();
  return v as T[number];
}
function date(v: unknown) {
  const value = text(v, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new UploadProtocolError();
  return value;
}
export function parseUploadHistory(
  value: unknown,
  actor: { accountId: string; channelId: string },
  page: number,
  status: UploadHistoryStatus | "",
) {
  const r = uploadRecord(value),
    p = uploadRecord(r.pagination);
  if (
    r.actorAccountId !== actor.accountId ||
    r.channelId !== actor.channelId ||
    p.page !== page ||
    p.take !== 25 ||
    count(p.pages) !== Math.max(1, Math.ceil(count(p.total) / 25)) ||
    !Array.isArray(r.items) ||
    r.items.length > 25
  )
    throw new UploadProtocolError();
  const items = r.items.map((v: unknown) => {
    const row = uploadRecord(v);
    const state = known(row.status, uploadHistoryStatuses);
    if (row.channelId !== actor.channelId || (status && state !== status))
      throw new UploadProtocolError();
    const job = row.processing === null ? null : uploadRecord(row.processing);
    const progress = job?.progressPercent;
    if (
      job &&
      (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 100)
    )
      throw new UploadProtocolError();
    const generation = job ? count(job.generation) : null;
    if (generation === 0) throw new UploadProtocolError();
    return {
      id: uploadId(row.id),
      title: text(row.title, 200),
      status: state,
      visibility: known(row.visibility, ["PUBLIC", "UNLISTED", "PRIVATE"]),
      videoForm: known(row.videoForm, ["LONG_FORM", "CLIP"]),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
      processing: job
        ? {
            generation: generation!,
            status: known(job.status, [
              "INGESTING",
              "QUEUED",
              "PROCESSING",
              "UPLOADING",
              "VERIFYING",
              "READY",
              "FAILED",
              "CANCELLED",
            ]),
            progressPercent: progress as number,
            errorCode: job.errorCode === null ? null : text(job.errorCode, 128),
          }
        : null,
    };
  });
  if (
    new Set(items.map((v) => v.id)).size !== items.length ||
    items.length !== Math.max(0, Math.min(25, count(p.total) - (page - 1) * 25))
  )
    throw new UploadProtocolError();
  return { ...actor, pagination: { page, total: count(p.total), pages: count(p.pages) }, items };
}
async function request(path: string, signal: AbortSignal) {
  const r = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!r.ok) throw new UploadHistoryError(r.status);
  return (await r.json()) as unknown;
}
async function identity(signal: AbortSignal) {
  const r = uploadRecord(await request("/auth/me", signal));
  return {
    accountId: uploadId(uploadRecord(r.account).id),
    channelId: uploadId(uploadRecord(r.channel).id),
  };
}
export async function readUploadHistory(
  page: number,
  status: UploadHistoryStatus | "",
  parent: AbortSignal,
) {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000 ||
    (status && !uploadHistoryStatuses.includes(status))
  )
    throw new UploadProtocolError();
  const controller = new AbortController(),
    abort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) abort();
  const deadline = setTimeout(() => controller.abort(), 15000);
  try {
    const first = await identity(controller.signal);
    const query = new URLSearchParams({ channelId: first.channelId, page: String(page) });
    if (status) query.set("status", status);
    const parsed = parseUploadHistory(
      await request(`/creator/videos/uploads?${query}`, controller.signal),
      first,
      page,
      status,
    );
    const last = await identity(controller.signal);
    if (first.accountId !== last.accountId || first.channelId !== last.channelId)
      throw new UploadHistoryError(403);
    return parsed;
  } finally {
    clearTimeout(deadline);
    parent.removeEventListener("abort", abort);
    controller.abort();
  }
}
export type UploadHistorySnapshot = Awaited<ReturnType<typeof readUploadHistory>>;
