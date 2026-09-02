"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  downloadAdminCsv,
  getAdminAudit,
  getAdminRoles,
  getAdminSession,
  getAdminStaff,
  getAdminSupportTickets,
  getCreatorCompliance,
  revokeAccountSessions,
  updateAdminStaffRoles,
  updateAdminSupportTicket,
  updateCreatorCompliance,
  type AdminAuditItem,
  type AdminRole,
  type AdminSession,
  type AdminStaffMember,
  type AdminSupportTicket,
} from "@/lib/admin-control";

const roleLabels: Record<AdminRole, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Administrator",
  OPERATIONS: "Operations",
  CONTENT_MODERATOR: "Content moderator",
  AD_MANAGER: "Advertising manager",
  FINANCE_MANAGER: "Finance manager",
};

const identityOptions = ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"] as const;
const taxOptions = ["NOT_PROVIDED", "PENDING", "VERIFIED", "REQUIRES_ACTION"] as const;
type ExportResource = "users" | "channels" | "videos" | "payouts" | "audit";

function hasPrivilegedRole(session: AdminSession | null): boolean {
  return Boolean(
    session?.roles.some((role) => role === "SUPERADMIN" || role === "ADMIN"),
  );
}

export function AdminOperations() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [staff, setStaff] = useState<AdminStaffMember[]>([]);
  const [audit, setAudit] = useState<AdminAuditItem[]>([]);
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [staffQuery, setStaffQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [compliance, setCompliance] = useState<Awaited<
    ReturnType<typeof getCreatorCompliance>
  > | null>(null);
  const [complianceReason, setComplianceReason] = useState("");

  const privileged = hasPrivilegedRole(session);
  const canOperate = privileged || Boolean(session?.roles.includes("OPERATIONS"));
  const canManageRoles = Boolean(session?.roles.includes("SUPERADMIN"));
  const canSupport =
    privileged ||
    Boolean(
      session?.roles.some((role) =>
        ["OPERATIONS", "CONTENT_MODERATOR", "FINANCE_MANAGER"].includes(role),
      ),
    );
  const canCompliance = privileged || Boolean(session?.roles.includes("FINANCE_MANAGER"));

  const exportResources = useMemo<ExportResource[]>(() => {
    if (!session) return [];
    if (privileged) return ["users", "channels", "videos", "payouts", "audit"];

    const resources: ExportResource[] = [];
    if (session.roles.includes("OPERATIONS")) {
      resources.push("users", "channels", "videos", "audit");
    }
    if (session.roles.includes("FINANCE_MANAGER")) resources.push("payouts");
    return [...new Set(resources)];
  }, [privileged, session]);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const nextSession = await getAdminSession();
      const nextPrivileged = nextSession.roles.some(
        (role) => role === "SUPERADMIN" || role === "ADMIN",
      );
      const nextCanOperate = nextPrivileged || nextSession.roles.includes("OPERATIONS");
      const nextCanSupport =
        nextPrivileged ||
        nextSession.roles.some((role) =>
          ["OPERATIONS", "CONTENT_MODERATOR", "FINANCE_MANAGER"].includes(role),
        );

      const [roleData, staffData, auditData, ticketData] = await Promise.all([
        nextCanOperate ? getAdminRoles() : Promise.resolve({ roles: [] as AdminRole[] }),
        nextCanOperate
          ? getAdminStaff(staffQuery)
          : Promise.resolve({ items: [] as AdminStaffMember[] }),
        getAdminAudit(
          auditQuery.trim()
            ? new URLSearchParams({ query: auditQuery.trim(), take: "50" })
            : undefined,
        ),
        nextCanSupport
          ? getAdminSupportTickets()
          : Promise.resolve({ items: [] as AdminSupportTicket[] }),
      ]);

      setSession(nextSession);
      setRoles(roleData.roles);
      setStaff(staffData.items);
      setAudit(auditData.items);
      setTickets(ticketData.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin operations could not be loaded.");
    }
  }, [auditQuery, staffQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The admin operation failed.");
    } finally {
      setBusy(false);
    }
  }

  const openTicketCount = useMemo(
    () =>
      tickets.filter((ticket) => ticket.status !== "RESOLVED" && ticket.status !== "CLOSED").length,
    [tickets],
  );

  if (!session && !message) return <p className={styles.muted}>Loading governance controls…</p>;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Operations & governance</span>
          <h1>Admin Operations</h1>
          <p className={styles.muted}>
            Audit, support, staff security, creator compliance and safe exports are exposed only
            when your current staff role is authorized by the protected API.
          </p>
        </div>
        {session ? <span className={styles.statusPill}>{session.roles.join(" · ")}</span> : null}
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      <section aria-label="Operations summary" className={styles.metrics}>
        {canOperate ? (
          <article className={styles.metric}>
            <span className={styles.muted}>Staff accounts</span>
            <strong>{staff.length}</strong>
          </article>
        ) : null}
        {canSupport ? (
          <article className={styles.metric}>
            <span className={styles.muted}>Open support</span>
            <strong>{openTicketCount}</strong>
          </article>
        ) : null}
        <article className={styles.metric}>
          <span className={styles.muted}>Audit events loaded</span>
          <strong>{audit.length}</strong>
        </article>
        {exportResources.length ? (
          <article className={styles.metric}>
            <span className={styles.muted}>Permitted exports</span>
            <strong>{exportResources.length}</strong>
          </article>
        ) : null}
      </section>

      {canOperate || exportResources.length ? (
        <div className={styles.operationsGrid}>
          {canOperate ? (
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h2>Staff security & RBAC</h2>
                  <p className={styles.muted}>
                    Operations can inspect staff and revoke sessions. Only SUPERADMIN can change
                    role assignments.
                  </p>
                </div>
              </div>
              <form
                className={styles.toolbar}
                onSubmit={(event) => {
                  event.preventDefault();
                  void load();
                }}
              >
                <input
                  aria-label="Search staff"
                  placeholder="Search name or email"
                  value={staffQuery}
                  onChange={(event) => setStaffQuery(event.target.value)}
                />
                <button className={styles.button} type="submit">
                  Search
                </button>
              </form>
              <div className={styles.grid}>
                {staff.map((member) => (
                  <StaffCard
                    busy={busy}
                    canManageRoles={canManageRoles}
                    key={member.id}
                    member={member}
                    roles={roles}
                    onSave={(nextRoles, reason) =>
                      act(
                        () => updateAdminStaffRoles(member.id, nextRoles, reason),
                        `Roles updated for ${member.displayName}.`,
                      )
                    }
                    onRevoke={(reason) =>
                      act(
                        () => revokeAccountSessions(member.id, reason),
                        `Sessions revoked for ${member.displayName}.`,
                      )
                    }
                  />
                ))}
                {!staff.length ? <p className={styles.muted}>No staff accounts matched.</p> : null}
              </div>
            </section>
          ) : null}

          {exportResources.length ? (
            <section className={styles.card}>
              <h2>Permitted exports</h2>
              <p className={styles.muted}>
                Only exports authorized for your current role are shown. Sensitive payout
                destination data remains masked.
              </p>
              <div className={styles.actions}>
                {exportResources.map((resource) => (
                  <button
                    className={styles.button}
                    disabled={busy}
                    key={resource}
                    type="button"
                    onClick={() =>
                      void act(() => downloadAdminCsv(resource), `${resource} export generated.`)
                    }
                  >
                    Export {resource}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {canCompliance ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Creator compliance</h2>
              <p className={styles.muted}>
                Review a creator payout profile and update identity/tax workflow status. This does
                not replace a future KYC or tax provider.
              </p>
            </div>
          </div>
          <form
            className={styles.toolbar}
            onSubmit={(event) => {
              event.preventDefault();
              if (!channelId.trim()) return;
              setBusy(true);
              setMessage("");
              void getCreatorCompliance(channelId.trim())
                .then(setCompliance)
                .catch((error) =>
                  setMessage(
                    error instanceof Error ? error.message : "Compliance could not be loaded.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <input
              aria-label="Creator channel UUID"
              placeholder="Channel UUID"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
            />
            <button className={styles.button} disabled={busy} type="submit">
              Load profile
            </button>
          </form>
          {compliance ? (
            <div className={styles.cardInset}>
              <p>
                <strong>{compliance.channel.name}</strong> · @{compliance.channel.handle}
              </p>
              {compliance.profile ? (
                <ComplianceEditor
                  busy={busy}
                  channelId={compliance.channel.id}
                  profile={compliance.profile}
                  reason={complianceReason}
                  setReason={setComplianceReason}
                  onSaved={(next) => {
                    setCompliance((current) =>
                      current?.profile
                        ? {
                            ...current,
                            profile: {
                              ...current.profile,
                              ...(next as Partial<typeof current.profile>),
                            },
                          }
                        : current,
                    );
                    setComplianceReason("");
                  }}
                  onAct={act}
                />
              ) : (
                <p className={styles.muted}>The creator has not created a payout profile yet.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {canSupport ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Internal support queue</h2>
              <p className={styles.muted}>
                Authenticated users can open tickets; authorized staff can triage and resolve them
                here. Staff assignment is offered when the current role can inspect staff records.
              </p>
            </div>
          </div>
          <div className={styles.grid}>
            {tickets.map((ticket) => (
              <SupportTicketCard
                busy={busy}
                canAssign={canOperate}
                key={ticket.id}
                staff={staff}
                ticket={ticket}
                onSave={(input) =>
                  act(
                    () => updateAdminSupportTicket(ticket.id, input),
                    `Support ticket ${ticket.id.slice(0, 8)} updated.`,
                  )
                }
              />
            ))}
            {!tickets.length ? <p className={styles.muted}>No support tickets yet.</p> : null}
          </div>
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Audit log</h2>
            <p className={styles.muted}>
              Security-sensitive and operational changes are searchable and attributable for every
              authorized staff role.
            </p>
          </div>
        </div>
        <form
          className={styles.toolbar}
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="Search audit log"
            placeholder="Action, entity, ID or reason"
            value={auditQuery}
            onChange={(event) => setAuditQuery(event.target.value)}
          />
          <button className={styles.button} type="submit">
            Search audit
          </button>
        </form>
        <div className={styles.auditList}>
          {audit.map((item) => (
            <article className={styles.auditItem} key={item.id}>
              <div>
                <strong>{item.action}</strong>
                <span className={styles.muted}>
                  {item.entityType}
                  {item.entityId ? ` · ${item.entityId}` : ""}
                </span>
              </div>
              <div>
                <span>{item.actor?.displayName ?? "System"}</span>
                <span className={styles.muted}>{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              {item.reason ? <p>{item.reason}</p> : null}
            </article>
          ))}
          {!audit.length ? <p className={styles.muted}>No matching audit events.</p> : null}
        </div>
      </section>
    </>
  );
}

function StaffCard({
  member,
  roles,
  busy,
  canManageRoles,
  onSave,
  onRevoke,
}: {
  member: AdminStaffMember;
  roles: AdminRole[];
  busy: boolean;
  canManageRoles: boolean;
  onSave: (roles: AdminRole[], reason: string) => Promise<unknown>;
  onRevoke: (reason: string) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<AdminRole[]>(member.roles);
  const [reason, setReason] = useState("");

  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{member.displayName}</strong>
          <p className={styles.muted}>{member.email}</p>
        </div>
        <span className={styles.statusBadge}>{member.status}</span>
      </div>

      {canManageRoles ? (
        <div className={styles.roleGrid}>
          {roles.map((role) => (
            <label className={styles.check} key={role}>
              <input
                checked={selected.includes(role)}
                type="checkbox"
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...new Set([...current, role])]
                      : current.filter((item) => item !== role),
                  )
                }
              />
              {roleLabels[role]}
            </label>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>
          Roles: {member.roles.map((role) => roleLabels[role]).join(" · ") || "None"}
        </p>
      )}

      <input
        aria-label={`Reason for securing ${member.displayName}`}
        placeholder="Mandatory audit reason (8+ characters)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.actions}>
        {canManageRoles ? (
          <button
            className={styles.button}
            disabled={busy || reason.trim().length < 8}
            type="button"
            onClick={() => void onSave(selected, reason)}
          >
            Save roles
          </button>
        ) : null}
        <button
          className={styles.danger}
          disabled={busy || reason.trim().length < 8}
          type="button"
          onClick={() => void onRevoke(reason)}
        >
          Revoke sessions
        </button>
      </div>
    </article>
  );
}

function ComplianceEditor({
  channelId,
  profile,
  reason,
  setReason,
  busy,
  onSaved,
  onAct,
}: {
  channelId: string;
  profile: NonNullable<Awaited<ReturnType<typeof getCreatorCompliance>>["profile"]>;
  reason: string;
  setReason: (value: string) => void;
  busy: boolean;
  onSaved: (value: unknown) => void;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [identityStatus, setIdentityStatus] = useState(profile.identityStatus);
  const [taxStatus, setTaxStatus] = useState(profile.taxStatus);

  return (
    <div className={styles.formGrid}>
      <label>
        Legal beneficiary
        <input disabled value={profile.legalName} />
      </label>
      <label>
        Destination
        <input disabled value={profile.destinationMask ?? "Not configured"} />
      </label>
      <label>
        Identity status
        <select value={identityStatus} onChange={(event) => setIdentityStatus(event.target.value)}>
          {identityOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tax status
        <select value={taxStatus} onChange={(event) => setTaxStatus(event.target.value)}>
          {taxOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.fullField}>
        Audit reason
        <input
          placeholder="Why is this compliance state changing?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy || reason.trim().length < 8}
          type="button"
          onClick={() =>
            void onAct(async () => {
              const result = await updateCreatorCompliance(channelId, {
                identityStatus,
                taxStatus,
                reason,
              });
              onSaved(result);
            }, "Creator compliance status updated.")
          }
        >
          Save compliance
        </button>
      </div>
    </div>
  );
}

function SupportTicketCard({
  ticket,
  staff,
  busy,
  canAssign,
  onSave,
}: {
  ticket: AdminSupportTicket;
  staff: AdminStaffMember[];
  busy: boolean;
  canAssign: boolean;
  onSave: (input: {
    status: AdminSupportTicket["status"];
    priority: AdminSupportTicket["priority"];
    assignedToAccountId: string | null;
    resolution: string | null;
    reason: string;
  }) => Promise<unknown>;
}) {
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [assignee, setAssignee] = useState(ticket.assignedToAccountId ?? "");
  const [resolution, setResolution] = useState(ticket.resolution ?? "");
  const [reason, setReason] = useState("");

  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{ticket.subject}</strong>
          <p className={styles.muted}>
            {ticket.category} · {ticket.createdBy?.displayName ?? ticket.createdByAccountId}
          </p>
        </div>
        <span className={styles.statusBadge}>{ticket.status}</span>
      </div>
      <p>{ticket.description}</p>
      <div className={styles.formGrid}>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminSupportTicket["status"])}
          >
            {["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as AdminSupportTicket["priority"])}
          >
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Assigned staff
          {canAssign ? (
            <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">Unassigned</option>
              {assignee && !staff.some((member) => member.id === assignee) ? (
                <option value={assignee}>{assignee}</option>
              ) : null}
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input disabled value={assignee || "Unassigned"} />
          )}
        </label>
        <label>
          Audit reason
          <input
            placeholder="Mandatory reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className={styles.fullField}>
          Resolution / internal outcome
          <textarea value={resolution} onChange={(event) => setResolution(event.target.value)} />
        </label>
      </div>
      <button
        className={styles.button}
        disabled={busy || reason.trim().length < 8}
        type="button"
        onClick={() =>
          void onSave({
            status,
            priority,
            assignedToAccountId: canAssign ? assignee || null : ticket.assignedToAccountId,
            resolution: resolution.trim() || null,
            reason,
          })
        }
      >
        Save ticket
      </button>
    </article>
  );
}
