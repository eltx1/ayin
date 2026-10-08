/** Shared transport error without service dependencies or decorator side effects. */
export class MediaUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "MediaUploadError";
  }
}
