import { Injectable, type LoggerService } from "@nestjs/common";

import { currentRequestTrace } from "./observability-context.js";
import { redactValue } from "./observability-core.js";

export function releaseSha(): string {
  const candidate = process.env.AYIN_RELEASE_SHA?.trim();
  return candidate && /^[0-9a-f]{40}$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

@Injectable()
export class StructuredLoggerService implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("info", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    if (process.env.LOG_LEVEL === "debug") this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    if (process.env.LOG_LEVEL === "debug") this.write("debug", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  event(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
    this.writeRecord(level, event, fields);
  }

  private write(level: string, message: unknown, optionalParams: unknown[]): void {
    const context =
      optionalParams.length > 0 && typeof optionalParams.at(-1) === "string"
        ? String(optionalParams.at(-1))
        : undefined;
    this.writeRecord(level, "server.log", {
      message,
      ...(context ? { context } : {}),
    });
  }

  private writeRecord(level: string, event: string, fields: Record<string, unknown>): void {
    const trace = currentRequestTrace();
    const record = redactValue({
      timestamp: new Date().toISOString(),
      level,
      service: process.env.AYIN_SERVICE_NAME ?? "ayin-api",
      releaseSha: releaseSha(),
      event,
      ...(trace ?? {}),
      ...fields,
    });
    const line = `${JSON.stringify(record)}\n`;
    if (level === "error" || level === "fatal") process.stderr.write(line);
    else process.stdout.write(line);
  }
}
