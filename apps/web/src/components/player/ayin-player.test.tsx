import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { Locale } from "@/lib/i18n/config";

import { AyinPlayer } from "./ayin-player";

function render(locale: Locale, adActive = false) {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <AyinPlayer
        videoId="localized-player"
        sourceUrl="/media/fixture.mp4"
        title="海の記憶 · حكاية"
        durationMs={125_000}
        captions={[
          { id: "ar", language: "ar", label: "العربية الأصلية", kind: "CAPTIONS", src: "/ar.vtt" },
          { id: "ja", language: "ja", label: "日本語", kind: "SUBTITLES", src: "/ja.vtt" },
        ]}
        chapters={[{ id: "opening", title: "البداية · Opening", startMs: 0 }]}
        upNext={{ title: "الحلقة التالية · 次回", detail: "S01 E02" }}
        onNext={() => undefined}
        progressEnabled={false}
        adMode={{ active: adActive }}
      />
    </I18nProvider>,
  );
}

describe("localized player markup", () => {
  it("keeps the English controls and keyboard hints available", () => {
    const html = render("en");
    expect(html).toContain('aria-label="Play video"');
    expect(html).toContain('aria-label="Playback controls"');
    expect(html).toContain('aria-label="Next: الحلقة التالية · 次回"');
    expect(html).toContain('title="Back 10 seconds (J)"');
    expect(html).toContain('title="Fullscreen (F)"');
    expect(html).toContain('aria-valuetext="0:00 of 2:05"');
  });

  it("localizes accessible labels and UI copy while preserving source values and authored text", () => {
    const html = render("ar");
    expect(html).toContain('aria-label="مشغّل 海の記憶 · حكاية" dir="rtl"');
    expect(html).toContain('aria-label="تشغيل الفيديو"');
    expect(html).toContain('aria-label="عناصر التحكم في التشغيل"');
    expect(html).toContain('aria-label="التسميات التوضيحية والترجمة"');
    expect(html).toContain('title="الرجوع ١٠ ثوانٍ (J)"');
    expect(html).toContain('title="ملء الشاشة (F)"');
    expect(html).toContain('aria-valuetext="٠:٠٠ من ٢:٠٥"');
    expect(html).toContain('<option value="" selected="">إيقاف</option>');
    expect(html).toContain('<option value="1.25">١٫٢٥×</option>');
    expect(html).toContain('<option dir="auto" value="ja">日本語</option>');
    expect(html).toContain('<strong dir="auto">海の記憶 · حكاية</strong>');
    expect(html).toContain('<strong dir="auto">الحلقة التالية · 次回</strong>');
    expect(html).toContain('src="/media/fixture.mp4"');
    expect(html).toContain('max="125000" min="0" type="range" value="0"');
    expect(html).not.toContain('aria-label="Play video"');
    expect(html).not.toContain('aria-label="Playback controls"');
  });

  it("localizes the default ad badge while retaining locked playback controls", () => {
    const html = render("ar", true);
    expect(html).toContain("<span>إعلان</span>");
    expect(html).toContain('data-tv-focus-id="player-play-localized-player" disabled=""');
    expect(html).toContain('data-tv-focus-id="player-seek-localized-player" disabled=""');
    expect(html).not.toContain('aria-label="تشغيل الفيديو"');
  });
});
