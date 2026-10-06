import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MerchandisingTargetPicker } from "./merchandising-target-picker";
import type { DirectAdminSession } from "@/lib/admin-session-scope";
const { language } = vi.hoisted(() => ({ language: { locale: "en" } }));
vi.mock("@/components/i18n/i18n-provider", () => ({ useI18n: () => language }));
const actor: DirectAdminSession = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  authVersion: 1,
  roles: ["OPERATIONS"],
};
const entityId = "33333333-3333-4333-8333-333333333333";
afterEach(() => {
  language.locale = "en";
});
const render = (known = true) =>
  renderToStaticMarkup(
    <MerchandisingTargetPicker
      label="Reviewed selections"
      value={[{ entityType: "VIDEO", entityId }]}
      targets={
        known
          ? {
              [`VIDEO:${entityId}`]: {
                entityType: "VIDEO",
                entityId,
                label: "Exact authored title · عنوان أصلي",
                detail: "@actual · story · PRIVATE",
              },
            }
          : {}
      }
      actor={actor}
      disabled={false}
      isCurrent={() => true}
      onDenied={vi.fn()}
      onChange={vi.fn()}
    />,
  );
describe("merchandising selector accessible persisted identities", () => {
  it("shows an exact selected target independently of a result page and never exposes its opaque ID", () => {
    const html = render();
    expect(html).toContain("Exact authored title · عنوان أصلي");
    expect(html).toContain("@actual · story · PRIVATE");
    expect(html).not.toContain(entityId);
    expect(html).not.toContain("TYPE:UUID");
    expect(html).toContain('type="search"');
    expect(html).toContain("Search content");
    expect(html).toContain('aria-label="Remove Exact authored title · عنوان أصلي"');
  });
  it("retains an unavailable saved target without substituting a search label or showing its ID", () => {
    const html = render(false);
    expect(html).toContain("Unavailable selection");
    expect(html).toContain("This saved choice is retained until you replace or remove it.");
    expect(html).not.toContain(entityId);
  });
  it("provides Arabic field, action and recovery labels while preserving authored text", () => {
    language.locale = "ar";
    const html = render();
    for (const text of [
      "نوع المحتوى",
      "البحث عن المحتوى",
      "بحث عن محتوى",
      "الاختيار الحالي",
      "إزالة",
      "Exact authored title · عنوان أصلي",
    ])
      expect(html).toContain(text);
    expect(render(false)).toContain("اختيار غير متاح");
  });
});
