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
import { MovieCatalogService } from "./movie-catalog.service.js";

const uuid = z.string().uuid();
const artworkType = z.enum(["POSTER", "BACKDROP", "LOGO"]);
const availabilityRule = z.enum(["ALLOW", "BLOCK"]);
const statusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const artworkSchema = z
  .object({
    type: artworkType,
    mediaAssetId: uuid,
    altText: z.string().max(240).nullable().optional(),
  })
  .strict();
const availabilitySchema = z
  .object({
    territoryCode: z.string().min(1).max(2),
    rule: availabilityRule,
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    note: z.string().max(240).nullable().optional(),
  })
  .strict();
const localizationSchema = z
  .object({
    locale: z.string().min(2).max(35),
    title: z.string().max(200).nullable().optional(),
    synopsis: z.string().max(20_000).nullable().optional(),
  })
  .strict();
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
const patchSchema = z
  .object({
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
  })
  .strict();
const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().trim().max(120).optional(),
    status: statusSchema.optional(),
  })
  .strict();

@Controller("admin/catalog/movies")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminMovieCatalogController {
  constructor(
    @Inject(MovieCatalogService) private readonly catalog: MovieCatalogService,
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

  @Get(":movieId")
  async detail(@Param("movieId") movieIdRaw: string) {
    return { movie: await this.catalog.getAdminById(parseId(movieIdRaw)) };
  }

  @Post()
  async create(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const movie = await this.catalog.create(parsed.data);
    await this.audit.record({
      actorAccountId: request.ayinAuth.accountId,
      action: "catalog.movie.create",
      entityType: "Movie",
      entityId: movie.id,
      metadata: { title: movie.title, slug: movie.slug },
    });
    return { movie };
  }

  @Patch(":movieId")
  async update(
    @Req() request: AdminAuthenticatedRequest,
    @Param("movieId") movieIdRaw: string,
    @Body() body: unknown,
  ) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw invalidBody(parsed.error.flatten());
    const movieId = parseId(movieIdRaw);
    const movie = await this.catalog.update(movieId, parsed.data);
    await this.audit.record({
      actorAccountId: request.ayinAuth.accountId,
      action: "catalog.movie.update",
      entityType: "Movie",
      entityId: movieId,
      metadata: { fields: Object.keys(parsed.data).sort() },
    });
    return { movie };
  }

  @Post(":movieId/publish")
  async publish(@Req() request: AdminAuthenticatedRequest, @Param("movieId") movieIdRaw: string) {
    return this.lifecycle(request, parseId(movieIdRaw), "publish");
  }

  @Post(":movieId/unpublish")
  async unpublish(
    @Req() request: AdminAuthenticatedRequest,
    @Param("movieId") movieIdRaw: string,
  ) {
    return this.lifecycle(request, parseId(movieIdRaw), "unpublish");
  }

  @Post(":movieId/archive")
  async archive(@Req() request: AdminAuthenticatedRequest, @Param("movieId") movieIdRaw: string) {
    return this.lifecycle(request, parseId(movieIdRaw), "archive");
  }

  private async lifecycle(
    request: AdminAuthenticatedRequest,
    movieId: string,
    action: "publish" | "unpublish" | "archive",
  ) {
    const movie = await this.catalog[action](movieId);
    await this.audit.record({
      actorAccountId: request.ayinAuth.accountId,
      action: `catalog.movie.${action}`,
      entityType: "Movie",
      entityId: movieId,
      metadata: { title: movie.title, status: movie.status },
    });
    return { movie };
  }
}

function parseId(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw invalidBody({ movieId: ["Invalid movie id"] });
  return parsed.data;
}

function invalidBody(details: unknown) {
  return new BadRequestException({
    error: {
      code: "INVALID_MOVIE_REQUEST",
      message: "Movie catalog request is invalid.",
      details,
    },
  });
}
