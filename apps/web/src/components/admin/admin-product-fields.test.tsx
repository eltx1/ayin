import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminProductFields } from "./admin-product-fields";
import { AdminRegionalMerchandising } from "./admin-regional-merchandising";
import { arMessages } from "@/lib/i18n/resources/ar";
import { enMessages } from "@/lib/i18n/resources/en";
import type { AdminHomeRow, ProductControls } from "@/lib/admin-product";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useI18n: () => ({
    locale: language.locale,
    t: (key: keyof typeof enMessages, params: Record<string, string> = {}) => {
      const messages = language.locale === "ar" ? arMessages : enMessages;
      return Object.entries(params).reduce(
        (copy, [name, value]) => copy.replace(`{${name}}`, value),
        messages[key],
      );
    },
  }),
}));

const controls: ProductControls = {
  navigation: [],
  hero: { entityType: null, entityId: null },
  taxonomy: [{ key: "stories-original", label: "قصص، ثقافة", enabled: false }],
  announcement: { enabled: true, text: "Hello · مرحبًا", href: "/tv" },
  deviceVisibility: { web: true, mobile: false, tv: true },
};
beforeEach(() => {
  language.locale = "en";
});

describe("product editor form semantics", () => {
  it.each(["en", "ar"])(
    "gives announcement, taxonomy and device controls visible %s labels without losing content",
    (locale) => {
      language.locale = locale;
      const html = renderToStaticMarkup(
        <AdminProductFields controls={controls} onChange={vi.fn()} issue={null} />,
      );
      expect(html).toContain(locale === "ar" ? "نص الإعلان" : "Announcement text");
      expect(html).toContain(
        locale === "ar" ? "رابط الإعلان (اختياري)" : "Announcement link (optional)",
      );
      expect(html).toContain(locale === "ar" ? "اسم التصنيف" : "Category label");
      expect(html).toContain(locale === "ar" ? "التنقل على الهاتف" : "Mobile navigation");
      expect(html).toContain("stories-original");
      expect(html).toContain("قصص، ثقافة");
      expect(html).toContain('dir="auto"');
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('maxLength="240"');
      expect(html).toContain('maxLength="160"');
      expect(html).toContain('maxLength="80"');
      expect(html).toMatch(/<label for="[^"]+-announcement-text">/);
      expect(html).toMatch(/<textarea[^>]+aria-describedby="[^"]+-announcement-text-hint"/);
      expect(html).toContain('type="button"');
      expect(html).not.toContain('type="submit"');
    },
  );

  it("associates a localized validation message with the link field", () => {
    language.locale = "ar";
    const html = renderToStaticMarkup(
      <AdminProductFields controls={controls} onChange={vi.fn()} issue="announcementHref" />,
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(
      /aria-describedby="[^"]+-announcement-link-hint [^"]+-announcement-link-error"/,
    );
    expect(html).toContain("استخدم مسارًا داخليًا");
  });

  it("uses independently named regional forms with a native submit and an explicit code direction", () => {
    const row = { id: "one", key: "stories", title: "قصص اليوم" } as AdminHomeRow;
    const html = renderToStaticMarkup(
      <AdminRegionalMerchandising
        rows={[row]}
        drafts={{ one: "de، jp" }}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        disabled={false}
      />,
    );
    expect(html).toContain("<form");
    expect(html).toContain('aria-labelledby="regional-row-one"');
    expect(html).toContain('for="regional-target-one"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('value="de، jp"');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toContain("<table");
  });
});
