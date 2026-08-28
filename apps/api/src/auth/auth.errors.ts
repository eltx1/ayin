import { HttpException, HttpStatus } from "@nestjs/common";

export class AuthHttpError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ error: { code, message } }, status);
  }
}

export function badRequest(code: string, message: string): AuthHttpError {
  return new AuthHttpError(HttpStatus.BAD_REQUEST, code, message);
}

export function conflict(code: string, message: string): AuthHttpError {
  return new AuthHttpError(HttpStatus.CONFLICT, code, message);
}

export function unauthorized(message = "Authentication is required."): AuthHttpError {
  return new AuthHttpError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
}

export function tooManyRequests(): AuthHttpError {
  return new AuthHttpError(
    HttpStatus.TOO_MANY_REQUESTS,
    "RATE_LIMITED",
    "Too many authentication attempts. Please try again shortly.",
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
