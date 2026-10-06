import type { TranslationKey } from "./i18n/translator";

// Recovery errors are locale-neutral API outcomes. Never display server text,
// which can contain English-only or account-specific delivery details.
export function recoveryErrorKey(status: number, mode: "forgot" | "reset"): TranslationKey {
  if (status === 429) return "authRecovery.rateLimited";
  if (mode === "reset" && status === 401) return "authRecovery.expiredLink";
  if (status === 400) {
    return mode === "forgot" ? "authRecovery.emailInvalid" : "authRecovery.resetInvalid";
  }
  return "authRecovery.failed";
}
