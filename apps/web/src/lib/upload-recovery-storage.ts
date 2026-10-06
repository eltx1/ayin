import {
  parseSavedRecovery,
  type RecoveryScope,
  type SavedRecovery,
} from "./upload-recovery-contract";
export const RECOVERY_STORAGE_KEY = "ayin.upload-recovery.v1";
export function clearSavedRecovery(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(RECOVERY_STORAGE_KEY);
}
export function loadSavedRecovery(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: RecoveryScope,
): SavedRecovery | null {
  const raw = storage.getItem(RECOVERY_STORAGE_KEY);
  if (raw === null) return null;
  try {
    if (raw.length > 8192) throw Error("Oversized saved upload");
    return parseSavedRecovery(JSON.parse(raw), scope);
  } catch {
    clearSavedRecovery(storage);
    return null;
  }
}
export function saveRecovery(storage: Pick<Storage, "setItem" | "getItem">, saved: SavedRecovery) {
  const raw = JSON.stringify(parseSavedRecovery(saved, saved.scope));
  if (raw.length > 8192) throw Error("Oversized saved upload");
  storage.setItem(RECOVERY_STORAGE_KEY, raw);
  if (storage.getItem(RECOVERY_STORAGE_KEY) !== raw)
    throw Error("The saved upload could not be retained on this device.");
}
