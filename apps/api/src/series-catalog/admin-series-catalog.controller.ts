import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { SeriesCatalogService } from "./series-catalog.service.js";

const uuid = z.string().uuid();
const statusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const artworkSchema = z
  .object({
    type: z.enum(["POSTER", "BACKDROP", "LOGO"]),
    mediaAssetId: uuid,
    altText: z.string().max(240).nullable().optional(),
  })
  .strict();
const availabilitySchema = z
  .object({
    territoryCode: z.string().min(1).max(2),
    rule: z.enum(["ALLOW", "BLOCK"]),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    note: z.string().max(240).nullable().optional(),
  })
  .strict();
const seriesFields = {
  title: z.string().min(1).max(200),
  slug: z.string().max(160).optional(),
  synopsis: z.string().min(1).max(20_000),
  releaseYear: z.number().int().min(1888).max(2200).nullable().optional(),
  maturityRating: z.string().min(1).max(32),
  originalLanguage: z.string().min(1).max(16),
  trailerVideoId: uuid.nullable().optional(),
  genres: z.array(z.string().min(1).max(80)).max(20),
  artwork: z.array(artworkSchema).max(3),
  availability: z.array(availabilitySchema).max(100).optional(),
};
const createSeriesSchema = z.object(seriesFields).strict();
const patchSeriesSchema = z
  .object({
    title: seriesFields.title.optional(),
    slug: seriesFields.slug,
    synopsis: seriesFields.synopsis.optional(),
    releaseYear: seriesFields.releaseYear,
    maturityRating: seriesFields.maturityRating.optional(),
    originalLanguage: seriesFields.originalLanguage.optional(),
    trailerVideoId: seriesFields.trailerVideoId,
    genres: seriesFields.genres.optional(),
    artwork: seriesFields.artwork.optional(),
    availability: seriesFields.availability,
  })
  .strict();
const createSeasonSchema = z
  .object({
    seasonNumber: z.number().int().min(0).max(10_000),
    title: z.string().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    artwork: z.array(artworkSchema).max(3).optional(),
  })
  .strict();
const patchSeasonSchema = z
  .object({
    seasonNumber: z.number().int().min(0).max(10_000).optional(),
    title: z.string().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
    artwork: z.array(artworkSchema).max(3).optional(),
  })
  .strict();
const episodeFields = {
  episodeNumber: z.number().int().min(0).max(100_000),
  title: z.string().min(1).max(200),
  synopsis: z.string().min(1).max(20_000),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  releaseDate: z.coerce.date().nullable().optional(),
  videoId: uuid.nullable().optional(),
};
const createEpisodeSchema = z.object(episodeFields).strict();
const patchEpisodeSchema = z
  .object({
    episodeNumber: episodeFields.episodeNumber.optional(),
    title: episodeFields.title.optional(),
    synopsis: episodeFields.synopsis.optional(),
    sortOrder: episodeFields.sortOrder,
    releaseDate: episodeFields.releaseDate,
    videoId: episodeFields.videoId,
  })
  .strict();
const reorderSchema = z.object({ orderedIds: z.array(uuid).min(1).max(1_000) }).strict();
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().trim().max(120).optional(),
    status: statusSchema.optional(),
  })
  .strict();

@Controller("admin/catalog/series")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminSeriesCatalogController {
  constructor(
    @Inject(SeriesCatalogService) private readonly catalog: SeriesCatalogService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return {
      items: await this.catalog.listAdmin(
        parsed.data.limit ?? 50,
        parsed.data.q,
        parsed.data.status,
      ),
    };
  }

  @Get(":seriesId")
  async detail(@Param("seriesId") seriesId: string) {
    return { series: await this.catalog.getAdminById(parseId(seriesId)) };
  }

  @Post()
  async create(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const parsed = createSeriesSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const series = await this.catalog.createSeries(parsed.data);
    await this.record(request, "catalog.series.create", "Series", series.id, {
      title: series.title,
      slug: series.slug,
    });
    return { series };
  }

  @Patch(":seriesId")
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("seriesId") seriesId: string,
    @Body() body: unknown,
  ) {
    const parsed = patchSeriesSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const id = parseId(seriesId);
    const series = await this.catalog.updateSeries(id, parsed.data);
    await this.record(request, "catalog.series.update", "Series", id, {
      fields: Object.keys(parsed.data).sort(),
    });
    return { series };
  }

  @Post(":seriesId/publish")
  async publish(@Req() request: AdminAuthenticatedRequest, @Param("seriesId") seriesId: string) {
    const id = parseId(seriesId);
    const series = await this.catalog.publishSeries(id);
    await this.record(request, "catalog.series.publish", "Series", id, { title: series.title });
    return { series };
  }

  @Post(":seriesId/unpublish")
  async unpublish(@Req() request: AdminAuthenticatedRequest, @Param("seriesId") seriesId: string) {
    const id = parseId(seriesId);
    const series = await this.catalog.unpublishSeries(id);
    await this.record(request, "catalog.series.unpublish", "Series", id, { title: series.title });
    return { series };
  }

  @Post(":seriesId/archive")
  async archive(@Req() request: AdminAuthenticatedRequest, @Param("seriesId") seriesId: string) {
    const id = parseId(seriesId);
    const series = await this.catalog.archiveSeries(id);
    await this.record(request, "catalog.series.archive", "Series", id, { title: series.title });
    return { series };
  }

  @Post(":seriesId/seasons")
  async createSeason(
    @Req() request: AdminAuthenticatedRequest,
    @Param("seriesId") seriesId: string,
    @Body() body: unknown,
  ) {
    const parsed = createSeasonSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const parentId = parseId(seriesId);
    const season = await this.catalog.createSeason(parentId, parsed.data);
    await this.record(request, "catalog.season.create", "SeriesSeason", season.id, {
      seriesId: parentId,
      seasonNumber: season.seasonNumber,
    });
    return { season };
  }

  @Post(":seriesId/seasons/reorder")
  async reorderSeasons(
    @Req() request: AdminAuthenticatedRequest,
    @Param("seriesId") seriesId: string,
    @Body() body: unknown,
  ) {
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const id = parseId(seriesId);
    const series = await this.catalog.reorderSeasons(id, parsed.data.orderedIds);
    await this.record(request, "catalog.season.reorder", "Series", id, {
      itemCount: parsed.data.orderedIds.length,
    });
    return { series };
  }

  @Patch("seasons/:seasonId")
  async updateSeason(
    @Req() request: AdminAuthenticatedRequest,
    @Param("seasonId") seasonId: string,
    @Body() body: unknown,
  ) {
    const parsed = patchSeasonSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const id = parseId(seasonId);
    const season = await this.catalog.updateSeason(id, parsed.data);
    await this.record(request, "catalog.season.update", "SeriesSeason", id, {
      fields: Object.keys(parsed.data).sort(),
    });
    return { season };
  }

  @Post("seasons/:seasonId/episodes")
  async createEpisode(
    @Req() request: AdminAuthenticatedRequest,
    @Param("seasonId") seasonId: string,
    @Body() body: unknown,
  ) {
    const parsed = createEpisodeSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const parentId = parseId(seasonId);
    const episode = await this.catalog.createEpisode(parentId, parsed.data);
    await this.record(request, "catalog.episode.create", "SeriesEpisode", episode.id, {
      seasonId: parentId,
      episodeNumber: episode.episodeNumber,
    });
    return { episode };
  }

  @Post("seasons/:seasonId/episodes/reorder")
  async reorderEpisodes(
    @Req() request: AdminAuthenticatedRequest,
    @Param("seasonId") seasonId: string,
    @Body() body: unknown,
  ) {
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const id = parseId(seasonId);
    const season = await this.catalog.reorderEpisodes(id, parsed.data.orderedIds);
    await this.record(request, "catalog.episode.reorder", "SeriesSeason", id, {
      itemCount: parsed.data.orderedIds.length,
    });
    return { season };
  }

  @Patch("episodes/:episodeId")
  async updateEpisode(
    @Req() request: AdminAuthenticatedRequest,
    @Param("episodeId") episodeId: string,
    @Body() body: unknown,
  ) {
    const parsed = patchEpisodeSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const id = parseId(episodeId);
    const episode = await this.catalog.updateEpisode(id, parsed.data);
    await this.record(request, "catalog.episode.update", "SeriesEpisode", id, {
      fields: Object.keys(parsed.data).sort(),
    });
    return { episode };
  }

  @Post("episodes/:episodeId/publish")
  async publishEpisode(
    @Req() request: AdminAuthenticatedRequest,
    @Param("episodeId") episodeId: string,
  ) {
    const id = parseId(episodeId);
    const episode = await this.catalog.publishEpisode(id);
    await this.record(request, "catalog.episode.publish", "SeriesEpisode", id, {
      title: episode.title,
    });
    return { episode };
  }

  @Post("episodes/:episodeId/unpublish")
  async unpublishEpisode(
    @Req() request: AdminAuthenticatedRequest,
    @Param("episodeId") episodeId: string,
  ) {
    const id = parseId(episodeId);
    const episode = await this.catalog.unpublishEpisode(id);
    await this.record(request, "catalog.episode.unpublish", "SeriesEpisode", id, {
      title: episode.title,
    });
    return { episode };
  }

  private async record(
    request: AdminAuthenticatedRequest,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, string | number | string[]>,
  ) {
    await this.audit.record({
      actorAccountId: request.ayinAuth.accountId,
      action,
      entityType,
      entityId,
      metadata,
    });
  }
}

function parseId(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw invalidBody({ id: ["Invalid catalog id"] });
  return parsed.data;
}

function invalidBody(details: unknown) {
  return new BadRequestException({
    error: {
      code: "INVALID_SERIES_REQUEST",
      message: "Series catalog request is invalid.",
      details,
    },
  });
}
