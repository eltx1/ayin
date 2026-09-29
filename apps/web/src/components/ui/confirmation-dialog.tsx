"use client";

import { useEffect, useId, useRef } from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import { ownsDialogFocus, trapDialogTab } from "@/lib/dialog-focus";
import type { NativeRemoteEventDetail } from "@/lib/native-shell-bridge";

import { ActionButton } from "./design-system";
import styles from "./confirmation-dialog.module.css";

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  direction: "ltr" | "rtl";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// A decision-only component: it never owns/retries a network mutation. Closing and
// executing are explicit consumer actions; render closed again before asking anew.
export function ConfirmationDialog({ open, ...props }: ConfirmationDialogProps) {
  return open ? <OpenConfirmation {...props} /> : null;
}

function OpenConfirmation({
  title,
  description,
  confirmLabel,
  cancelLabel,
  direction,
  busy = false,
  onConfirm,
  onCancel,
}: Omit<ConfirmationDialogProps, "open">) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const settled = useRef(false);
  const restoreFocus = useRef(true);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    element
      .querySelector<HTMLButtonElement>("[data-dialog-cancel]")
      ?.focus({ preventScroll: true });
    return () => {
      element.close();
      if (
        restoreFocus.current &&
        previous?.isConnected &&
        !previous.matches(":disabled") &&
        previous.getClientRects().length
      )
        previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onRemote = (event: CustomEvent<NativeRemoteEventDetail>) => {
      if (!dialog.current?.open || !ownsDialogFocus(dialog.current) || event.detail.key !== "BACK")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy || settled.current) return;
      settled.current = true;
      onCancel();
    };
    window.addEventListener("ayin:native-remote", onRemote, true);
    return () => window.removeEventListener("ayin:native-remote", onRemote, true);
  }, [busy, onCancel]);

  function decide(confirmed: boolean) {
    if (busy || settled.current) return;
    settled.current = true;
    restoreFocus.current = !confirmed;
    if (confirmed) onConfirm();
    else onCancel();
  }

  return (
    <dialog
      ref={dialog}
      dir={direction}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        decide(false);
      }}
      onKeyDown={trapDialogTab}
    >
      <TvFocusScope>
        <div className={styles.content}>
          <h2 id={`${id}-title`} dir="auto">
            {title}
          </h2>
          <p id={`${id}-description`} dir="auto">
            {description}
          </p>
          <div className={styles.actions}>
            <ActionButton
              data-dialog-cancel
              data-tv-focusable="true"
              data-tv-focus-id={`${id}-cancel`}
              tone="secondary"
              disabled={busy}
              onClick={() => decide(false)}
            >
              {cancelLabel}
            </ActionButton>
            <ActionButton
              data-tv-focusable="true"
              data-tv-focus-id={`${id}-confirm`}
              tone="danger"
              disabled={busy}
              onClick={() => decide(true)}
            >
              {confirmLabel}
            </ActionButton>
          </div>
        </div>
      </TvFocusScope>
    </dialog>
  );
}
