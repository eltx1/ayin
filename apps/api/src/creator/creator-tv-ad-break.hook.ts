import { Injectable } from "@nestjs/common";

export interface CreatorTvAdBreakProgramRef {
  occurrenceKey: string;
  videoId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface CreatorTvAdBreakContext {
  tvChannelId: string;
  channelId: string;
  generatedAt: Date;
  programs: CreatorTvAdBreakProgramRef[];
}

export interface CreatorTvAdBreakMarker {
  id: string;
  occurrenceKey: string;
  offsetMs: number;
  source: "HOUSE" | "DIRECT" | "PROGRAMMATIC";
}

export interface CreatorTvAdBreakHook {
  getBreaks(context: CreatorTvAdBreakContext): Promise<CreatorTvAdBreakMarker[]>;
}

export const CREATOR_TV_AD_BREAK_HOOK = Symbol("CREATOR_TV_AD_BREAK_HOOK");

@Injectable()
export class NoopCreatorTvAdBreakHook implements CreatorTvAdBreakHook {
  async getBreaks(context: CreatorTvAdBreakContext): Promise<CreatorTvAdBreakMarker[]> {
    void context;
    return [];
  }
}
