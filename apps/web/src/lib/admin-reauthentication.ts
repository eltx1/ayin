import { readApiError } from "./api";

let requestVerification: (() => void) | undefined;

export function registerAdminVerification(handler: () => void) {
  requestVerification = handler;
  return () => {
    if (requestVerification === handler) requestVerification = undefined;
  };
}

export async function adminVerificationRequired(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return body?.error?.code === "STEP_UP_REQUIRED";
}

// A rejected operation is never replayed. After verification the administrator
// reviews and explicitly submits the original action again.
export async function readAdminApiError(response: Response): Promise<string> {
  if (await adminVerificationRequired(response)) requestVerification?.();
  return readApiError(response);
}
