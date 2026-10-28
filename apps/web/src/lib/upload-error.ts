export class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

export async function readUploadRequestError(response: Response): Promise<UploadRequestError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: unknown; message?: unknown };
  } | null;
  return new UploadRequestError(
    typeof body?.error?.message === "string" && body.error.message.trim()
      ? body.error.message
      : "The upload request could not be completed.",
    response.status,
    typeof body?.error?.code === "string" ? body.error.code : null,
  );
}

export function isRejectedUploadRequest(error: unknown): error is UploadRequestError {
  return (
    error instanceof UploadRequestError &&
    [400, 401, 403, 404, 409, 413, 415, 422, 429].includes(error.status)
  );
}

export function uploadErrorMessage(error: unknown): string | null {
  if (!(error instanceof UploadRequestError)) return null;
  if (error.code === "INVALID_UPLOAD_SESSION" || error.code === "UPLOAD_SESSION_EXPIRED")
    return "This upload session expired. Review the saved draft in Studio before starting again.";
  if (error.code === "STEP_UP_REQUIRED")
    return "Your administrator session needs verification. Open Studio to verify and review this draft.";
  if (error.code === "UPLOAD_ACCOUNT_CHANGED")
    return "Sign in to the account that started this upload, then retry from this page.";
  if (error.status === 401)
    return "Your session ended. Keep this page open, sign in in a new tab, then return here to retry.";
  if (error.status === 403) return "You no longer have permission to upload to this channel.";
  if (error.code === "R2_NOT_CONFIGURED")
    return "Video uploads are temporarily unavailable. Please try again later.";
  if (error.code === "CHANNEL_UPLOAD_QUOTA_REACHED")
    return "Your channel does not have enough storage for this video. Review saved videos in Studio.";
  if (error.code === "VIDEO_TOO_LARGE")
    return "This file is larger than the upload limit shown below. Choose a smaller file.";
  if (error.code === "UNSUPPORTED_VIDEO_TYPE") return "Choose a supported video";
  if (error.status === 429) return "Too many upload requests. Wait a moment before trying again.";
  return error.status < 500 ? error.message : null;
}
