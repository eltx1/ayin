import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";

export interface WarehouseStatus {
  configured: boolean;
  pageSize: number;
  intervalMs: number;
  datasets: Array<{
    dataset: string;
    schemaVersion: number;
    cursorAt: string | null;
    lastSucceededAt: string | null;
  }>;
}

export async function getWarehouseStatus(signal: AbortSignal): Promise<WarehouseStatus> {
  const response = await fetch(`${apiBaseUrl}/admin/warehouse-status`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readAdminApiError(response));
  return response.json();
}
