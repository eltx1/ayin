import { Controller, Get, Header, Headers, Inject, Query } from "@nestjs/common";
import { z } from "zod";

import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { ClipsService } from "./clips.service.js";

const querySchema = z
  .object({
    take: z.coerce.number().int().min(1).max(30).default(12),
    cursor: z.string().uuid().optional(),
  })
  .strict();

@Controller("public/clips")
export class PublicClipsController {
  constructor(
    @Inject(ClipsService) private readonly clips: ClipsService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  feed(@Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = querySchema.parse(query);
    return this.clips.feed({
      ...parsed,
      countryCode: this.trustedRegion.countryFromHeaders(headers),
    });
  }
}
