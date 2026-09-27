import { readApiError } from "./api";

let requestVerification: (() => void) | undefined;

export function registerAdminVerification(handler: () => void) {
  requestVerification = handler;
  return () => {
    if (requestVerification === handler) requestVerification = undefined;
  };
}

// A rejected operation is never replayed. After verification the administrator
// reviews and explicitly submits the original action again.
export async function readAdminApiError(response: Response): Promise<string> {
  if (response.status === 403) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (body?.error?.code === "STEP_UP_REQUIRED") requestVerification?.();
  }
  return readApiError(response);
}
