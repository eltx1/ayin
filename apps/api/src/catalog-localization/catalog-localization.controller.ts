import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
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
import { DatabaseService } from "../database/database.service.js";
import {
  CatalogLocalizationService,
  type CatalogEntityType,
  type CatalogLocalizationInput,
} from "./catalog-localization.service.js";

const entityTypeSchema = z.enum(["MOVIE", "SERIES", "SEASON", "EPISODE"]);
const uuidSchema = z.string().uuid();
const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/);

const listSchema = z
  .object({
    entityType: entityTypeSchema,
    entityId: uuidSchema,
  })
  .strict();

const writeSchema = z
  .object({
    title: z.string().max(200).nullable().optional(),
    synopsis: z.string().max(20_000).nullable().optional(),
    shortDescription: z.string().max(500).nullable().optional(),
    posterMediaAssetId: uuidSchema.nullable().optional(),
    backdropMediaAssetId: uuidSchema.nullable().optional(),
  })
  .strict();

@Controller("admin/catalog/localizations")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminCatalogLocalizationController {
  constructor(
    @Inject(CatalogLocalizationService)
    private readonly localization: CatalogLocalizationService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  @Get()
  async list(@Query() query: unknown) {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw invalidRequest(parsed.error.flatten());
    return {
      items: await this.localization.list(parsed.data.entityType, parsed.data.entityId),
    };
  }

  @Put(":entityType/:entityId/:locale")
  async upsert(
    @Req() request: AdminAuthenticatedRequest,
    @Param("entityType") entityTypeRaw: string,
    @Param("entityId") entityIdRaw: string,
    @Param("locale") localeRaw: string,
    @Body() body: unknown,
  ) {
    const route = parseRoute(entityTypeRaw, entityIdRaw, localeRaw);
    const parsed = writeSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest(parsed.error.flatten());
    if (
      (route.entityType === "SEASON" || route.entityType === "EPISODE") &&
      (parsed.data.posterMediaAssetId !== undefined ||
        parsed.data.backdropMediaAssetId !== undefined)
    ) {
      throw invalidRequest({
        artwork: ["Artwork overrides are supported only for Movie and Series localization."],
      });
    }
    if (route.entityType === "SEASON" && parsed.data.synopsis !== undefined) {
      throw invalidRequest({
        synopsis: ["Season localization supports title and short description, not synopsis."],
      });
    }

    const localization = await this.localization.upsert(
      route.entityType,
      route.entityId,
      route.locale,
      toLocalizationInput(parsed.data),
    );
    await this.audit.record({
      actorAccountId: request.ayinAuth.accountId,
      action: "catalog.localization.upsert",
      entityType: route.entityType,
      entityId: route.entityId,
      metadata: {
        locale: route.locale.toLowerCase().replace(/_/g, "-"),
        fields: Object.keys(parsed.data).sort(),
      },
    });
    return { localization };
  }

  @Delete(":entityType/:entityId/:locale")
  async remove(
    @Req() request: AdminAuthenticatedRequest,
    @Param("entityType") entityTypeRaw: string,
    @Param("entityId") entityIdRaw: string,
    @Param("locale") localeRaw: string,
  ) {
    const route = parseRoute(entityTypeRaw, entityIdRaw, localeRaw);
    const result = await this.localization.remove(route.entityType, route.entityId, route.locale);
    await this.audit.record({
      actorAccountId: request.ayinAuth.accountId,
      action: "catalog.localization.remove",
      entityType: route.entityType,
      entityId: route.entityId,
      metadata: { locale: route.locale.toLowerCase().replace(/_/g, "-") },
    });
    return result;
  }
}

@Controller("public/movie-sitemap")
export class PublicMovieSitemapController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list() {
    const items = await this.database.client.movie.findMany({
      where: { status: "PUBLISHED", primaryVideoId: { not: null } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 50_000,
      select: {
        slug: true,
        updatedAt: true,
        localizations: { select: { locale: true } },
      },
    });
    return {
      items: items.map((item) => ({
        slug: item.slug,
        updatedAt: item.updatedAt,
        availableLocales: item.localizations.map((localization) => localization.locale),
      })),
    };
  }
}

function toLocalizationInput(data: z.infer<typeof writeSchema>): CatalogLocalizationInput {
  const input: CatalogLocalizationInput = {};
  if (data.title !== undefined) input.title = data.title;
  if (data.synopsis !== undefined) input.synopsis = data.synopsis;
  if (data.shortDescription !== undefined) input.shortDescription = data.shortDescription;
  if (data.posterMediaAssetId !== undefined) input.posterMediaAssetId = data.posterMediaAssetId;
  if (data.backdropMediaAssetId !== undefined) {
    input.backdropMediaAssetId = data.backdropMediaAssetId;
  }
  return input;
}

function parseRoute(entityTypeRaw: string, entityIdRaw: string, localeRaw: string) {
  const entityType = entityTypeSchema.safeParse(entityTypeRaw.toUpperCase());
  const entityId = uuidSchema.safeParse(entityIdRaw);
  const locale = localeSchema.safeParse(localeRaw);
  if (!entityType.success || !entityId.success || !locale.success) {
    throw invalidRequest({ route: ["Invalid catalog entity, id or locale."] });
  }
  return {
    entityType: entityType.data as CatalogEntityType,
    entityId: entityId.data,
    locale: locale.data,
  };
}

function invalidRequest(details: unknown) {
  return new BadRequestException({
    error: {
      code: "INVALID_CATALOG_LOCALIZATION_REQUEST",
      message: "Catalog localization request is invalid.",
      details,
    },
  });
}
