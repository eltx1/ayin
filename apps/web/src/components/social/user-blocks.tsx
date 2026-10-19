"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useAccountFreeze, useAccountWorkspace } from "@/components/account/account-workspace";
import { requestAccountScope } from "@/lib/account-scope";
import { ActionButton } from "@/components/ui/design-system";
import styles from "@/app/(viewer)/account/account.module.css";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
interface BlockedUser {
  blockedAccountId: string;
  displayName: string;
  channels: { id: string; name: string; handle: string }[];
  createdAt: string;
}
function parseBlocks(value: unknown): BlockedUser[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 500
  )
    throw new Error("INVALID_BLOCKS");
  return value.items.map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("blockedAccountId" in item) ||
      typeof item.blockedAccountId !== "string" ||
      !uuid.test(item.blockedAccountId) ||
      !("displayName" in item) ||
      typeof item.displayName !== "string" ||
      item.displayName.length > 200
    )
      throw new Error("INVALID_BLOCK");
    return item as BlockedUser;
  });
}
export function BlockUserButton({
  channelId,
  profileId,
}: {
  channelId?: string;
  profileId?: string;
}) {
  const { locale } = useI18n(),
    ar = locale === "ar",
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [blocked, setBlocked] = useState(false);
  const pending = useRef(false);
  async function block() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await requestAccountScope(
        "/user-blocks",
        "POST",
        (value) => {
          if (
            !value ||
            typeof value !== "object" ||
            !("blocked" in value) ||
            value.blocked !== true
          )
            throw new Error("UNCONFIRMED");
          return true;
        },
        {},
        channelId ? { channelId } : { profileId },
      );
      window.dispatchEvent(
        new CustomEvent("ayin:user-blocked", { detail: { channelId, profileId } }),
      );
      setBlocked(true);
      setMessage(
        ar ? "تم الحظر. يمكنك إلغاؤه من الحساب." : "Blocked. Manage blocked users in Account.",
      );
      router.refresh();
    } catch {
      setMessage(
        ar
          ? "تعذر تأكيد الحظر. تحقق من تسجيل الدخول وحاول مجددًا."
          : "Could not confirm the block. Check that you are signed in and try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <span>
      <ActionButton
        type="button"
        tone="quiet"
        disabled={busy || blocked}
        onClick={() => void block()}
      >
        {ar ? "حظر المستخدم" : "Block user"}
      </ActionButton>
      {message && <span role="status">{message}</span>}
    </span>
  );
}
export function AccountBlockedUsers() {
  const binding = useAccountWorkspace(),
    { locale } = useI18n(),
    ar = locale === "ar";
  const [items, setItems] = useState<BlockedUser[] | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false),
    controller = useRef<AbortController | null>(null),
    body = useRef<HTMLDivElement>(null);
  useAccountFreeze(binding, () => {
    if (body.current) body.current.hidden = true;
    controller.current?.abort();
    setItems(null);
    setMessage("");
    setBusy(false);
  });
  useEffect(() => () => controller.current?.abort(), []);
  async function run(blockedId?: string) {
    if (!binding || pending.current) return;
    const active = new AbortController();
    controller.current = active;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const options = {
        expectedAccountId: binding.expectedAccount(),
        signal: active.signal,
        maxResponseBytes: 512 * 1024,
      };
      if (blockedId)
        await requestAccountScope(
          "/user-blocks/" + blockedId,
          "DELETE",
          (value) => {
            if (
              !value ||
              typeof value !== "object" ||
              !("blocked" in value) ||
              value.blocked !== false ||
              !("blockedAccountId" in value) ||
              value.blockedAccountId !== blockedId
            )
              throw new Error("UNCONFIRMED");
            return true;
          },
          options,
        );
      const result = await requestAccountScope("/user-blocks", "GET", parseBlocks, options);
      if (!active.signal.aborted) {
        setItems(result.value);
        if (body.current) body.current.hidden = false;
      }
    } catch {
      if (!active.signal.aborted)
        setMessage(
          ar
            ? "تعذر تأكيد العملية. اقرأ القائمة مجددًا."
            : "Could not confirm the operation. Read the list again.",
        );
    } finally {
      pending.current = false;
      if (!active.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className={styles.securityCard}>
      <h2>{ar ? "المستخدمون المحظورون" : "Blocked users"}</h2>
      <ActionButton disabled={busy} onClick={() => void run()}>
        {ar ? "قراءة القائمة" : "Read blocked users"}
      </ActionButton>
      <div ref={body}>
        {items?.length === 0 && <p>{ar ? "لا يوجد مستخدمون محظورون." : "No blocked users."}</p>}
        {items?.map((item) => (
          <div key={item.blockedAccountId}>
            <span dir="auto">{item.displayName}</span>{" "}
            <ActionButton
              tone="secondary"
              disabled={busy}
              onClick={() => void run(item.blockedAccountId)}
            >
              {ar ? "إلغاء الحظر" : "Unblock"}
            </ActionButton>
          </div>
        ))}
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}

/** Public SSR stays reusable; authenticated relationship checks conceal blocked channels. */
export function ChannelBlockGate({
  channelId,
  children,
}: {
  channelId: string;
  children: import("react").ReactNode;
}) {
  const { locale } = useI18n(),
    ar = locale === "ar";
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void import("@/lib/api")
        .then(async ({ apiBaseUrl }) => {
          const response = await fetch(apiBaseUrl + "/social/channels/" + channelId, {
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (response.status === 403) {
            const result = await response.json();
            if (!controller.signal.aborted && result?.error?.code === "USER_BLOCKED")
              setBlocked(true);
          } else if (response.ok || response.status === 401) setBlocked(false);
        })
        .catch(() => undefined);
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ channelId?: string }>).detail?.channelId === channelId)
        setBlocked(true);
      else refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("ayin:user-blocked", changed);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("ayin:user-blocked", changed);
    };
  }, [channelId]);
  return blocked ? (
    <section role="status" className={styles.securityCard}>
      <h2>{ar ? "المستخدم محظور" : "User blocked"}</h2>
      <p>
        {ar
          ? "يمكنك إدارة المستخدمين المحظورين من حسابك."
          : "Manage blocked users from your Account page."}
      </p>
    </section>
  ) : (
    children
  );
}
