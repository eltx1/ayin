import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicSafetyHelp } from "./public-safety-help";

describe("public deletion and safety resources", () => {
  it.each(["en", "ar"] as const)(
    "offers browser account deletion without an installed app in %s",
    (locale) => {
      const html = renderToStaticMarkup(<PublicSafetyHelp kind="deletion" locale={locale} />);
      const prefix = locale === "ar" ? "/ar" : "";
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
      expect(html).toContain(`href="${prefix}/account#privacy-data-title"`);
      expect(html).toContain(`href="${prefix}/forgot-password"`);
      expect(html).toContain("mailto:mohamed@horusmedia.net?subject=AYIN%20account%20deletion");
      expect(html).toContain("14");
      expect(html).toContain("24");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<input");
      expect(html).toContain(locale === "ar" ? "مالية" : "Financial");
    },
  );
  it.each(["en", "ar"] as const)(
    "keeps safety contact and policy paths accessible in %s",
    (locale) => {
      const html = renderToStaticMarkup(<PublicSafetyHelp kind="support" locale={locale} />);
      const prefix = locale === "ar" ? "/ar" : "";
      for (const path of [
        "/studio/support",
        "/account-deletion",
        "/community-guidelines",
        "/copyright",
        "/privacy",
      ])
        expect(html).toContain(`href="${prefix}${path}"`);
      expect(html).toContain("mailto:mohamed@horusmedia.net?subject=AYIN%20support");
      expect(html).toContain(locale === "ar" ? "لا يضمن" : "does not guarantee");
    },
  );
});
