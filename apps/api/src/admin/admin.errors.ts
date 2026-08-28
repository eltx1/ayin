import { HttpException, HttpStatus } from "@nestjs/common";

export function adminForbidden(message = "Administrator access is required."): HttpException {
  return new HttpException({ error: { code: "ADMIN_FORBIDDEN", message } }, HttpStatus.FORBIDDEN);
}

export function adminBadRequest(code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, HttpStatus.BAD_REQUEST);
}
