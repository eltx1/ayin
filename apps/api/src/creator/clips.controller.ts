import {
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { OptionalAuthGuard } from "../auth/optional-auth.guard.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { ViewerPolicyContextService } from "../video-policy/viewer-policy-context.service.js";
import { ClipsService } from "./clips.service.js";

const querySchema = z
  .object({
    take: z.coerce.number().int().min(1).max(30).default(12),
    cursor: z.string().uuid().optional(),
    expectedProfileId: z.string().uuid().optional(),
  })
  .strict();

@Controller("public/clips")
@UseGuards(OptionalAuthGuard)
export class PublicClipsController {
  constructor(
    @Inject(ClipsService) private readonly clips: ClipsService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
    @Inject(ViewerPolicyContextService) private readonly viewerContext: ViewerPolicyContextService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @Header("Pragma", "no-cache")
  async feed(
    @Req() request: { ayinAuth?: AuthenticatedRequest["ayinAuth"] },
    @Query() query: unknown,
    @Headers() headers: HeaderBag,
  ) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_CLIPS_QUERY", message: "The Clips request is invalid." } },
        400,
      );
    }
    return this.viewerContext.run(
      {
        accountId: request.ayinAuth?.accountId,
        expectedProfileId: parsed.data.expectedProfileId,
        countryCode: this.trustedRegion.countryFromHeaders(headers),
      },
      (policy) =>
        this.clips.feed({ take: parsed.data.take, cursor: parsed.data.cursor, ...policy }),
      () =>
        new HttpException(
          {
            error: {
              code: "CLIPS_VIEWER_CHANGED",
              message: "Your viewer profile changed. Refresh and try again.",
            },
          },
          409,
        ),
    );
  }
}
