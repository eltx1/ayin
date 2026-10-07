import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import type { VideoPolicyContext } from "./video-policy.service.js";

export type ViewerPolicyContext = VideoPolicyContext & {
  accountId?: string | undefined;
  expectedProfileId?: string | undefined;
};

@Injectable()
export class ViewerPolicyContextService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async run<T>(
    context: ViewerPolicyContext,
    operation: (policy: VideoPolicyContext) => Promise<T>,
    viewerChanged: () => Error,
  ): Promise<T> {
    const profile = context.accountId ? await this.currentProfile(context.accountId) : null;
    if (
      (context.accountId && !profile) ||
      (context.expectedProfileId && context.expectedProfileId !== profile?.id)
    ) {
      throw viewerChanged();
    }

    // Only the live server-owned default can establish the viewer audience.
    // Client profile fences and explicit Kids routes can only narrow access.
    const result = await operation({
      countryCode: context.countryCode,
      isKidsProfile: context.isKidsProfile === true || profile?.isKids === true,
    });

    // A held operation cannot disclose its result after a default/profile-kind
    // change or deletion, including changes while loading captions/episode data.
    if (context.accountId && profile) {
      const current = await this.currentProfile(context.accountId);
      if (!current || current.id !== profile.id || current.isKids !== profile.isKids) {
        throw viewerChanged();
      }
    }
    return result;
  }

  private currentProfile(accountId: string) {
    return this.database.client.viewerProfile.findFirst({
      where: { accountId, isDefault: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, isKids: true },
    });
  }
}
