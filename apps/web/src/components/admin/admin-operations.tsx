"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  downloadAdminCsv,
  getAdminAudit,
  getAdminRoles,
  getAdminStaff,
  getAdminSupportTickets,
  getCreatorCompliance,
  revokeAccountSessions,
  updateAdminStaffRoles,
  updateAdminSupportTicket,
  updateCreatorCompliance,
  type AdminAuditItem,
  type AdminRole,
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
const taxOptions = ["NOT_PROVIDED", "PENDING", "VALID", "REJECTED"] as const;

export function AdminOperations() {
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

  const load = useCallback(async () => {
    setMessage("");
    try {
      const [roleData, staffData, auditData, ticketData] = await Promise.all([
        getAdminRoles(),
        getAdminStaff(staffQuery),
        getAdminAudit(
          auditQuery.trim()
            ? new URLSearchParams({ query: auditQuery.trim(), take: "50" })
            : undefined,
        ),
        getAdminSupportTickets(),
      ]);
      setRoles(roleData.roles);
      setStaff(staffData.items);
      setAudit(auditData.items);
      setTickets(ticketData.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin operations could not be loaded.");
    }
  }, [auditQuery, staffQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
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

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Operations & governance</span>
          <h1>Admin Operations</h1>
          <p className={styles.muted}>
            Staff RBAC, session revocation, audit history, internal support, compliance and safe CSV
            exports. Sensitive payout destination data remains masked.
          </p>
        </div>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      <section aria-label="Operations summary" className={styles.metrics}>
        <article className={styles.metric}>
          <span className={styles.muted}>Staff accounts</span>
          <strong>{staff.length}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Open support</span>
          <strong>{openTicketCount}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Audit events loaded</span>
          <strong>{audit.length}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Scoped roles</span>
          <strong>{roles.length}</strong>
        </article>
      </section>

      <div className={styles.operationsGrid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Staff RBAC</h2>
              <p className={styles.muted}>
                Role changes revoke existing sessions. SUPERADMIN is required to change assignments.
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

        <section className={styles.card}>
          <h2>Exports</h2>
          <p className={styles.muted}>
            Generate current CSV snapshots without direct database access.
          </p>
          <div className={styles.actions}>
            {(["users", "channels", "videos", "payouts", "audit"] as const).map((resource) => (
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
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Creator compliance</h2>
            <p className={styles.muted}>
              Review a creator payout profile and update identity/tax workflow status. This does not
              replace a future KYC or tax provider.
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

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Internal support queue</h2>
            <p className={styles.muted}>
              Authenticated users can open tickets; staff can triage, assign and resolve them here.
            </p>
          </div>
        </div>
        <div className={styles.grid}>
          {tickets.map((ticket) => (
            <SupportTicketCard
              busy={busy}
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

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Audit log</h2>
            <p className={styles.muted}>
              Security-sensitive and operational changes are searchable and attributable.
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
  onSave,
  onRevoke,
}: {
  member: AdminStaffMember;
  roles: AdminRole[];
  busy: boolean;
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
      <input
        aria-label={`Reason for changing ${member.displayName}`}
        placeholder="Mandatory audit reason (8+ characters)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy || reason.trim().length < 8}
          type="button"
          onClick={() => void onSave(selected, reason)}
        >
          Save roles
        </button>
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
  onSave,
}: {
  ticket: AdminSupportTicket;
  staff: AdminStaffMember[];
  busy: boolean;
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
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Unassigned</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
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
            assignedToAccountId: assignee || null,
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
