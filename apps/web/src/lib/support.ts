import { apiBaseUrl, readApiError } from "./api";

export interface SupportTicket {
  id: string;
  category: string;
  subject: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export class SupportRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SupportRequestError";
    this.status = status;
  }
}

// A lost response or server failure can occur after a write. Never automatically
// retry ticket creation or describe such a result as definitely not submitted.
export function isUncertainSupportFailure(error: unknown): boolean {
  return !(
    error instanceof SupportRequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
  );
}

export function validateSupportDraft(subject: string, description: string) {
  const title = subject.trim().length;
  const details = description.trim().length;
  return { subject: title < 4 || title > 200, description: details < 10 || details > 20_000 };
}

async function supportFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new SupportRequestError(response.status, await readApiError(response));
  return (await response.json()) as T;
}

export async function getMySupportTickets(signal?: AbortSignal) {
  const response = await supportFetch<{ items: SupportTicket[] }>(
    "/support/tickets",
    signal ? { signal } : undefined,
  );
  if (!Array.isArray(response.items)) throw new Error("Invalid support response");
  return response;
}

export function createSupportTicket(input: {
  category: string;
  subject: string;
  description: string;
  priority: SupportTicket["priority"];
}) {
  return supportFetch<SupportTicket>("/support/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
