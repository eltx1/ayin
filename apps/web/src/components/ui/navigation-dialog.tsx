"use client";

import { usePathname } from "next/navigation";
import {\n  type KeyboardEvent as ReactKeyboardEvent,\n  type ReactNode,\n  useEffect,\n  useId,\n  useRef,\n  useState,\n} from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import type { NativeRemoteEventDetail } from "@/lib/native-shell-bridge";

import styles from "./navigation-dialog.module.css";

export function NavigationDialog({
  label,
  title,
  trigger,
  triggerClassName,
  children,
}: {
  label: string;
  title: string;
  trigger: ReactNode;
  triggerClassName?: string | undefined;
  children: ReactNode;
}) {
  const { t, direction } = useI18n();
  const pathname = usePathname();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  useEffect(() => {
    const onRemote = (event: CustomEvent<NativeRemoteEventDetail>) => {
      if (!dialog.current?.open || event.detail.key !== "BACK") return;
      // Close the current navigation before the TV runtime handles page back/exit.
      event.preventDefault();
      event.stopImmediatePropagation();
      dialog.current.close();
    };
    window.addEventListener("ayin:native-remote", onRemote, true);
    return () => window.removeEventListener("ayin:native-remote", onRemote, true);
  }, []);

  function close() {
    dialog.current?.close();
  }

  return (
    <>
      <button
        aria-label={label}
        aria-controls={id}
        aria-expanded={opened}
        aria-haspopup="dialog"
        className={triggerClassName}
        data-tv-focusable="true"
        data-tv-focus-id={`${id}-trigger`}
        type="button"
        onClick={() => {
          if (!dialog.current || dialog.current.open) return;
          dialog.current.showModal();
          setOpened(true);
        }}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        id={id}
        dir={direction}
        className={styles.dialog}
        aria-labelledby={`${id}-title`}
        onClose={() => setOpened(false)}
        onCancel={(event) => event.stopPropagation()}
      >
        <TvFocusScope>
          <header className={styles.header}>
            <h2 id={`${id}-title`} dir="auto">
              {title}
            </h2>
            <button
              aria-label={t("navigation.close")}
              data-tv-focusable="true"
              data-tv-focus-id={`${id}-close`}
              type="button"
              onClick={close}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div
            className={styles.content}
            onClick={(event) => {
              if (event.target instanceof Element && event.target.closest("a[href]")) close();
            }}
          >
            {children}
          </div>
        </TvFocusScope>
      </dialog>
    </>
  );
}
