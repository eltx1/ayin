"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { AccountScopeError, requestAccountScope } from "@/lib/account-scope";
import { parseAccountIdentity } from "@/lib/account-identity-response";
import type { AyinIdentity } from "@/lib/api";
import styles from "@/app/(viewer)/account/account.module.css";

type Binding = {
  identity: AyinIdentity;
  expectedAccount: () => string;
  freeze: () => void;
  register: (freeze: () => void) => () => void;
};
const AccountBinding = createContext<Binding | null>(null);
export const useAccountWorkspace = () => useContext(AccountBinding);
export function useAccountFreeze(binding: Binding | null, freeze: () => void) {
  const latest = useRef(freeze);
  useEffect(() => {
    latest.current = freeze;
  });
  useEffect(() => binding?.register(() => latest.current()), [binding]);
}
export function AccountWorkspace({ children }: { children: ReactNode }) {
  const { claimAccountIdentity } = useViewerProduct();
  const chrome = useRef<ReturnType<typeof claimAccountIdentity> | null>(null);
  const { locale, href } = useI18n(),
    ar = locale === "ar";
  const body = useRef<HTMLDivElement>(null),
    actor = useRef<string | null>(null),
    epoch = useRef(0),
    pending = useRef<AbortController | null>(null),
    freezers = useRef(new Set<() => void>());
  const [identity, setIdentity] = useState<AyinIdentity | null>(null),
    [loading, setLoading] = useState(true),
    [generation, setGeneration] = useState(0),
    [closed, setClosed] = useState(false);
  const freeze = useCallback(() => {
    // Conceal the whole account before any native form/secret reset or React update.
    if (body.current) body.current.hidden = true;
    actor.current = null;
    chrome.current?.publish(null);
    epoch.current++;
    pending.current?.abort();
    pending.current = null;
    for (const clear of [...freezers.current]) clear();
    // Controlled inputs can retain their React defaultValue after form.reset().
    // Clear native values as well, including detached nodes retained by browser history.
    body.current
      ?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input, textarea, select",
      )
      .forEach((field) => {
        if (field instanceof HTMLSelectElement) field.selectedIndex = -1;
        else if (field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type))
          field.checked = false;
        else {
          field.value = "";
          field.defaultValue = "";
          if (field instanceof HTMLInputElement) field.removeAttribute("value");
        }
      });
    body.current
      ?.querySelectorAll<HTMLImageElement>("[data-private-account-mfa] img")
      .forEach((image) => {
        image.removeAttribute("src");
        image.removeAttribute("srcset");
      });
    body.current
      ?.querySelectorAll<HTMLElement>(
        "[data-private-account-mfa] code, [data-private-account-mfa] ul li",
      )
      .forEach((secret) => {
        secret.textContent = "";
      });
    setIdentity(null);
    setLoading(false);
    setClosed(true);
  }, []);
  const register = useCallback((clear: () => void) => {
    freezers.current.add(clear);
    return () => {
      freezers.current.delete(clear);
    };
  }, []);
  const expectedAccount = useCallback(() => {
    if (!actor.current) throw new AccountScopeError(409, "ACCOUNT_CHANGED");
    return actor.current;
  }, []);
  const review = useCallback(async () => {
    if (pending.current) return;
    const controller = new AbortController(),
      revision = epoch.current;
    pending.current = controller;
    setLoading(true);
    try {
      const next = await requestAccountScope("/auth/me", "GET", parseAccountIdentity, {
        signal: controller.signal,
        maxResponseBytes: 64 * 1024,
      });
      if (controller.signal.aborted || revision !== epoch.current) return;
      if (next.value.account.id !== next.accountId)
        throw new AccountScopeError(409, "ACCOUNT_CHANGED");
      actor.current = next.accountId;
      chrome.current?.publish(next.value);
      setGeneration((value) => value + 1);
      setIdentity(next.value);
      setClosed(false);
    } catch {
      if (!controller.signal.aborted && revision === epoch.current) freeze();
    } finally {
      if (revision === epoch.current) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, [freeze]);
  const invalidate = useCallback(() => {
    epoch.current++;
    pending.current?.abort();
  }, []);
  useEffect(() => {
    const ownedChrome = claimAccountIdentity();
    chrome.current = ownedChrome;
    let active = true;
    const initial = epoch.current;
    void Promise.resolve().then(() => {
      if (active && initial === epoch.current) void review();
    });
    const visibility = () => {
      if (document.visibilityState === "hidden") freeze();
    };
    window.addEventListener("pagehide", freeze, true);
    document.addEventListener("visibilitychange", visibility, true);
    return () => {
      active = false;
      invalidate();
      ownedChrome.release();
      if (chrome.current === ownedChrome) chrome.current = null;
      window.removeEventListener("pagehide", freeze, true);
      document.removeEventListener("visibilitychange", visibility, true);
    };
  }, [freeze, review, invalidate, claimAccountIdentity]);
  const binding = useMemo(
    () => (identity ? { identity, expectedAccount, freeze, register } : null),
    [identity, expectedAccount, freeze, register],
  );
  return (
    <>
      {loading && (
        <p className={styles.loading}>
          {ar ? "جارٍ التحقق من الحساب الحالي…" : "Verifying the current account…"}
        </p>
      )}
      {closed && (
        <section
          className={styles.accountRecovery}
          aria-label={ar ? "مراجعة الحساب" : "Account review"}
        >
          <p role="alert">
            {ar
              ? "اقرأ الحساب الحالي لإعادة فتح بياناته. تم إخفاء البيانات السابقة ومسح المدخلات الخاصة."
              : "Read the current account to reopen its data. Previous private facts and inputs have been cleared."}
          </p>
          <button
            className={styles.secondaryButton}
            disabled={loading}
            onClick={() => void review()}
          >
            {ar ? "قراءة الحساب الحالي" : "Read current account"}
          </button>
          <Link href={href("/login")}>{ar ? "تسجيل الدخول" : "Sign in"}</Link>
        </section>
      )}
      {identity && (
        <AccountBinding.Provider value={binding}>
          <div key={generation} ref={body} data-private-account-workspace>
            {children}
          </div>
        </AccountBinding.Provider>
      )}
    </>
  );
}
