import type { AdminPagination } from "./admin-control";
import {
  parseDirectAdminSession,
  sameAdminSessionScope,
  type DirectAdminSession,
} from "./admin-session-scope";
import {
  AdminWorkspaceError,
  adminWorkspaceRequest,
  boundedAdminRequest,
  adminObject,
  adminText,
  adminId,
  adminCount,
  adminRows,
  canAdministerOperations,
} from "./verified-admin-transport";

export const merchandisingTypes = ["VIDEO", "CREATOR_TV", "CHANNEL", "PLAYLIST"] as const;
export type MerchandisingType = (typeof merchandisingTypes)[number];
export type MerchandisingTarget = {
  entityType: MerchandisingType;
  entityId: string;
  label: string;
  detail: string;
};
export type MerchandisingSelection = Pick<MerchandisingTarget, "entityType" | "entityId">;
export const targetKey = (target: MerchandisingSelection) =>
  `${target.entityType}:${target.entityId}`;

export const merchandisingScopeHeaders = (actor: DirectAdminSession) => ({
  "x-ayin-expected-account": adminId(actor.accountId),
  "x-ayin-expected-session": adminId(actor.sessionId),
});
export function merchandisingIdentityFailure(cause: unknown): boolean {
  return (
    cause instanceof AdminWorkspaceError &&
    !cause.verificationRequired &&
    ([401, 403].includes(cause.status) ||
      (cause.status === 409 && ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(cause.code)))
  );
}

export async function verifiedMerchandisingOperation<T>(
  actor: DirectAdminSession,
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return boundedAdminRequest(signal, 20_000, async (pending) => {
    const verify = async () => {
      const raw = await adminWorkspaceRequest("/admin/session", pending, {
        headers: merchandisingScopeHeaders(actor),
      });
      let current: DirectAdminSession;
      try {
        current = parseDirectAdminSession(raw);
      } catch {
        throw new AdminWorkspaceError(403);
      }
      if (!sameAdminSessionScope(actor, current) || !canAdministerOperations(current.roles))
        throw new AdminWorkspaceError(403);
      pending.throwIfAborted();
    };
    await verify();
    const result = await operation(pending);
    await verify();
    return result;
  });
}

export function parseMerchandisingDirectory(
  value: unknown,
  entityType: MerchandisingType,
  page: number,
) {
  const body = adminObject(value),
    p = adminObject(body.pagination);
  const pagination: AdminPagination = {
    total: adminCount(p.total),
    page: adminCount(p.page),
    take: adminCount(p.take),
    pages: adminCount(p.pages),
  };
  if (
    pagination.page !== page ||
    pagination.take !== 25 ||
    pagination.pages !== Math.max(1, Math.ceil(pagination.total / 25))
  )
    throw new AdminWorkspaceError();
  const items = adminRows(body.items, 25, (value): MerchandisingTarget => {
    const row = adminObject(value);
    const channel = entityType === "CHANNEL" ? row : adminObject(row.channel);
    const label = adminText(entityType === "VIDEO" ? row.title : row.name, 500, 1);
    const handle = adminText(channel.handle, 200, 1);
    const slug = entityType === "CHANNEL" ? "" : adminText(row.slug, 500, 1);
    const status = adminText(entityType === "PLAYLIST" ? row.visibility : row.status, 40, 1);
    const visibility = entityType === "VIDEO" ? adminText(row.visibility, 40, 1) : "";
    return {
      entityType,
      entityId: adminId(row.id),
      label,
      detail: [`@${handle}`, slug, status, visibility].filter(Boolean).join(" · "),
    };
  });
  if (new Set(items.map(targetKey)).size !== items.length) throw new AdminWorkspaceError();
  return { items, pagination };
}

export async function searchMerchandisingTargets(
  actor: DirectAdminSession,
  type: MerchandisingType,
  query: string,
  page: number,
  signal: AbortSignal,
) {
  if (
    !merchandisingTypes.includes(type) ||
    query.length > 200 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10_000
  )
    throw new AdminWorkspaceError();
  const paths = {
    VIDEO: "/admin/control/videos",
    CHANNEL: "/admin/control/channels",
    CREATOR_TV: "/admin/control/tv",
    PLAYLIST: "/admin/operations/directory/playlists",
  };
  const params = new URLSearchParams({ query: query.trim(), page: String(page), take: "25" });
  return verifiedMerchandisingOperation(actor, signal, async (pending) =>
    parseMerchandisingDirectory(
      await adminWorkspaceRequest(`${paths[type]}?${params}`, pending, {
        headers: merchandisingScopeHeaders(actor),
      }),
      type,
      page,
    ),
  );
}
