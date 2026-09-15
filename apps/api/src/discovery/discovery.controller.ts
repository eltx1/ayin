import {
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { DiscoveryError, DiscoveryService, type DiscoveryContext } from "./discovery.service.js";
import { RegionalDiscoveryService } from "./regional-discovery.service.js";

const listQuerySchema = z
  .object({
    profileId: z.string().uuid().optional(),
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(24).optional(),
  })
  .strict();

@Controller("public/discovery")
export class PublicDiscoveryController {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(RegionalDiscoveryService) private readonly regionalDiscovery: RegionalDiscoveryService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get("home")
  async home(
    @Headers("x-ayin-region-personalization") regionalPermission: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const allowed = regionalPermissionAllowed(regionalPermission);
    return runDiscovery(async () => {
      const home = await this.discovery.getHome({
        ...regionContext(countryCode, regionalPermission),
        availabilityCountryCode: countryCode,
      });
      return {
        ...home,
        rows: await this.regionalDiscovery.rankAndTargetRows(countryCode, allowed, home.rows),
      };
    });
  }

  @Get("kids")
  async kids(@Headers() headers: HeaderBag) {
    return runDiscovery(async () => {
      const home = await this.discovery.getKidsHome({
        availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers),
      });
      return {
        ...home,
        rows: await this.regionalDiscovery.rankAndTargetRows(undefined, false, home.rows),
      };
    });
  }

  @Get("kids/rows/:key")
  async kidsRow(@Param("key") key: string, @Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = parseListQuery(query);
    return runDiscovery(async () => {
      if (!(await this.regionalDiscovery.isMerchandisingRowAllowed(key, undefined, false))) {
        throw new DiscoveryError("ROW_NOT_FOUND", "This AYIN discovery row is not available.", 404);
      }
      return this.discovery.getKidsRow(
        key,
        { availabilityCountryCode: this.trustedRegion.countryFromHeaders(headers) },
        parsed.cursor,
        parsed.limit,
      );
    });
  }

  @Get("rows/:key")
  async row(
    @Param("key") key: string,
    @Query() query: unknown,
    @Headers("x-ayin-region-personalization") regionalPermission: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = parseListQuery(query);
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const allowed = regionalPermissionAllowed(regionalPermission);
    return runDiscovery(async () => {
      if (!(await this.regionalDiscovery.isMerchandisingRowAllowed(key, countryCode, allowed))) {
        throw new DiscoveryError("ROW_NOT_FOUND", "This AYIN discovery row is not available.", 404);
      }
      const page = await this.discovery.getRow(
        key,
        {
          ...regionContext(countryCode, regionalPermission),
          availabilityCountryCode: countryCode,
        },
        parsed.cursor,
        parsed.limit,
      );
      return this.regionalDiscovery.rankPage(countryCode, allowed, page.source, page);
    });
  }
}

@Controller("discovery")
@UseGuards(AuthGuard)
export class DiscoveryController {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(RegionalDiscoveryService) private readonly regionalDiscovery: RegionalDiscoveryService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get("home")
  async home(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
    @Headers("x-ayin-region-personalization") regionalPermission: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = parseListQuery(query);
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const allowed = regionalPermissionAllowed(regionalPermission);
    return runDiscovery(async () => {
      const home = await this.discovery.getHome({
        accountId: request.ayinAuth.accountId,
        profileId: parsed.profileId,
        ...regionContext(countryCode, regionalPermission),
        availabilityCountryCode: countryCode,
      });
      return {
        ...home,
        rows: await this.regionalDiscovery.rankAndTargetRows(countryCode, allowed, home.rows),
      };
    });
  }

  @Get("rows/:key")
  async row(
    @Req() request: AuthenticatedRequest,
    @Param("key") key: string,
    @Query() query: unknown,
    @Headers("x-ayin-region-personalization") regionalPermission: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = parseListQuery(query);
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const allowed = regionalPermissionAllowed(regionalPermission);
    return runDiscovery(async () => {
      if (!(await this.regionalDiscovery.isMerchandisingRowAllowed(key, countryCode, allowed))) {
        throw new DiscoveryError("ROW_NOT_FOUND", "This AYIN discovery row is not available.", 404);
      }
      const page = await this.discovery.getRow(
        key,
        {
          accountId: request.ayinAuth.accountId,
          profileId: parsed.profileId,
          ...regionContext(countryCode, regionalPermission),
          availabilityCountryCode: countryCode,
        },
        parsed.cursor,
        parsed.limit,
      );
      return this.regionalDiscovery.rankPage(countryCode, allowed, page.source, page);
    });
  }

  @Get("my-ayin")
  async myAyin(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getMyAyin(
        request.ayinAuth.accountId,
        parsed.profileId,
        this.trustedRegion.countryFromHeaders(headers),
      ),
    );
  }

  @Get("my-ayin/:section")
  async myAyinSection(
    @Req() request: AuthenticatedRequest,
    @Param("section") section: string,
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getMyAyinSection(
        request.ayinAuth.accountId,
        section,
        parsed.profileId,
        parsed.cursor,
        parsed.limit,
        this.trustedRegion.countryFromHeaders(headers),
      ),
    );
  }
}

function parseListQuery(query: unknown) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success)
    throw discoveryHttpError(
      new DiscoveryError("INVALID_DISCOVERY_QUERY", "The discovery request is invalid."),
    );
  return parsed.data;
}

function regionalPermissionAllowed(regionalPermission?: string): boolean {
  return regionalPermission?.toLowerCase() === "allow";
}

function regionContext(regionCode?: string, regionalPermission?: string): DiscoveryContext {
  return {
    ...(regionCode ? { regionCode } : {}),
    regionPersonalizationAllowed: regionalPermissionAllowed(regionalPermission),
  };
}

async function runDiscovery<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw discoveryHttpError(error);
  }
}

function discoveryHttpError(error: unknown): Error {
  if (error instanceof DiscoveryError)
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  return error instanceof Error ? error : new Error("Unexpected discovery error.");
}
