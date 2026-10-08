"use client";

import { useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton } from "@/components/ui/design-system";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import type { ClipItem } from "@/lib/clips";
import { trapDialogTab } from "@/lib/dialog-focus";
import { translateClips } from "@/lib/i18n/clips";

import styles from "./clips.module.css";

// Like the shared native dialogs, this sheet does not create a history entry.
// Browser Back keeps its ordinary route meaning; Escape/Close dismiss the sheet.
export function ClipDetails({
  capabilityStatus,
  onRetryCapabilities,
  clip,
  onOpenChange,
}: {
  capabilityStatus: "idle" | "loading" | "ready" | "unavailable";
  onRetryCapabilities: () => void;
  clip: ClipItem;
  onOpenChange: (value: boolean) => void;
}) {
  const { locale, direction } = useI18n();
  const { isAudienceCurrent } = useViewerProduct();
  const t = (key: Parameters<typeof translateClips>[1]) => translateClips(locale, key);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton
        className={styles.detailsTrigger}
        tone="quiet"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`clip-details-${clip.id}`}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          if (!isAudienceCurrent() || !dialog.current || dialog.current.open) return;
          onOpenChange(true);
          dialog.current.showModal();
          setOpen(true);
        }}
      >
        {t("clips.details")}
      </ActionButton>
      <dialog
        ref={dialog}
        id={`clip-details-${clip.id}`}
        dir={direction}
        className={styles.sheet}
        aria-labelledby={`clip-details-title-${clip.id}`}
        onKeyDown={trapDialogTab}
        onClose={() => {
          setOpen(false);
          onOpenChange(false);
          trigger.current?.focus({ preventScroll: true });
        }}
        onCancel={(event) => event.stopPropagation()}
      >
        <header className={styles.sheetHeader}>
          <h2 id={`clip-details-title-${clip.id}`}>{t("clips.details")}</h2>
          <ActionButton tone="quiet" type="button" onClick={() => dialog.current?.close()}>
            {t("clips.close")}
          </ActionButton>
        </header>
        {open && (
          <div className={styles.sheetBody}>
            <p className={styles.sheetCreator}>
              <bdi>@{clip.channel.handle}</bdi>
            </p>
            <h3 dir="auto">{clip.title}</h3>
            <p dir="auto">{clip.description || t("clips.noDescription")}</p>
            <p className={styles.sheetHint}>{t("clips.watchCapabilities")}</p>
            {capabilityStatus === "unavailable" && (
              <div role="status">
                <p>{t("clips.optionsUnavailable")}</p>
                <ActionButton tone="secondary" type="button" onClick={onRetryCapabilities}>
                  {t("clips.retry")}
                </ActionButton>
              </div>
            )}
            {capabilityStatus === "loading" && <p role="status">{t("clips.optionsLoading")}</p>}
          </div>
        )}
      </dialog>
    </>
  );
}
