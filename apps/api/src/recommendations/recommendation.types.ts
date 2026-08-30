export interface RecommendationContext {
  limit?: number | undefined;
}

export interface RecommendationReason {
  code:
    | "FOLLOWED_CHANNEL"
    | "CHANNEL_AFFINITY"
    | "LIKED_CHANNEL"
    | "COMPLETED_CHANNEL"
    | "POPULAR"
    | "RECENT"
    | "RELATED_CHANNEL"
    | "SAFE_FALLBACK";
  label: string;
}

export interface RecommendationItem {
  id: string;
  slug: string;
  title: string;
  channelId: string;
  channelHandle: string;
  channelName: string;
  artworkObjectKey: string | null;
  score: number;
  reason: RecommendationReason;
}

export interface RecommendationServiceContract {
  getHomeRecommendations(profileId: string, context?: RecommendationContext): Promise<unknown>;
  getUpNext(videoId: string, profileId: string): Promise<unknown>;
  getRelated(videoId: string, profileId: string): Promise<unknown>;
  getShortsFeed(profileId: string, context?: RecommendationContext): Promise<unknown>;
  getTvSuggestions(profileId: string, context?: RecommendationContext): Promise<unknown>;
}
