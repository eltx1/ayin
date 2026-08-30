import { Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";

import { ClipsService } from "./clips.service.js";

const querySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

@Controller("public/clips")
export class ClipsController {
  constructor(@Inject(ClipsService) private readonly clips: ClipsService) {}

  @Get()
  feed(@Query() query: unknown) {
    const parsed = querySchema.parse(query);
    return this.clips.feed(parsed.cursor, parsed.limit);
  }
}
