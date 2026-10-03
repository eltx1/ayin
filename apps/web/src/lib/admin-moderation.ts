import type { AdminRole } from "./admin-control";

export const reportStatuses = ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"] as const;
export const reportReasons = [
  "COPYRIGHT",
  "SPAM",
  "HARASSMENT",
  "HATE",
  "SEXUAL_CONTENT",
  "VIOLENCE",
  "MISLEADING",
  "OTHER",
] as const;
export type ReportStatus = (typeof reportStatuses)[number];
export type ReportReason = (typeof reportReasons)[number];
export function canReadModeration(roles: readonly AdminRole[]) {
  return roles.some((role) =>
    ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"].includes(role),
  );
}
const invalid = () => new Error("Invalid moderation response");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2000) {
  if (typeof value !== "string" || value.length > max) throw invalid();
  return value;
}
function id(value: unknown) {
  const result = text(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result))
    throw invalid();
  return result;
}
function count(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw invalid();
  return value;
}
function known<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw invalid();
  return value as T;
}
function nullableText(value: unknown) {
  return value === null ? null : text(value, 100000);
}
function target(value: unknown) {
  return value === null ? null : object(value);
}
export function parseModerationPage(value: unknown, page: number, status: string) {
  const root = object(value),
    p = object(root.pagination);
  const total = count(p.total),
    pages = count(p.pages),
    current = count(p.page),
    take = count(p.take);
  if (page < 1 || current !== page || take !== 25 || pages !== Math.max(1, Math.ceil(total / take)))
    throw invalid();
  if (!Array.isArray(root.reports) || root.reports.length > take || root.reports.length > total)
    throw invalid();
  const ids = new Set<string>();
  const reports = root.reports.map((value) => {
    const row = object(value),
      reporter = object(row.reporterProfile);
    const rowId = id(row.id),
      rowStatus = known(row.status, reportStatuses);
    if (
      ids.has(rowId) ||
      (status ? rowStatus !== status : !["OPEN", "REVIEWING"].includes(rowStatus))
    )
      throw invalid();
    ids.add(rowId);
    const createdAt = text(row.createdAt, 64);
    if (!Number.isFinite(Date.parse(createdAt))) throw invalid();
    const channel = target(row.channel),
      video = target(row.video),
      comment = target(row.comment),
      moderationCase = target(row.moderationCase);
    return {
      id: rowId,
      reason: known(row.reason, reportReasons),
      status: rowStatus,
      details: nullableText(row.details),
      createdAt,
      reporterProfile: {
        id: id(reporter.id),
        name: text(reporter.name),
        slug: text(reporter.slug),
      },
      channel: channel
        ? { id: id(channel.id), handle: text(channel.handle), name: text(channel.name) }
        : null,
      video: video ? { id: id(video.id), title: text(video.title) } : null,
      comment: comment ? { id: id(comment.id), body: text(comment.body, 100000) } : null,
      moderationCase: moderationCase
        ? {
            id: id(moderationCase.id),
            status: known(moderationCase.status, [
              "OPEN",
              "REVIEWING",
              "ACTIONED",
              "DISMISSED",
              "CLOSED",
            ]),
            summary: nullableText(moderationCase.summary),
          }
        : null,
    };
  });
  return { reports, pagination: { total, page: current, take, pages } };
}
