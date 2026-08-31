from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Anchor not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


# 1) Immutable payout destination snapshot at request time.
replace_once(
    "packages/db/prisma/schema.prisma",
    '''  paymentProfileId  String?      @db.Uuid
  requestedAt       DateTime     @default(now())''',
    '''  paymentProfileId             String?      @db.Uuid
  destinationEncryptedSnapshot String?      @db.Text
  destinationMaskSnapshot      String?      @db.VarChar(120)
  legalNameSnapshot            String?      @db.VarChar(160)
  countryCodeSnapshot          String?      @db.Char(2)
  requestedAt                  DateTime     @default(now())''',
)

migration = Path("packages/db/prisma/migrations/20260831043000_payout_destination_snapshot/migration.sql")
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text('''-- Snapshot payout beneficiary details so later profile edits cannot redirect an active payout.\nALTER TABLE "Payout"\n  ADD COLUMN "destinationEncryptedSnapshot" TEXT,\n  ADD COLUMN "destinationMaskSnapshot" VARCHAR(120),\n  ADD COLUMN "legalNameSnapshot" VARCHAR(160),\n  ADD COLUMN "countryCodeSnapshot" CHAR(2);\n\nUPDATE "Payout" p\nSET\n  "destinationEncryptedSnapshot" = cpp."destinationEncrypted",\n  "destinationMaskSnapshot" = cpp."destinationMask",\n  "legalNameSnapshot" = cpp."legalName",\n  "countryCodeSnapshot" = cpp."countryCode"\nFROM "CreatorPayoutProfile" cpp\nWHERE p."paymentProfileId" = cpp."id"\n  AND p."destinationEncryptedSnapshot" IS NULL;\n''')

replace_once(
    "apps/api/src/revenue/creator-finance.service.ts",
    '''    const payout = await this.revenue.createPayout(accountId, { channelId: channel.id, currency });
    const handoff = await this.payoutProvider.createHandoff({''',
    '''    const payout = await this.revenue.createPayout(accountId, { channelId: channel.id, currency });
    await this.database.client.payout.update({
      where: { id: payout.id },
      data: {
        provider: this.payoutProvider.kind,
        requestSource: "CREATOR",
        paymentProfileId: profile.id,
        destinationEncryptedSnapshot: profile.destinationEncrypted,
        destinationMaskSnapshot: profile.destinationMask,
        legalNameSnapshot: profile.legalName,
        countryCodeSnapshot: profile.countryCode,
      },
    });
    const handoff = await this.payoutProvider.createHandoff({''',
)
replace_once(
    "apps/api/src/revenue/creator-finance.service.ts",
    '''    await this.database.client.$executeRaw`
      UPDATE "Payout"
      SET "provider" = ${this.payoutProvider.kind}, "requestSource" = 'CREATOR', "paymentProfileId" = ${profile.id}::uuid
      WHERE "id" = ${payout.id}::uuid
    `;
''',
    '''''',
)

replace_once(
    "apps/api/src/revenue/admin-payout-destination.service.ts",
    '''        cpp."legalName" AS "legalName",
        cpp."provider" AS "profileProvider",
        cpp."destinationEncrypted" AS "destinationEncrypted",
        cpp."destinationMask" AS "destinationMask",
        cpp."countryCode" AS "countryCode"''',
    '''        COALESCE(p."legalNameSnapshot", cpp."legalName") AS "legalName",
        p."provider" AS "profileProvider",
        COALESCE(p."destinationEncryptedSnapshot", cpp."destinationEncrypted") AS "destinationEncrypted",
        COALESCE(p."destinationMaskSnapshot", cpp."destinationMask") AS "destinationMask",
        COALESCE(p."countryCodeSnapshot", cpp."countryCode") AS "countryCode"''',
)

# 2) Compliance vocabulary aligned with DB constraints and repository types.
replace_once(
    "apps/api/src/admin/admin-governance.controller.ts",
    'taxStatus: z.enum(["NOT_PROVIDED", "PENDING", "VALID", "REJECTED"]).optional(),',
    'taxStatus: z.enum(["NOT_PROVIDED", "PENDING", "VERIFIED", "REQUIRES_ACTION"]).optional(),',
)
replace_once(
    "apps/web/src/components/admin/admin-operations.tsx",
    'const taxOptions = ["NOT_PROVIDED", "PENDING", "VALID", "REJECTED"] as const;',
    'const taxOptions = ["NOT_PROVIDED", "PENDING", "VERIFIED", "REQUIRES_ACTION"] as const;',
)
replace_once(
    "apps/web/src/lib/revenue.ts",
    'taxStatus: "NOT_PROVIDED" | "PENDING" | "VALID" | "REJECTED";',
    'taxStatus: "NOT_PROVIDED" | "PENDING" | "VERIFIED" | "REQUIRES_ACTION";',
)

# 3) Scoped staff may read dashboard analytics; cleanup remains operations-only.
replace_once(
    "apps/api/src/analytics/analytics.controller.ts",
    'import { AdminGuard } from "../admin/admin.guard.js";',
    'import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";',
)
replace_once(
    "apps/api/src/analytics/analytics.controller.ts",
    '''const cleanupSchema = z.object({
  retentionDays: z.coerce.number().int().min(30).max(3650).default(400),
});''',
    '''const cleanupSchema = z.object({
  retentionDays: z.coerce.number().int().min(30).max(3650).default(400),
});
const dashboardStaffRoles = [
  "OPERATIONS",
  "CONTENT_MODERATOR",
  "AD_MANAGER",
  "FINANCE_MANAGER",
] as const;''',
)
replace_once(
    "apps/api/src/analytics/analytics.controller.ts",
    '''  @Get()
  metrics() {''',
    '''  @Get()
  @RequireAdminRoles(...dashboardStaffRoles)
  metrics() {''',
)
replace_once(
    "apps/api/src/analytics/analytics.controller.ts",
    '''  @Post("cleanup")
  cleanup(@Body() body: unknown) {''',
    '''  @Post("cleanup")
  @RequireAdminRoles("OPERATIONS")
  cleanup(@Body() body: unknown) {''',
)

# 4) Dashboard only requests finance metrics for finance-capable staff.
replace_once(
    "apps/web/src/lib/admin-control.ts",
    '''export type AdminRole =
  "SUPERADMIN" | "ADMIN" | "OPERATIONS" | "CONTENT_MODERATOR" | "AD_MANAGER" | "FINANCE_MANAGER";
''',
    '''export type AdminRole =
  "SUPERADMIN" | "ADMIN" | "OPERATIONS" | "CONTENT_MODERATOR" | "AD_MANAGER" | "FINANCE_MANAGER";

export interface AdminSession {
  accountId: string;
  roles: AdminRole[];
}
''',
)
replace_once(
    "apps/web/src/lib/admin-control.ts",
    '''export function getAdminDashboard() {
  return adminFetch<Record<string, unknown>>("/admin/control/dashboard");
}
''',
    '''export function getAdminSession() {
  return adminFetch<AdminSession>("/admin/session");
}

export function getAdminDashboard() {
  return adminFetch<Record<string, unknown>>("/admin/control/dashboard");
}
''',
)
replace_once(
    "apps/web/src/components/admin/admin-dashboard.tsx",
    '''  getAdminAnalytics,
  getAdminDashboard,
  getAdminSystemHealth,''',
    '''  getAdminAnalytics,
  getAdminDashboard,
  getAdminSession,
  getAdminSystemHealth,''',
)
replace_once(
    "apps/web/src/components/admin/admin-dashboard.tsx",
    '''    void Promise.all([
      getAdminDashboard(),
      getAdminAnalytics(),
      getAdminSystemHealth(),
      getAdminFinanceSummary(),
    ])
      .then(([body, nextAnalytics, nextHealth, nextFinance]) => {
        if (!active) return;
        setData(body as unknown as DashboardData);
        setAnalytics(nextAnalytics);
        setHealth(nextHealth);
        setFinance(nextFinance);
      })''',
    '''    void getAdminSession()
      .then(async (session) => {
        const canReadFinance = session.roles.some((role) =>
          ["SUPERADMIN", "ADMIN", "FINANCE_MANAGER"].includes(role),
        );
        const [body, nextAnalytics, nextHealth, nextFinance] = await Promise.all([
          getAdminDashboard(),
          getAdminAnalytics(),
          getAdminSystemHealth(),
          canReadFinance ? getAdminFinanceSummary() : Promise.resolve(null),
        ]);
        if (!active) return;
        setData(body as unknown as DashboardData);
        setAnalytics(nextAnalytics);
        setHealth(nextHealth);
        setFinance(nextFinance);
      })''',
)
replace_once(
    "apps/web/src/components/admin/admin-dashboard.tsx",
    '''  if (!data || !analytics || !health || !finance)
    return <p className={styles.muted}>Loading Admin Control Center…</p>;''',
    '''  if (!data || !analytics || !health)
    return <p className={styles.muted}>Loading Admin Control Center…</p>;''',
)
replace_once(
    "apps/web/src/components/admin/admin-dashboard.tsx",
    '''        <article className={styles.card}>
          <h2>Revenue operations</h2>
          <p>
            <strong>{finance.pendingPayouts}</strong> pending payouts
          </p>
          <p>
            <strong>{finance.processingPayouts}</strong> processing payouts
          </p>
          <p>
            <strong>{finance.openDisputes}</strong> open revenue disputes
          </p>
          {finance.pendingValue.map((item) => (
            <p key={item.currency}>
              {item.currency} {item.amount} pending/processing
            </p>
          ))}
          <p className={styles.muted}>
            Provider mode: audited manual payout. External providers are not represented as
            connected.
          </p>
          <Link className={styles.button} href="/admin/revenue">
            Open Revenue Control Center
          </Link>
        </article>''',
    '''        <article className={styles.card}>
          <h2>Revenue operations</h2>
          {finance ? (
            <>
              <p>
                <strong>{finance.pendingPayouts}</strong> pending payouts
              </p>
              <p>
                <strong>{finance.processingPayouts}</strong> processing payouts
              </p>
              <p>
                <strong>{finance.openDisputes}</strong> open revenue disputes
              </p>
              {finance.pendingValue.map((item) => (
                <p key={item.currency}>
                  {item.currency} {item.amount} pending/processing
                </p>
              ))}
              <p className={styles.muted}>
                Provider mode: audited manual payout. External providers are not represented as
                connected.
              </p>
              <Link className={styles.button} href="/admin/revenue">
                Open Revenue Control Center
              </Link>
            </>
          ) : (
            <p className={styles.muted}>
              Finance metrics are intentionally hidden for this scoped staff role.
            </p>
          )}
        </article>''',
)

# 5) Operations page isolates sections that the signed-in staff role cannot read.
replace_once(
    "apps/web/src/components/admin/admin-operations.tsx",
    '''  getAdminRoles,
  getAdminStaff,''',
    '''  getAdminRoles,
  getAdminSession,
  getAdminStaff,''',
)
replace_once(
    "apps/web/src/components/admin/admin-operations.tsx",
    '''      const [roleData, staffData, auditData, ticketData] = await Promise.all([
        getAdminRoles(),
        getAdminStaff(staffQuery),
        getAdminAudit(
          auditQuery.trim()
            ? new URLSearchParams({ query: auditQuery.trim(), take: "50" })
            : undefined,
        ),
        getAdminSupportTickets(),
      ]);''',
    '''      const session = await getAdminSession();
      const privileged = session.roles.some((role) => role === "SUPERADMIN" || role === "ADMIN");
      const canOperate = privileged || session.roles.includes("OPERATIONS");
      const canAudit =
        privileged ||
        session.roles.some((role) =>
          ["OPERATIONS", "CONTENT_MODERATOR", "AD_MANAGER", "FINANCE_MANAGER"].includes(role),
        );
      const canSupport =
        privileged ||
        session.roles.some((role) =>
          ["OPERATIONS", "CONTENT_MODERATOR", "FINANCE_MANAGER"].includes(role),
        );
      const [roleData, staffData, auditData, ticketData] = await Promise.all([
        canOperate ? getAdminRoles() : Promise.resolve({ roles: [] as AdminRole[] }),
        canOperate ? getAdminStaff(staffQuery) : Promise.resolve({ items: [] as AdminStaffMember[] }),
        canAudit
          ? getAdminAudit(
              auditQuery.trim()
                ? new URLSearchParams({ query: auditQuery.trim(), take: "50" })
                : undefined,
            )
          : Promise.resolve({
              items: [] as AdminAuditItem[],
              pagination: { total: 0, page: 1, take: 50, pages: 1 },
            }),
        canSupport
          ? getAdminSupportTickets()
          : Promise.resolve({ items: [] as AdminSupportTicket[] }),
      ]);''',
)

# 6) Semantic support priority ordering, not lexical string ordering.
service = Path("apps/api/src/admin/admin-governance.service.ts")
text = service.read_text()
anchor = '''export type SupportTicketCategory =
  | "GENERAL"
  | "ACCOUNT"
  | "CONTENT"
  | "MONETIZATION"
  | "ADVERTISING"
  | "TECHNICAL"
  | "RIGHTS"
  | "OTHER";
'''
addition = anchor + '''
interface SupportTicketRow {
  id: string;
  createdByAccountId: string;
  assignedToAccountId: string | null;
  category: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}
'''
if anchor not in text:
    raise SystemExit("SupportTicketRow anchor not found")
text = text.replace(anchor, addition, 1)
old = '''    const items = await this.database.client.supportTicket.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });'''
new = '''    const items = await this.database.client.$queryRaw<SupportTicketRow[]>`
      SELECT *
      FROM "SupportTicket"
      WHERE (${input.status ?? null}::text IS NULL OR "status" = ${input.status ?? null})
        AND (${input.priority ?? null}::text IS NULL OR "priority" = ${input.priority ?? null})
      ORDER BY
        CASE "priority"
          WHEN 'URGENT' THEN 4
          WHEN 'HIGH' THEN 3
          WHEN 'NORMAL' THEN 2
          WHEN 'LOW' THEN 1
          ELSE 0
        END DESC,
        "updatedAt" DESC,
        "id" DESC
      LIMIT 200
    `;'''
if old not in text:
    raise SystemExit("Support ordering anchor not found")
service.write_text(text.replace(old, new, 1))

# 7) Regression tests: scoped analytics and immutable payout beneficiary snapshot.
replace_once(
    "apps/api/test/admin-operations.integration.test.ts",
    '''    const financeOperations = await app.inject({
      method: "GET",
      url: "/admin/operations/roles",
      headers: { cookie: finance.cookie },
    });''',
    '''    const financeAnalytics = await app.inject({
      method: "GET",
      url: "/admin/analytics",
      headers: { cookie: finance.cookie },
    });
    expect(financeAnalytics.statusCode).toBe(200);

    const financeCleanup = await app.inject({
      method: "POST",
      url: "/admin/analytics/cleanup",
      headers: { cookie: finance.cookie },
      payload: { retentionDays: 400 },
    });
    expect(financeCleanup.statusCode).toBe(403);

    const financeOperations = await app.inject({
      method: "GET",
      url: "/admin/operations/roles",
      headers: { cookie: finance.cookie },
    });''',
)
replace_once(
    "apps/api/test/admin-operations.integration.test.ts",
    '''    const operationsRoles = await app.inject({
      method: "GET",
      url: "/admin/operations/roles",
      headers: { cookie: operations.cookie },
    });
    expect(operationsRoles.statusCode).toBe(200);''',
    '''    const operationsRoles = await app.inject({
      method: "GET",
      url: "/admin/operations/roles",
      headers: { cookie: operations.cookie },
    });
    expect(operationsRoles.statusCode).toBe(200);

    const operationsAnalytics = await app.inject({
      method: "GET",
      url: "/admin/analytics",
      headers: { cookie: operations.cookie },
    });
    expect(operationsAnalytics.statusCode).toBe(200);''',
)

replace_once(
    "apps/api/test/payout-safety.integration.test.ts",
    '''    expect(requested.statusCode).toBe(201);
    const payoutId = requested.json().payout.id as string;

    const forbidden = await app.inject({''',
    '''    expect(requested.statusCode).toBe(201);
    const payoutId = requested.json().payout.id as string;

    const changedDestination = "Bank transfer: Other Bank / account 9988776655";
    const changedProfile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Payout Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: changedDestination,
        countryCode: "US",
      },
    });
    expect(changedProfile.statusCode).toBe(200);

    const forbidden = await app.inject({''',
)

print("Codex review fixes applied.")
