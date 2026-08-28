export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

export interface AyinIdentity {
  account: { displayName: string; email: string; id: string };
  channel: { handle: string; id: string; name: string };
  creatorTv: { id: string; name: string; slug: string };
  profile: { id: string; name: string; slug: string };
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error?.message ?? "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
  }
}
