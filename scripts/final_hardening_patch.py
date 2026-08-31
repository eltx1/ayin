from pathlib import Path

admin_path = Path("apps/api/src/admin/admin-governance.service.ts")
admin = admin_path.read_text()
old_admin = '''    const nextRoles = [...new Set(roles)];
    if (accountId === actorAccountId && !nextRoles.includes("SUPERADMIN")) {
      throw adminBadRequest(
        "SELF_SUPERADMIN_REMOVAL_BLOCKED",
        "A superadmin cannot remove their own superadmin access.",
      );
    }
    await this.database.client.account.findUniqueOrThrow({ where: { id: accountId } });
    return this.database.client.$transaction(async (tx) => {
      const before = await tx.adminRoleAssignment.findMany({
        where: { accountId },
        select: { role: true },
      });
      await tx.adminRoleAssignment.deleteMany({ where: { accountId } });
      if (nextRoles.length) {
        await tx.adminRoleAssignment.createMany({
          data: nextRoles.map((role) => ({ accountId, role })),
          skipDuplicates: true,
        });
      }
      await tx.account.update({
        where: { id: accountId },
        data: { authVersion: { increment: 1 } },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "staff.roles_updated",
        entityType: "Account",
        entityId: accountId,
        reason,
        metadata: {
          before: before.map((item) => item.role),
          after: nextRoles,
          sessionsRevoked: true,
        },
      });
      return { accountId, roles: nextRoles, sessionsRevoked: true };
    });
'''
new_admin = '''    const nextRoles = [...new Set(roles)];
    if (accountId === actorAccountId && !nextRoles.includes("SUPERADMIN")) {
      throw adminBadRequest(
        "SELF_SUPERADMIN_REMOVAL_BLOCKED",
        "A superadmin cannot remove their own superadmin access.",
      );
    }
    await this.database.client.account.findUniqueOrThrow({ where: { id: accountId } });
    return this.database.client.$transaction(async (tx) => {
      // Serialize staff-role mutations so concurrent cross-account demotions cannot remove every
      // superadmin. The transaction-scoped advisory lock is automatically released on commit/rollback.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(1096379721, 1398034002)`;

      // AdminGuard ran before the transaction. Revalidate after acquiring the lock so a queued
      // request from a superadmin who was just demoted cannot commit another role mutation.
      const actorStillSuperadmin = await tx.adminRoleAssignment.findFirst({
        where: { accountId: actorAccountId, role: "SUPERADMIN" },
        select: { accountId: true },
      });
      if (!actorStillSuperadmin) {
        throw adminBadRequest(
          "SUPERADMIN_ACCESS_CHANGED",
          "Superadmin access changed before the staff-role update could be committed.",
        );
      }

      const before = await tx.adminRoleAssignment.findMany({
        where: { accountId },
        select: { role: true },
      });
      await tx.adminRoleAssignment.deleteMany({ where: { accountId } });
      if (nextRoles.length) {
        await tx.adminRoleAssignment.createMany({
          data: nextRoles.map((role) => ({ accountId, role })),
          skipDuplicates: true,
        });
      }

      const remainingSuperadmins = await tx.adminRoleAssignment.count({
        where: { role: "SUPERADMIN" },
      });
      if (remainingSuperadmins < 1) {
        throw adminBadRequest(
          "LAST_SUPERADMIN_REMOVAL_BLOCKED",
          "At least one superadmin must remain assigned.",
        );
      }

      await tx.account.update({
        where: { id: accountId },
        data: { authVersion: { increment: 1 } },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "staff.roles_updated",
        entityType: "Account",
        entityId: accountId,
        reason,
        metadata: {
          before: before.map((item) => item.role),
          after: nextRoles,
          sessionsRevoked: true,
        },
      });
      return { accountId, roles: nextRoles, sessionsRevoked: true };
    });
'''
if old_admin not in admin:
    raise SystemExit("admin governance patch anchor not found")
admin_path.write_text(admin.replace(old_admin, new_admin, 1))

finance_path = Path("apps/api/src/revenue/creator-finance.service.ts")
finance = finance_path.read_text()
old_finance = '''    const existing = await this.finance.getProfile(channel.id);
    let encrypted: string | null = null;
    let mask: string | null = null;
    if (input.destination) {
      encrypted = encryptPayoutDestination(input.destination);
      mask = maskPayoutDestination(input.destination);
    } else if (!existing?.destinationEncrypted) {
      throw new Error("PAYOUT_DESTINATION_REQUIRED");
    }

    const saved = await this.finance.upsertProfile({
      channelId: channel.id,
      legalName: input.legalName,
      preferredCurrency: input.preferredCurrency,
      provider: input.provider,
      destinationEncrypted: encrypted,
      destinationMask: mask,
      countryCode: input.countryCode ?? null,
    });

    await this.database.client.adminAuditLog.create({
      data: {
        actorAccountId: accountId,
        action: "creator.payout_profile_updated",
        entityType: "CreatorPayoutProfile",
        entityId: saved.id,
        metadata: {
          channelId: channel.id,
          provider: saved.provider,
          preferredCurrency: saved.preferredCurrency,
          destinationConfigured: Boolean(saved.destinationEncrypted),
        },
      },
    });

    return this.serializeProfile(saved);
'''
new_finance = '''    const encrypted = input.destination ? encryptPayoutDestination(input.destination) : null;
    const mask = input.destination ? maskPayoutDestination(input.destination) : null;

    const saved = await this.database.client.$transaction(async (tx) => {
      const existing = await tx.creatorPayoutProfile.findUnique({
        where: { channelId: channel.id },
        select: { destinationEncrypted: true },
      });
      if (!encrypted && !existing?.destinationEncrypted) {
        throw new Error("PAYOUT_DESTINATION_REQUIRED");
      }

      // Beneficiary details and their audit row are one atomic finance mutation. Any failure in
      // either write rolls the complete profile update back.
      const profile = await tx.creatorPayoutProfile.upsert({
        where: { channelId: channel.id },
        update: {
          legalName: input.legalName,
          preferredCurrency: input.preferredCurrency,
          provider: input.provider,
          ...(encrypted !== null
            ? { destinationEncrypted: encrypted, destinationMask: mask }
            : {}),
          countryCode: input.countryCode ?? null,
        },
        create: {
          channelId: channel.id,
          legalName: input.legalName,
          preferredCurrency: input.preferredCurrency,
          provider: input.provider,
          destinationEncrypted: encrypted,
          destinationMask: mask,
          countryCode: input.countryCode ?? null,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          actorAccountId: accountId,
          action: "creator.payout_profile_updated",
          entityType: "CreatorPayoutProfile",
          entityId: profile.id,
          metadata: {
            channelId: channel.id,
            provider: profile.provider,
            preferredCurrency: profile.preferredCurrency,
            destinationConfigured: Boolean(profile.destinationEncrypted),
          },
        },
      });
      return profile;
    });

    return this.serializeProfile(saved);
'''
if old_finance not in finance:
    raise SystemExit("creator finance patch anchor not found")
finance_path.write_text(finance.replace(old_finance, new_finance, 1))

test_path = Path("apps/api/test/admin-operations.integration.test.ts")
tests = test_path.read_text()
anchor = '''  it("runs creator support through an audited operations lifecycle", async () => {
'''
regression = '''  it("serializes cross-account superadmin demotions and preserves a recovery principal", async () => {
    const superadminA = await register("Superadmin A", "superadmin-a@example.com");
    const superadminB = await register("Superadmin B", "superadmin-b@example.com");
    await grant(superadminA.user.account.id, "SUPERADMIN");
    await grant(superadminB.user.account.id, "SUPERADMIN");

    const [removeB, removeA] = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/admin/operations/staff/${superadminB.user.account.id}/roles`,
        headers: { cookie: superadminA.cookie },
        payload: { roles: ["OPERATIONS"], reason: "Concurrent demotion safety check A" },
      }),
      app.inject({
        method: "PATCH",
        url: `/admin/operations/staff/${superadminA.user.account.id}/roles`,
        headers: { cookie: superadminB.cookie },
        payload: { roles: ["OPERATIONS"], reason: "Concurrent demotion safety check B" },
      }),
    ]);

    expect([removeB.statusCode, removeA.statusCode].filter((status) => status === 200)).toHaveLength(
      1,
    );
    expect(await prisma.adminRoleAssignment.count({ where: { role: "SUPERADMIN" } })).toBe(1);
  });

'''
if anchor not in tests:
    raise SystemExit("admin operations test anchor not found")
test_path.write_text(tests.replace(anchor, regression + anchor, 1))
