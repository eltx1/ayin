import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { CreatorTvError, CreatorTvService, type CreatorTvEditActor } from "./creator-tv.service.js";
import {
  CREATOR_TV_LINEAR_PROVIDER,
  LinearProviderUnavailableError,
  type LinearChannelPlan,
  type LinearStreamingProvider,
} from "./creator-tv-linear.provider.js";

@Injectable()
export class CreatorTvLinearService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CreatorTvService) private readonly creatorTv: CreatorTvService,
    @Inject(CREATOR_TV_LINEAR_PROVIDER) private readonly provider: LinearStreamingProvider,
  ) {}

  async publicCapability(handle: string, now = new Date()) {
    const plan = await this.buildPlanByHandle(handle, now);
    const state = await this.provider.getState(plan.tvChannelId);
    return {
      provider: state,
      hls: {
        available: state.configured && state.status === "READY" && Boolean(state.hlsUrl),
        url: state.hlsUrl,
      },
      epg: plan.epg,
      adMarkers: plan.adMarkers,
      fallback: plan.fallback,
    };
  }

  async status(actor: CreatorTvEditActor, tvChannelId: string, now = new Date()) {
    const target = await this.authorizedTarget(actor, tvChannelId);
    const plan = await this.buildPlanByHandle(target.handle, now);
    return {
      state: await this.provider.getState(tvChannelId),
      plan: summarizePlan(plan),
    };
  }

  async provision(actor: CreatorTvEditActor, tvChannelId: string, now = new Date()) {
    const target = await this.authorizedTarget(actor, tvChannelId);
    const plan = await this.buildPlanByHandle(target.handle, now);
    try {
      return { state: await this.provider.provision(plan), plan: summarizePlan(plan) };
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  async reconcile(actor: CreatorTvEditActor, tvChannelId: string, now = new Date()) {
    const target = await this.authorizedTarget(actor, tvChannelId);
    const plan = await this.buildPlanByHandle(target.handle, now);
    try {
      return { state: await this.provider.reconcile(plan), plan: summarizePlan(plan) };
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  async stop(actor: CreatorTvEditActor, tvChannelId: string) {
    await this.authorizedTarget(actor, tvChannelId);
    return { state: await this.provider.stop(tvChannelId) };
  }

  async buildPlanByHandle(handle: string, now = new Date()): Promise<LinearChannelPlan> {
    const tv = await this.creatorTv.getPublicTv(handle, now);
    const programs = tv.schedule.guide.map((program) => ({
      occurrenceKey: program.occurrenceKey,
      videoId: program.video.id,
      title: program.video.title,
      startsAt: program.startsAt.toISOString(),
      endsAt: program.endsAt.toISOString(),
      playbackOffsetMs: program.playbackOffsetMs,
      source: {
        objectKey: program.video.source.objectKey,
        mimeType: program.video.source.mimeType,
      },
    }));
    const adMarkers = tv.schedule.adBreaks.map((marker) => ({
      ...marker,
      signaling: "SCTE35_INTENT" as const,
    }));
    return {
      tvChannelId: tv.tv.id,
      channelId: tv.channel.id,
      channelHandle: tv.canonicalHandle,
      generatedAt: tv.schedule.generatedAt.toISOString(),
      windowEndsAt: tv.schedule.windowEndsAt.toISOString(),
      programs,
      adMarkers,
      epg: {
        format: "XMLTV",
        xml: buildXmlTv(tv.tv.id, tv.tv.name, programs),
      },
      fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
    };
  }

  private async authorizedTarget(actor: CreatorTvEditActor, tvChannelId: string) {
    const tv = await this.database.client.creatorTvChannel.findUnique({
      where: { id: tvChannelId },
      select: { id: true, channelId: true, channel: { select: { handle: true } } },
    });
    if (!tv)
      throw new CreatorTvError("CREATOR_TV_NOT_FOUND", "This Creator TV could not be found.", 404);
    await this.creatorTv.getManagement(actor, tv.channelId);
    return { id: tv.id, channelId: tv.channelId, handle: tv.channel.handle };
  }

  private mapProviderError(error: unknown): Error {
    if (error instanceof LinearProviderUnavailableError)
      return new CreatorTvError("LINEAR_PROVIDER_UNAVAILABLE", error.message, 503);
    return error instanceof Error ? error : new Error("Unexpected linear provider error.");
  }
}

function summarizePlan(plan: LinearChannelPlan) {
  return {
    tvChannelId: plan.tvChannelId,
    channelId: plan.channelId,
    channelHandle: plan.channelHandle,
    generatedAt: plan.generatedAt,
    windowEndsAt: plan.windowEndsAt,
    programCount: plan.programs.length,
    adMarkerCount: plan.adMarkers.length,
    fallback: plan.fallback,
  };
}

export function buildXmlTv(
  tvChannelId: string,
  channelName: string,
  programs: LinearChannelPlan["programs"],
): string {
  const entries = programs
    .map(
      (program) =>
        `<programme start="${xmlTvTime(program.startsAt)}" stop="${xmlTvTime(program.endsAt)}" channel="${escapeXml(tvChannelId)}"><title>${escapeXml(program.title)}</title><episode-num system="ayin">${escapeXml(program.videoId)}</episode-num></programme>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><tv generator-info-name="AYIN"><channel id="${escapeXml(tvChannelId)}"><display-name>${escapeXml(channelName)}</display-name></channel>${entries}</tv>`;
}

function xmlTvTime(value: string): string {
  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
