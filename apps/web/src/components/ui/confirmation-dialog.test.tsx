import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { dialogWrapIndex } from "@/lib/dialog-focus";
import { contentEditorAr, contentEditorEn } from "@/lib/i18n/resources/content-editor";
import { ConfirmationDialog, type ConfirmationDialogProps } from "./confirmation-dialog";

const props: ConfirmationDialogProps = {
  open: true,
  title: "Remove video?",
  description: "Viewers will no longer be able to watch it.",
  cancelLabel: "Cancel",
  confirmLabel: "Remove video",
  direction: "ltr",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("native confirmation contract", () => {
  it("closed confirmations render nothing and never execute an action", () => {
    expect(renderToStaticMarkup(<ConfirmationDialog {...props} open={false} />)).toBe("");
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
  it("labels one native modal, puts cancellation first and keeps buttons non-submitting", () => {
    const html = renderToStaticMarkup(<ConfirmationDialog {...props} />);
    expect(html).toContain("<dialog");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("aria-describedby=");
    expect(html).not.toContain("<main");
    expect(html).not.toContain("<h1");
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html.indexOf("data-dialog-cancel")).toBeLessThan(html.indexOf('data-tone="danger"'));
    expect(html).not.toContain("<form");
    expect(html).not.toContain(" open=");
  });
  it("renders actual text safely, supports RTL and native pending disables both actions", () => {
    const html = renderToStaticMarkup(
      <ConfirmationDialog
        {...props}
        direction="rtl"
        busy
        title={"<script>not executable</script>"}
      />,
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
  it("keeps ordinary Tab navigation and wraps only modal boundaries", () => {
    expect(dialogWrapIndex(-1, 2, false)).toBe(0);
    expect(dialogWrapIndex(-1, 2, true)).toBe(1);
    expect(dialogWrapIndex(0, 2, true)).toBe(1);
    expect(dialogWrapIndex(1, 2, false)).toBe(0);
    expect(dialogWrapIndex(0, 2, false)).toBeNull();
    expect(dialogWrapIndex(1, 2, true)).toBeNull();
    expect(dialogWrapIndex(0, 1, false)).toBe(0);
    expect(dialogWrapIndex(-1, 0, false)).toBeNull();
  });
  it("ships complete route-local decision copy in both languages", () => {
    expect(Object.keys(contentEditorAr).sort()).toEqual(Object.keys(contentEditorEn).sort());
    expect(contentEditorAr["content.keepEditing"]).toBe("إلغاء");
    expect(contentEditorEn["content.leaveConfirm"]).toBe("Discard changes and leave");
  });
});
