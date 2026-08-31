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

async function supportFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getMySupportTickets() {
  return supportFetch<{ items: SupportTicket[] }>("/support/tickets");
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
