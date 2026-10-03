const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unverified trust acknowledgment");
  return value as Record<string, unknown>;
}
function match(row: Record<string, unknown>, input: Record<string, unknown>, fields: string[]) {
  for (const field of fields)
    if (field in input && row[field] !== input[field])
      throw new Error("Unverified trust acknowledgment");
}
// HTTP success alone does not establish which protected operation committed.
export function verifyAdminTrustAcknowledgment(
  path: string,
  value: unknown,
  body: unknown,
  actor: string,
): void {
  const row = record(value),
    input = record(body);
  if (path === "/admin/trust/settings") {
    if (
      !Array.isArray(row.blockedTerms) ||
      !Array.isArray(input.blockedTerms) ||
      row.blockedTerms.length !== input.blockedTerms.length ||
      row.blockedTerms.some((term, index) => term !== (input.blockedTerms as unknown[])[index])
    )
      throw new Error("Unverified trust acknowledgment");
    match(row, input, ["newCreatorsRequireReview"]);
    return;
  }
  if (path === "/admin/trust/actions") {
    if (typeof row.id !== "string" || !uuid.test(row.id) || row.actorAccountId !== actor)
      throw new Error("Unverified trust acknowledgment");
    match(row, input, ["kind", "reason", "targetAccountId", "channelId", "videoId", "caseId"]);
    return;
  }
  const resource = /^\/admin\/trust\/(cases|appeals|takedowns|channels)\/([a-f0-9-]+)$/i.exec(path);
  if (!resource || !uuid.test(resource[2]!)) throw new Error("Unverified trust acknowledgment");
  if (resource[1] === "channels") {
    if (row.channelId !== resource[2]) throw new Error("Unverified trust acknowledgment");
    match(row, input, ["level", "reviewRequired"]);
  } else {
    if (row.id !== resource[2]) throw new Error("Unverified trust acknowledgment");
    match(row, input, ["status", "resolution"]);
  }
}

export type ActorTrustAction = {
  id: string;
  actorAccountId: string;
  kind: string;
  reason: string;
  createdAt: string;
  targetAccountId: string | null;
  channelId: string | null;
  videoId: string | null;
  caseId: string | null;
};
export function parseActorTrustActions(value: unknown, actor: string): ActorTrustAction[] {
  const root = record(value);
  if (!Array.isArray(root.actions) || root.actions.length > 100)
    throw new Error("Invalid action history");
  const seen = new Set<string>();
  return root.actions.map((value) => {
    const row = record(value);
    if (
      typeof row.id !== "string" ||
      !uuid.test(row.id) ||
      seen.has(row.id) ||
      row.actorAccountId !== actor ||
      typeof row.kind !== "string" ||
      ![
        "WARN",
        "STRIKE",
        "SUSPEND_ACCOUNT",
        "SUSPEND_CHANNEL",
        "UNPUBLISH_VIDEO",
        "REMOVE_VIDEO",
      ].includes(row.kind) ||
      typeof row.reason !== "string" ||
      !row.reason.trim() ||
      row.reason.length > 4000 ||
      typeof row.createdAt !== "string" ||
      !Number.isFinite(Date.parse(row.createdAt))
    )
      throw new Error("Invalid action history");
    seen.add(row.id);
    for (const key of ["targetAccountId", "channelId", "videoId", "caseId"])
      if (row[key] !== null && (typeof row[key] !== "string" || !uuid.test(row[key] as string)))
        throw new Error("Invalid action history");
    return {
      id: row.id,
      actorAccountId: actor,
      kind: row.kind,
      reason: row.reason,
      createdAt: row.createdAt,
      targetAccountId: row.targetAccountId as string | null,
      channelId: row.channelId as string | null,
      videoId: row.videoId as string | null,
      caseId: row.caseId as string | null,
    };
  });
}
