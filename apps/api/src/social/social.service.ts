import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

export class SocialError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

@Injectable()
export class SocialService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async channelState(accountId: string, channelId: string, requestedProfileId?: string) {
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertChannel(channelId);
    const [count, subscription] = await Promise.all([
      this.database.client.subscription.count({ where: { channelId } }),
      this.database.client.subscription.findUnique({
        where: { profileId_channelId: { profileId: profile.id, channelId } },
        select: { notificationLevel: true },
      }),
    ]);
    return {
      channelId,
      subscriberCount: count,
      subscribed: Boolean(subscription),
      notificationLevel: subscription?.notificationLevel ?? null,
    };
  }

  async subscribe(accountId: string, channelId: string, requestedProfileId?: string) {
    const [profile, channel] = await Promise.all([
      this.resolveProfile(accountId, requestedProfileId),
      this.assertChannel(channelId),
    ]);
    const ownsChannel = await this.database.client.channelMember.findFirst({
      where: { channelId, accountId },
      select: { id: true },
    });
    if (ownsChannel)
      throw new SocialError("SELF_SUBSCRIPTION", "You cannot subscribe to your own channel.", 409);

    const result = await this.database.client.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { profileId_channelId: { profileId: profile.id, channelId } },
        select: { id: true },
      });
      if (!existing) {
        await tx.subscription.create({ data: { profileId: profile.id, channelId } });
        const owners = await tx.channelMember.findMany({
          where: { channelId, role: "OWNER" },
          select: { accountId: true },
        });
        if (owners.length > 0) {
          await tx.notification.createMany({
            data: owners.map((owner) => ({
              accountId: owner.accountId,
              type: "SUBSCRIPTION" as const,
              title: "New subscriber",
              body: `${profile.name} subscribed to ${channel.name}.`,
              data: { channelId, profileId: profile.id },
            })),
          });
        }
      }
      return tx.subscription.count({ where: { channelId } });
    });
    return { channelId, subscribed: true, subscriberCount: result };
  }

  async unsubscribe(accountId: string, channelId: string, requestedProfileId?: string) {
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertChannel(channelId);
    const count = await this.database.client.$transaction(async (tx) => {
      await tx.subscription.deleteMany({ where: { profileId: profile.id, channelId } });
      return tx.subscription.count({ where: { channelId } });
    });
    return { channelId, subscribed: false, subscriberCount: count };
  }

  async videoState(accountId: string, videoId: string, requestedProfileId?: string) {
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertVideo(videoId);
    const [reaction, likeCount, watchLater, myList] = await Promise.all([
      this.database.client.reaction.findUnique({
        where: { profileId_videoId: { profileId: profile.id, videoId } },
        select: { type: true },
      }),
      this.database.client.reaction.count({ where: { videoId, type: "LIKE" } }),
      this.database.client.watchLaterItem.findUnique({
        where: { profileId_videoId: { profileId: profile.id, videoId } },
        select: { id: true },
      }),
      this.database.client.myListItem.findUnique({
        where: { profileId_videoId: { profileId: profile.id, videoId } },
        select: { id: true },
      }),
    ]);
    return {
      videoId,
      reaction: reaction?.type ?? null,
      likeCount,
      watchLater: Boolean(watchLater),
      myList: Boolean(myList),
    };
  }

  async setReaction(
    accountId: string,
    videoId: string,
    type: "LIKE" | "DISLIKE",
    requestedProfileId?: string,
  ) {
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertVideo(videoId);
    await this.database.client.reaction.upsert({
      where: { profileId_videoId: { profileId: profile.id, videoId } },
      create: { profileId: profile.id, videoId, type },
      update: { type },
    });
    return this.videoState(accountId, videoId, profile.id);
  }

  async clearReaction(accountId: string, videoId: string, requestedProfileId?: string) {
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertVideo(videoId);
    await this.database.client.reaction.deleteMany({ where: { profileId: profile.id, videoId } });
    return this.videoState(accountId, videoId, profile.id);
  }

  async setSaved(
    accountId: string,
    videoId: string,
    list: "watch-later" | "my-list",
    saved: boolean,
    requestedProfileId?: string,
  ) {
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertVideo(videoId);
    if (saved) {
      const args = {
        where: { profileId_videoId: { profileId: profile.id, videoId } },
        create: { profileId: profile.id, videoId },
        update: {},
      };
      if (list === "watch-later") await this.database.client.watchLaterItem.upsert(args);
      else await this.database.client.myListItem.upsert(args);
    } else {
      const where = { profileId: profile.id, videoId };
      if (list === "watch-later") await this.database.client.watchLaterItem.deleteMany({ where });
      else await this.database.client.myListItem.deleteMany({ where });
    }
    return { videoId, list, saved };
  }

  async notifications(accountId: string, cursor = 0, limit = 20) {
    const records = await this.database.client.notification.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: cursor,
      take: limit + 1,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        createdAt: true,
      },
    });
    return {
      items: records.slice(0, limit),
      nextCursor: records.length > limit ? cursor + limit : null,
    };
  }

  async markNotificationRead(accountId: string, notificationId: string) {
    const updated = await this.database.client.notification.updateMany({
      where: { id: notificationId, accountId },
      data: { readAt: new Date() },
    });
    if (updated.count === 0)
      throw new SocialError("NOTIFICATION_NOT_FOUND", "This notification is not available.", 404);
    return { id: notificationId, read: true };
  }

  private async resolveProfile(accountId: string, requestedProfileId?: string) {
    const profile = await this.database.client.viewerProfile.findFirst({
      where: requestedProfileId
        ? { id: requestedProfileId, accountId, deletedAt: null }
        : { accountId, isDefault: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (!profile)
      throw new SocialError("PROFILE_NOT_FOUND", "This viewer profile is not available.", 403);
    return profile;
  }

  private async assertChannel(channelId: string) {
    const channel = await this.database.client.channel.findFirst({
      where: { id: channelId, status: "ACTIVE", removedAt: null },
      select: { id: true, name: true },
    });
    if (!channel) throw new SocialError("CHANNEL_NOT_FOUND", "This channel is not available.", 404);
    return channel;
  }

  private async assertVideo(videoId: string) {
    const video = await this.database.client.video.findFirst({
      where: {
        id: videoId,
        status: "PUBLISHED",
        visibility: { in: ["PUBLIC", "UNLISTED"] },
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
      },
      select: { id: true },
    });
    if (!video) throw new SocialError("VIDEO_NOT_FOUND", "This video is not available.", 404);
    return video;
  }
}
