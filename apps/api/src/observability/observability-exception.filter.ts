import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
  Inject,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { ObservabilityService } from "./observability.service.js";

@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const response = http.getResponse();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    this.observability.captureError(exception, {
      source: "http.exception",
      path: request.routeOptions?.url ?? request.url.split("?", 1)[0],
      statusCode,
    });
    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: "Internal server error" };
    this.adapterHost.httpAdapter.reply(response, body, statusCode);
  }
}
