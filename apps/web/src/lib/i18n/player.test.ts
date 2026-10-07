import { describe, expect, it } from "vitest";

import { formatPlayerTime, translatePlayer } from "./player";
import { playerAr, playerEn } from "./resources/player";

describe("player presentation copy", () => {
  it("provides complete Arabic messages with the same interpolation contract", () => {
    expect(Object.keys(playerAr)).toEqual(Object.keys(playerEn));
    for (const key of Object.keys(playerEn) as Array<keyof typeof playerEn>) {
      expect(playerAr[key].trim()).not.toBe("");
      expect(playerAr[key].match(/\{\w+\}/g)).toEqual(playerEn[key].match(/\{\w+\}/g));
    }
  });

  it("preserves authored titles and track names without recursively translating them", () => {
    const title = "海の記憶 · حكاية {player.play} <final>";
    expect(translatePlayer("ar", "player.nextTitle", { title })).toBe(`التالي: ${title}`);
    expect(translatePlayer("en", "player.nextTitle", { title })).toBe(`Next: ${title}`);
    expect(translatePlayer("en", "player.playVideo")).toBe("Play video");
    expect(translatePlayer("ar", "player.sourceError")).toBe("تعذّر على AYIN تشغيل ملف MP4 هذا.");
  });

  it("formats locale-aware media times without changing their units or digit padding", () => {
    expect(formatPlayerTime(65_999, "en")).toBe("1:05");
    expect(formatPlayerTime(3_605_000, "en")).toBe("1:00:05");
    expect(formatPlayerTime(65_999, "ar")).toBe("١:٠٥");
    expect(formatPlayerTime(3_605_000, "ar")).toBe("١:٠٠:٠٥");
    for (const time of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatPlayerTime(time, "en")).toBe("0:00");
    }
  });
});
