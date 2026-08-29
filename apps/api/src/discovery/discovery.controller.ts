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
import { DiscoveryError, DiscoveryService, type DiscoveryContext } from "./discovery.service.js";

const listQuerySchema = z
  .object({
    profileId: z.string().uuid().optional(),
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(24).optional(),
  })
  .strict();

@Controller("public/discovery")
export class PublicDiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  @Get("home")
  async home(
    @Headers("x-ayin-region") regionCode?: string,
    @Headers("x-ayin-region-personalization") regionalPermission?: string,
  ) {
    return runDiscovery(() =>
      this.discovery.getHome(regionContext(regionCode, regionalPermission)),
    );
  }

  @Get("rows/:key")
  async row(
    @Param("key") key: string,
    @Query() query: unknown,
    @Headers("x-ayin-region") regionCode?: string,
    @Headers("x-ayin-region-personalization") regionalPermission?: string,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getRow(
        key,
        regionContext(regionCode, regionalPermission),
        parsed.cursor,
        parsed.limit,
      ),
    );
  }
}

@Controller("discovery")
@UseGuards(AuthGuard)
export class DiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly discovery: DiscoveryService) {}

  @Get("home")
  async home(
    @Req() request: AuthenticatedRequest,
    @Query() query: unknown,
    @Headers("x-ayin-region") regionCode?: string,
    @Headers("x-ayin-region-personalization") regionalPermission?: string,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getHome({
        accountId: request.ayinAuth.accountId,
        profileId: parsed.profileId,
        ...regionContext(regionCode, regionalPermission),
      }),
    );
  }

  @Get("rows/:key")
  async row(
    @Req() request: AuthenticatedRequest,
    @Param("key") key: string,
    @Query() query: unknown,
    @Headers("x-ayin-region") regionCode?: string,
    @Headers("x-ayin-region-personalization") regionalPermission?: string,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getRow(
        key,
        {
          accountId: request.ayinAuth.accountId,
          profileId: parsed.profileId,
          ...regionContext(regionCode, regionalPermission),
        },
        parsed.cursor,
        parsed.limit,
      ),
    );
  }

  @Get("my-ayin")
  async myAyin(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getMyAyin(request.ayinAuth.accountId, parsed.profileId),
    );
  }

  @Get("my-ayin/:section")
  async myAyinSection(
    @Req() request: AuthenticatedRequest,
    @Param("section") section: string,
    @Query() query: unknown,
  ) {
    const parsed = parseListQuery(query);
    return runDiscovery(() =>
      this.discovery.getMyAyinSection(
        request.ayinAuth.accountId,
        section,
        parsed.profileId,
        parsed.cursor,
        parsed.limit,
      ),
    );
  }
}

function parseListQuery(query: unknown) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw discoveryHttpError(
      new DiscoveryError("INVALID_DISCOVERY_QUERY", "The discovery request is invalid."),
    );
  }
  return parsed.data;
}

function regionContext(regionCode?: string, regionalPermission?: string): DiscoveryContext {
  return {
    ...(regionCode ? { regionCode } : {}),
    regionPersonalizationAllowed: regionalPermission === "allow",
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
  if (error instanceof DiscoveryError) {
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  return error instanceof Error ? error : new Error("Unexpected discovery error.");
}
