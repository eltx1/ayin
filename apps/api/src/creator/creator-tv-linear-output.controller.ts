import { Controller, Get, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { OwnedLinearStreamingProvider } from "./owned-linear-streaming.provider.js";

@Controller("public/linear")
export class PublicCreatorTvLinearOutputController {
  constructor(
    @Inject(OwnedLinearStreamingProvider)
    private readonly provider: OwnedLinearStreamingProvider,
  ) {}

  @Get(":providerResourceId/:fileName")
  async output(
    @Param("providerResourceId") providerResourceId: string,
    @Param("fileName") fileName: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const output = await this.provider.readPublicOutput(providerResourceId, fileName);
    if (!output) throw new NotFoundException();

    reply.header("content-type", output.contentType);
    reply.header("cache-control", output.cacheControl);
    reply.header("x-content-type-options", "nosniff");
    if (output.contentLength !== null) {
      reply.header("content-length", String(output.contentLength));
    }
    return output.body;
  }
}
