import { Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";

import { ClipsService } from "./clips.service.js";

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(30).default(12),
  cursor: z.string().uuid().optional(),
});

@Controller("public/clips")
export class PublicClipsController {
  constructor(@Inject(ClipsService) private readonly clips: ClipsService) {}

  @Get()
  feed(@Query() query: unknown) {
    const parsed = querySchema.parse(query);
    return this.clips.feed(parsed);
  }
}
