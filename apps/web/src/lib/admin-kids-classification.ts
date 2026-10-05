import type { AdminSession } from "./admin-control";
import { canAdministerVideos } from "./admin-video-workspace";
import {
  AdminWorkspaceError,
  adminObject,
  adminId,
  adminKnown,
  adminText,
  adminWorkspaceRequest as request,
  boundedAdminRequest as bounded,
  readAdminOperationsSession as session,
} from "./verified-admin-transport";

export { AdminWorkspaceError as AdminKidsError } from "./verified-admin-transport";
export class AdminKidsWriteError extends AdminWorkspaceError {
  constructor(
    status: number,
    verificationRequired: boolean,
    readonly acknowledged: boolean,
  ) {
    super(status, true, verificationRequired);
  }
}
const actorHeaders = (actor: AdminSession) => ({
  "x-ayin-expected-account": adminId(actor.accountId),
});
export const maturityLevels = ["GENERAL", "TEEN", "MATURE"] as const;
export const ageRestrictions = ["NONE", "AGE_13_PLUS", "AGE_18_PLUS"] as const;
export type ClassificationDraft = {
  maturityLevel: (typeof maturityLevels)[number];
  ageRestriction: (typeof ageRestrictions)[number];
  kidsEligible: boolean;
  reason: string;
};
function match(expected: AdminSession, current: AdminSession) {
  if (
    expected.accountId !== current.accountId ||
    [...expected.roles].sort().join(",") !== [...current.roles].sort().join(",") ||
    !canAdministerVideos(current.roles)
  )
    throw new AdminWorkspaceError(403);
}
export function contradictoryClassification(value: Omit<ClassificationDraft, "reason">) {
  return (
    value.kidsEligible && (value.maturityLevel !== "GENERAL" || value.ageRestriction !== "NONE")
  );
}
export function parseKidsPolicy(value: unknown, targetId: string) {
  const response = adminObject(value),
    policy = adminObject(response.policy);
  const result = {
    videoId: adminId(response.videoId),
    maturityLevel:
      policy.maturityLevel === null ? null : adminKnown(policy.maturityLevel, maturityLevels),
    ageRestriction: adminKnown(policy.ageRestriction, ageRestrictions),
    kidsEligible: policy.kidsEligible,
  };
  if (
    result.videoId !== adminId(targetId) ||
    typeof result.kidsEligible !== "boolean" ||
    (result.kidsEligible &&
      (result.maturityLevel !== "GENERAL" || result.ageRestriction !== "NONE"))
  )
    throw new AdminWorkspaceError();
  return { ...result, kidsEligible: result.kidsEligible };
}
export type KidsPolicy = ReturnType<typeof parseKidsPolicy>;
export function classificationCommand(draft: ClassificationDraft) {
  const result = {
    maturityLevel: adminKnown(draft.maturityLevel, maturityLevels),
    ageRestriction: adminKnown(draft.ageRestriction, ageRestrictions),
    kidsEligible: draft.kidsEligible,
    reason: adminText(draft.reason.trim(), 1000, 5),
  };
  if (typeof result.kidsEligible !== "boolean" || contradictoryClassification(result))
    throw new AdminWorkspaceError();
  return result;
}
export async function readKidsPolicy(actor: AdminSession, targetId: string, signal: AbortSignal) {
  const target = adminId(targetId);
  return bounded(signal, 15000, async (signal) => {
    match(
      actor,
      session(await request("/admin/session", signal, { headers: actorHeaders(actor) })),
    );
    const policy = parseKidsPolicy(
      await request("/admin/video-policies/" + target, signal, { headers: actorHeaders(actor) }),
      target,
    );
    match(
      actor,
      session(await request("/admin/session", signal, { headers: actorHeaders(actor) })),
    );
    return policy;
  });
}
export async function saveKidsClassification(
  actor: AdminSession,
  targetId: string,
  draft: ClassificationDraft,
  signal: AbortSignal,
) {
  const target = adminId(targetId),
    command = classificationCommand(draft);
  return bounded(signal, 30000, async (signal) => {
    match(
      actor,
      session(await request("/admin/session", signal, { headers: actorHeaders(actor) })),
    );
    let acknowledged = false;
    try {
      const policy = parseKidsPolicy(
        await request("/admin/video-policies/" + target + "/classification", signal, {
          method: "PUT",
          headers: { ...actorHeaders(actor), "content-type": "application/json" },
          body: JSON.stringify(command),
        }),
        target,
      );
      if (
        policy.maturityLevel !== command.maturityLevel ||
        policy.ageRestriction !== command.ageRestriction ||
        policy.kidsEligible !== command.kidsEligible
      )
        throw new AdminWorkspaceError();
      acknowledged = true;
      match(
        actor,
        session(await request("/admin/session", signal, { headers: actorHeaders(actor) })),
      );
      return policy;
    } catch (error) {
      if (error instanceof AdminWorkspaceError)
        throw new AdminKidsWriteError(error.status, error.verificationRequired, acknowledged);
      throw new AdminKidsWriteError(0, false, acknowledged);
    }
  });
}
