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
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { SeriesCatalogService } from "./series-catalog.service.js";

const uuid = z.string().uuid();
const artworkSchema = z
  .object({
    type: z.enum(["POSTER", "BACKDROP", "LOGO"]),
    mediaAssetId: uuid,
    altText: z.string().max(240).nullable().optional(),
  })
  .strict();
const seriesFields = {
  title: z.string().min(1).max(200),
  slug: z.string().max(160).optional(),
  synopsis: z.string().min(1).max(20_000),
  releaseYear: z.number().int().min(1888).max(2200).nullable().optional(),
  maturityRating: z.string().min(1).max(32),
  originalLanguage: z.string().min(1).max(16),
  genres: z.array(z.string().min(1).max(80)).max(20),
  artwork: z.array(artworkSchema).max(3),
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
    genres: seriesFields.genres.optional(),
    artwork: seriesFields.artwork.optional(),
  })
  .strict();
const createSeasonSchema = z
  .object({
    seasonNumber: z.number().int().min(0).max(10_000),
    title: z.string().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    artwork: z.array(artworkSchema).max(3).optional(),
  })
  .strict();
const patchSeasonSchema = z
  .object({
    seasonNumber: z.number().int().min(0).max(10_000).optional(),
    title: z.string().max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    artwork: z.array(artworkSchema).max(3).optional(),
  })
  .strict();
const episodeFields = {
  episodeNumber: z.number().int().min(0).max(100_000),
  title: z.string().min(1).max(200),
  synopsis: z.string().min(1).max(20_000),
  sortOrder: z.number().int().min(0).optional(),
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
const reorderSchema = z.object({ orderedIds: z.array(uuid).max(1_000) }).strict();

@Controller("admin/catalog/series")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminSeriesCatalogController {
  constructor(@Inject(SeriesCatalogService) private readonly catalog: SeriesCatalogService) {}

  @Get()
  async list(@Query("limit") limitRaw?: string) {
    const parsed = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .safeParse(limitRaw ?? 50);
    return { items: await this.catalog.listAdmin(parsed.success ? parsed.data : 50) };
  }

  @Get(":seriesId")
  async detail(@Param("seriesId") seriesId: string) {
    return { series: await this.catalog.getAdminById(parseId(seriesId)) };
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = createSeriesSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { series: await this.catalog.createSeries(parsed.data) };
  }

  @Patch(":seriesId")
  async update(@Param("seriesId") seriesId: string, @Body() body: unknown) {
    const parsed = patchSeriesSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { series: await this.catalog.updateSeries(parseId(seriesId), parsed.data) };
  }

  @Post(":seriesId/publish")
  async publish(@Param("seriesId") seriesId: string) {
    return { series: await this.catalog.publishSeries(parseId(seriesId)) };
  }

  @Post(":seriesId/unpublish")
  async unpublish(@Param("seriesId") seriesId: string) {
    return { series: await this.catalog.unpublishSeries(parseId(seriesId)) };
  }

  @Post(":seriesId/archive")
  async archive(@Param("seriesId") seriesId: string) {
    return { series: await this.catalog.archiveSeries(parseId(seriesId)) };
  }

  @Post(":seriesId/seasons")
  async createSeason(@Param("seriesId") seriesId: string, @Body() body: unknown) {
    const parsed = createSeasonSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { season: await this.catalog.createSeason(parseId(seriesId), parsed.data) };
  }

  @Post(":seriesId/seasons/reorder")
  async reorderSeasons(@Param("seriesId") seriesId: string, @Body() body: unknown) {
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { series: await this.catalog.reorderSeasons(parseId(seriesId), parsed.data.orderedIds) };
  }

  @Patch("seasons/:seasonId")
  async updateSeason(@Param("seasonId") seasonId: string, @Body() body: unknown) {
    const parsed = patchSeasonSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { season: await this.catalog.updateSeason(parseId(seasonId), parsed.data) };
  }

  @Post("seasons/:seasonId/episodes")
  async createEpisode(@Param("seasonId") seasonId: string, @Body() body: unknown) {
    const parsed = createEpisodeSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { episode: await this.catalog.createEpisode(parseId(seasonId), parsed.data) };
  }

  @Post("seasons/:seasonId/episodes/reorder")
  async reorderEpisodes(@Param("seasonId") seasonId: string, @Body() body: unknown) {
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return {
      season: await this.catalog.reorderEpisodes(parseId(seasonId), parsed.data.orderedIds),
    };
  }

  @Patch("episodes/:episodeId")
  async updateEpisode(@Param("episodeId") episodeId: string, @Body() body: unknown) {
    const parsed = patchEpisodeSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { episode: await this.catalog.updateEpisode(parseId(episodeId), parsed.data) };
  }

  @Post("episodes/:episodeId/publish")
  async publishEpisode(@Param("episodeId") episodeId: string) {
    return { episode: await this.catalog.publishEpisode(parseId(episodeId)) };
  }

  @Post("episodes/:episodeId/unpublish")
  async unpublishEpisode(@Param("episodeId") episodeId: string) {
    return { episode: await this.catalog.unpublishEpisode(parseId(episodeId)) };
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
