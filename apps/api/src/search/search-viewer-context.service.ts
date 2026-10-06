import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";
import { SearchError } from "./search.service.js";

type SearchViewerContext = VideoPolicyContext & {
  accountId?: string | undefined;
  expectedProfileId?: string | undefined;
};

@Injectable()
export class SearchViewerContextService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async run<T>(
    context: SearchViewerContext,
    operation: (policy: VideoPolicyContext) => Promise<T>,
  ): Promise<T> {
    const profile = context.accountId ? await this.currentProfile(context.accountId) : null;
    if (
      (context.accountId && !profile) ||
      (context.expectedProfileId && context.expectedProfileId !== profile?.id)
    ) {
      throw viewerChanged();
    }

    // The current server-owned default profile sets the audience. A requested
    // profile ID can only narrow that identity, and an explicit Kids route can
    // only add restrictions to it.
    const result = await operation({
      countryCode: context.countryCode,
      isKidsProfile: context.isKidsProfile === true || profile?.isKids === true,
    });

    // Do not publish an adult response when a slow search overlaps a default
    // profile switch, deletion, or Kids-policy change.
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

function viewerChanged(): SearchError {
  return new SearchError(
    "SEARCH_VIEWER_CHANGED",
    "Your viewer profile changed. Refresh and try again.",
    409,
  );
}
