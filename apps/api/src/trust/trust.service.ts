import { Inject, Injectable } from "@nestjs/common";
import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  actionSchema,
  appealDecisionSchema,
  appealSchema,
  caseSchema,
  reportSchema,
  settingsSchema,
  takedownDecisionSchema,
  takedownSchema,
  trustSchema,
} from "./trust.schemas.js";
import { containsBlockedTerm } from "./trust-policy.js";

@Injectable()
export class TrustService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}
  private async profile(accountId: string) {
    return this.db.client.viewerProfile.findFirstOrThrow({
      where: { accountId },
      orderBy: { createdAt: "asc" },
    });
  }
  async report(accountId: string, input: unknown) {
    const data = reportSchema.parse(input);
    const profile = await this.profile(accountId);
    if (data.videoId) await this.db.client.video.findUniqueOrThrow({ where: { id: data.videoId } });
    if (data.commentId)
      await this.db.client.comment.findUniqueOrThrow({ where: { id: data.commentId } });
    return this.db.client.report.create({
      data: {
        reporterProfileId: profile.id,
        reason: data.reason,
        ...(data.videoId ? { videoId: data.videoId } : {}),
        ...(data.commentId ? { commentId: data.commentId } : {}),
        ...(data.details ? { details: data.details } : {}),
      },
    });
  }
  async takedown(accountId: string, input: unknown) {
    const d = takedownSchema.parse(input);
    if (d.videoId) await this.db.client.video.findUniqueOrThrow({ where: { id: d.videoId } });
    return this.db.client.takedownRequest.create({
      data: {
        requesterId: accountId,
        claimantName: d.claimantName,
        contactEmail: d.contactEmail,
        rightsBasis: d.rightsBasis,
        details: d.details,
        ...(d.videoId ? { videoId: d.videoId } : {}),
      },
    });
  }
  async appeal(accountId: string, input: unknown) {
    const d = appealSchema.parse(input);
    const action = await this.db.client.moderationAction.findUniqueOrThrow({
      where: { id: d.actionId },
    });
    const member = action.channelId
      ? await this.db.client.channelMember.findFirst({
          where: { accountId, channelId: action.channelId },
        })
      : null;
    if (action.targetAccountId !== accountId && !member) throw new Error("NOT_ACTION_TARGET");
    return this.db.client.moderationAppeal.create({
      data: { actionId: d.actionId, accountId, message: d.message },
    });
  }
  async creatorHistory(accountId: string) {
    const memberships = await this.db.client.channelMember.findMany({
      where: { accountId },
      select: { channelId: true },
    });
    const channelIds = memberships.map((x) => x.channelId);
    const [actions, appeals, notices, trust] = await Promise.all([
      this.db.client.moderationAction.findMany({
        where: { OR: [{ targetAccountId: accountId }, { channelId: { in: channelIds } }] },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.client.moderationAppeal.findMany({
        where: { accountId },
        include: { action: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.client.notification.findMany({
        where: { accountId, type: "MODERATION" },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.client.creatorTrustState.findMany({ where: { channelId: { in: channelIds } } }),
    ]);
    return { actions, appeals, notices, trust };
  }
  async listQueue() {
    return Promise.all([
      this.db.client.report.findMany({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
        orderBy: { createdAt: "asc" },
        take: 250,
      }),
      this.db.client.moderationCase.findMany({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
        include: { reports: true },
        orderBy: { createdAt: "asc" },
        take: 250,
      }),
      this.db.client.takedownRequest.findMany({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
        orderBy: { createdAt: "asc" },
        take: 250,
      }),
      this.db.client.moderationAppeal.findMany({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
        include: { action: true },
        orderBy: { createdAt: "asc" },
        take: 250,
      }),
    ]).then(([reports, cases, takedowns, appeals]) => ({ reports, cases, takedowns, appeals }));
  }
  async updateCase(actor: string, id: string, input: unknown) {
    const d = caseSchema.parse(input);
    return this.db.client.$transaction(async (tx) => {
      const row = await tx.moderationCase.update({
        where: { id },
        data: {
          status: d.status,
          ...(d.resolution ? { resolution: d.resolution } : {}),
          ...(["CLOSED", "DISMISSED"].includes(d.status) ? { closedAt: new Date() } : {}),
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor,
        action: "MODERATION_CASE_UPDATED",
        entityType: "ModerationCase",
        entityId: id,
        ...(d.resolution ? { reason: d.resolution } : {}),
        metadata: { status: d.status },
      });
      return row;
    });
  }
  async act(actor: string, input: unknown) {
    const d = actionSchema.parse(input);
    return this.db.client.$transaction(async (tx) => {
      if (d.kind === "SUSPEND_ACCOUNT") {
        if (!d.targetAccountId) throw new Error("ACCOUNT_REQUIRED");
        await tx.account.update({
          where: { id: d.targetAccountId },
          data: { status: "SUSPENDED", authVersion: { increment: 1 } },
        });
      }
      if (d.kind === "SUSPEND_CHANNEL") {
        if (!d.channelId) throw new Error("CHANNEL_REQUIRED");
        await tx.channel.update({ where: { id: d.channelId }, data: { status: "SUSPENDED" } });
      }
      if (d.kind === "UNPUBLISH_VIDEO" || d.kind === "REMOVE_VIDEO") {
        if (!d.videoId) throw new Error("VIDEO_REQUIRED");
        await tx.video.update({
          where: { id: d.videoId },
          data: { status: d.kind === "REMOVE_VIDEO" ? "REMOVED" : "DRAFT", publishedAt: null },
        });
      }
      if (d.kind === "STRIKE" && d.channelId) {
        await tx.creatorTrustState.upsert({
          where: { channelId: d.channelId },
          update: { strikeCount: { increment: 1 }, level: "RESTRICTED" },
          create: { channelId: d.channelId, strikeCount: 1, level: "RESTRICTED" },
        });
      }
      const row = await tx.moderationAction.create({
        data: {
          actorAccountId: actor,
          kind: d.kind,
          reason: d.reason,
          ...(d.caseId ? { caseId: d.caseId } : {}),
          ...(d.targetAccountId ? { targetAccountId: d.targetAccountId } : {}),
          ...(d.channelId ? { channelId: d.channelId } : {}),
          ...(d.videoId ? { videoId: d.videoId } : {}),
        },
      });
      if (d.targetAccountId)
        await tx.notification.create({
          data: {
            accountId: d.targetAccountId,
            type: "MODERATION",
            title: `Moderation action: ${d.kind}`,
            body: d.reason,
            data: { actionId: row.id, channelId: d.channelId ?? null, videoId: d.videoId ?? null },
          },
        });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor,
        action: `MODERATION_${d.kind}`,
        entityType: "ModerationAction",
        entityId: row.id,
        reason: d.reason,
        metadata: {
          targetAccountId: d.targetAccountId ?? null,
          channelId: d.channelId ?? null,
          videoId: d.videoId ?? null,
        },
      });
      return row;
    });
  }
  async decideAppeal(actor: string, id: string, input: unknown) {
    const d = appealDecisionSchema.parse(input);
    return this.db.client.$transaction(async (tx) => {
      const row = await tx.moderationAppeal.update({
        where: { id },
        data: { status: d.status, resolution: d.resolution },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor,
        action: "MODERATION_APPEAL_UPDATED",
        entityType: "ModerationAppeal",
        entityId: id,
        reason: d.resolution,
        metadata: { status: d.status },
      });
      return row;
    });
  }
  async decideTakedown(actor: string, id: string, input: unknown) {
    const d = takedownDecisionSchema.parse(input);
    return this.db.client.$transaction(async (tx) => {
      const row = await tx.takedownRequest.update({ where: { id }, data: d });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor,
        action: "TAKEDOWN_UPDATED",
        entityType: "TakedownRequest",
        entityId: id,
        reason: d.resolution,
        metadata: { status: d.status },
      });
      return row;
    });
  }
  async setTrust(actor: string, channelId: string, input: unknown) {
    const d = trustSchema.parse(input);
    return this.db.client.$transaction(async (tx) => {
      const trustData = {
        level: d.level,
        ...(d.reviewRequired === undefined ? {} : { reviewRequired: d.reviewRequired }),
      };
      const row = await tx.creatorTrustState.upsert({
        where: { channelId },
        update: trustData,
        create: { channelId, ...trustData },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor,
        action: "CREATOR_TRUST_UPDATED",
        entityType: "Channel",
        entityId: channelId,
        metadata: d,
      });
      return row;
    });
  }
  async settings() {
    const rows = await this.db.client.platformSetting.findMany({
      where: { namespace: "MODERATION", key: { in: ["blockedTerms", "newCreatorsRequireReview"] } },
    });
    const m = new Map(rows.map((x) => [x.key, x.value]));
    return {
      blockedTerms: Array.isArray(m.get("blockedTerms")) ? (m.get("blockedTerms") as string[]) : [],
      newCreatorsRequireReview: m.get("newCreatorsRequireReview") === true,
    };
  }
  async updateSettings(actor: string, input: unknown) {
    const d = settingsSchema.parse(input);
    await this.db.client.$transaction(async (tx) => {
      for (const [key, value, type] of [
        ["blockedTerms", d.blockedTerms, "JSON"],
        ["newCreatorsRequireReview", d.newCreatorsRequireReview, "BOOLEAN"],
      ] as const) {
        await tx.platformSetting.upsert({
          where: { namespace_key: { namespace: "MODERATION", key } },
          update: { value, valueType: type },
          create: { namespace: "MODERATION", key, value, valueType: type },
        });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor,
        action: "MODERATION_SETTINGS_UPDATED",
        entityType: "PlatformSetting",
        entityId: "MODERATION",
        metadata: d,
      });
    });
    return d;
  }
  async textAllowed(text: string) {
    const s = await this.settings();
    return !containsBlockedTerm(text, s.blockedTerms);
  }
}
