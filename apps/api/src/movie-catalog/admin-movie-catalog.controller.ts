import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { MovieCatalogService } from "./movie-catalog.service.js";

const uuid = z.string().uuid();
const artworkType = z.enum(["POSTER", "BACKDROP", "LOGO"]);
const availabilityRule = z.enum(["ALLOW", "BLOCK"]);
const artworkSchema = z.object({ type: artworkType, mediaAssetId: uuid, altText: z.string().max(240).nullable().optional() }).strict();
const availabilitySchema = z.object({
  territoryCode: z.string().min(1).max(2),
  rule: availabilityRule,
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  note: z.string().max(240).nullable().optional(),
}).strict();
const localizationSchema = z.object({
  locale: z.string().min(2).max(35),
  title: z.string().max(200).nullable().optional(),
  synopsis: z.string().max(20_000).nullable().optional(),
}).strict();
const movieFields = {
  title: z.string().min(1).max(200),
  slug: z.string().max(160).optional(),
  synopsis: z.string().min(1).max(20_000),
  releaseDate: z.coerce.date().nullable().optional(),
  releaseYear: z.number().int().min(1888).max(2200),
  runtimeMinutes: z.number().int().min(1).max(1440),
  maturityRating: z.string().min(1).max(32),
  originalLanguage: z.string().min(1).max(16),
  primaryVideoId: uuid.nullable().optional(),
  trailerVideoId: uuid.nullable().optional(),
  genres: z.array(z.string().min(1).max(80)).max(20),
  artwork: z.array(artworkSchema).max(3),
  availability: z.array(availabilitySchema).max(100),
  localizations: z.array(localizationSchema).max(50).optional(),
};
const createSchema = z.object(movieFields).strict();
const patchSchema = z.object({
  title: movieFields.title.optional(),
  slug: movieFields.slug,
  synopsis: movieFields.synopsis.optional(),
  releaseDate: movieFields.releaseDate,
  releaseYear: movieFields.releaseYear.optional(),
  runtimeMinutes: movieFields.runtimeMinutes.optional(),
  maturityRating: movieFields.maturityRating.optional(),
  originalLanguage: movieFields.originalLanguage.optional(),
  primaryVideoId: movieFields.primaryVideoId,
  trailerVideoId: movieFields.trailerVideoId,
  genres: movieFields.genres.optional(),
  artwork: movieFields.artwork.optional(),
  availability: movieFields.availability.optional(),
  localizations: movieFields.localizations,
}).strict();

@Controller("admin/catalog/movies")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminMovieCatalogController {
  constructor(@Inject(MovieCatalogService) private readonly catalog: MovieCatalogService) {}

  @Get()
  async list(@Query("limit") limitRaw?: string) {
    const parsed = z.coerce.number().int().min(1).max(100).safeParse(limitRaw ?? 50);
    return { items: await this.catalog.listAdmin(parsed.success ? parsed.data : 50) };
  }

  @Get(":movieId")
  async detail(@Param("movieId") movieIdRaw: string) {
    return { movie: await this.catalog.getAdminById(parseId(movieIdRaw)) };
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { movie: await this.catalog.create(parsed.data) };
  }

  @Patch(":movieId")
  async update(@Param("movieId") movieIdRaw: string, @Body() body: unknown) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    return { movie: await this.catalog.update(parseId(movieIdRaw), parsed.data) };
  }

  @Post(":movieId/publish")
  async publish(@Param("movieId") movieIdRaw: string) {
    return { movie: await this.catalog.publish(parseId(movieIdRaw)) };
  }

  @Post(":movieId/unpublish")
  async unpublish(@Param("movieId") movieIdRaw: string) {
    return { movie: await this.catalog.unpublish(parseId(movieIdRaw)) };
  }

  @Post(":movieId/archive")
  async archive(@Param("movieId") movieIdRaw: string) {
    return { movie: await this.catalog.archive(parseId(movieIdRaw)) };
  }
}

function parseId(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw invalidBody({ movieId: ["Invalid movie id"] });
  return parsed.data;
}

function invalidBody(details: unknown) {
  const error = new Error("Invalid movie catalog request.") as Error & { status?: number; response?: unknown };
  error.status = 400;
  error.response = { error: { code: "INVALID_MOVIE_REQUEST", message: "Movie catalog request is invalid.", details } };
  return error;
}
