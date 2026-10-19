import type { Prisma } from "@ayin/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { analyticsPseudonym } from "../analytics/analytics-identity.js";

type Authority = AuthenticatedRequest["ayinAuth"];
export type BlockTarget =
  { channelId: string; profileId?: never } | { profileId: string; channelId?: never };

@Injectable()
export class UserBlocksService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(accountId: string) {
    const rows = await this.database.client.userBlock.findMany({
      where: { blockerAccountId: accountId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    // Return only the public target the viewer actually blocked. Enumerating
    // all of an owner's channels/default profile would reveal identity links.
    const channels = await this.database.client.channel.findMany({
      where: {
        id: { in: rows.flatMap((row) => (row.sourceChannelId ? [row.sourceChannelId] : [])) },
        status: "ACTIVE",
        removedAt: null,
      },
      select: { id: true, name: true, handle: true },
    });
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    return {
      accountId,
      items: rows.map((row) => ({
        blockedAccountId: row.blockedAccountId,
        displayName: row.publicLabel,
        channels:
          row.sourceChannelId && byId.has(row.sourceChannelId)
            ? [byId.get(row.sourceChannelId)!]
            : [],
        createdAt: row.createdAt,
      })),
    };
  }

  async block(auth: Authority, target: BlockTarget) {
    return this.database.client.$transaction(async (tx) => {
      await this.assertAuthority(tx, auth);
      let targetIds: string[];
      let publicLabel: string;
      if (target.channelId) {
        const members = await tx.channelMember.findMany({
          where: {
            channelId: target.channelId,
            role: "OWNER",
            account: { status: "ACTIVE" },
            channel: { status: "ACTIVE", removedAt: null },
          },
          select: { accountId: true, channel: { select: { name: true } } },
        });
        targetIds = members.map((member) => member.accountId);
        publicLabel = members[0]?.channel.name ?? "Blocked user";
      } else {
        if (!target.profileId) throw new BadRequestException("Choose a profile to block.");
        const profile = await tx.viewerProfile.findFirst({
          where: {
            id: target.profileId,
            deletedAt: null,
            account: { status: "ACTIVE" },
          },
          select: { accountId: true, name: true },
        });
        targetIds = profile ? [profile.accountId] : [];
        publicLabel = profile?.name ?? "Blocked user";
      }
      if (!targetIds.length) throw new NotFoundException("This user is unavailable.");
      if (targetIds.includes(auth.accountId))
        throw new BadRequestException("You cannot block your own account or channel.");
      const count = await tx.userBlock.count({ where: { blockerAccountId: auth.accountId } });
      const existing = await tx.userBlock.count({
        where: {
          blockerAccountId: auth.accountId,
          blockedAccountId: { in: targetIds },
        },
      });
      if (count + targetIds.length - existing > 500)
        throw new ConflictException("The blocked-user limit has been reached.");
      await tx.userBlock.createMany({
        data: targetIds.map((blockedAccountId) => ({
          blockerAccountId: auth.accountId,
          blockedAccountId,
          publicLabel,
          sourceChannelId: target.channelId ?? null,
        })),
        skipDuplicates: true,
      });
      // Remove both directions of subscriptions so later bulk notifications
      // cannot retain the previous relationship. Unblock never resubscribes.
      const memberships = await tx.channelMember.findMany({
        where: {
          accountId: { in: [auth.accountId, ...targetIds] },
          role: "OWNER",
        },
        select: { accountId: true, channelId: true },
      });
      const subscriptionWhere = {
        OR: [
          {
            profile: { accountId: auth.accountId },
            channelId: {
              in: memberships
                .filter((m) => targetIds.includes(m.accountId))
                .map((m) => m.channelId),
            },
          },
          {
            profile: { accountId: { in: targetIds } },
            channelId: {
              in: memberships.filter((m) => m.accountId === auth.accountId).map((m) => m.channelId),
            },
          },
        ],
      };
      const subscriptions = await tx.subscription.findMany({
        where: subscriptionWhere,
        select: { profileId: true, channelId: true },
      });
      await tx.subscription.deleteMany({ where: subscriptionWhere });
      if (subscriptions.length)
        await tx.analyticsSubscriptionEpisode.updateMany({
          where: {
            unsubscribedAt: null,
            OR: subscriptions.map((row) => ({
              channelId: row.channelId,
              profileHash: analyticsPseudonym(row.profileId),
            })),
          },
          data: { unsubscribedAt: new Date() },
        });
      return { accountId: auth.accountId, blockedAccountIds: targetIds, blocked: true as const };
    });
  }

  async unblock(auth: Authority, blockedAccountId: string) {
    return this.database.client.$transaction(async (tx) => {
      await this.assertAuthority(tx, auth);
      await tx.userBlock.deleteMany({
        where: { blockerAccountId: auth.accountId, blockedAccountId },
      });
      return { accountId: auth.accountId, blockedAccountId, blocked: false as const };
    });
  }

  private async assertAuthority(tx: Prisma.TransactionClient, auth: Authority) {
    // Serialize this account's preference writes and fence logout/deletion.
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${auth.accountId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE id=${auth.sessionId}::uuid FOR SHARE`;
    const account = await tx.account.findUnique({
      where: { id: auth.accountId },
      select: { status: true, authVersion: true },
    });
    const session = await tx.accountSession.findUnique({
      where: { id: auth.sessionId },
      select: { accountId: true, authVersion: true, revokedAt: true, expiresAt: true },
    });
    if (
      !account ||
      account.status !== "ACTIVE" ||
      account.authVersion !== auth.authVersion ||
      !session ||
      session.accountId !== auth.accountId ||
      session.authVersion !== auth.authVersion ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException();
  }
}
