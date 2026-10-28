import { readFileSync } from "node:fs";
import { crc32, inflateSync } from "node:zlib";
import { expect, it } from "vitest";

// Browsers may display only the top of a corrupt PNG without a broken-image icon.
// Check the complete compressed stream, not just the signature or naturalWidth.
it.each(["ayin-logo.png", "ayin-logo-restored.png"])(
  "decodes the complete brand asset %s",
  (name) => {
    const bytes = readFileSync(new URL(`../../public/brand/${name}`, import.meta.url));
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const compressed: Buffer[] = [];
    let offset = 8;
    let header: Buffer | undefined;
    let ended = false;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      expect(end).toBeLessThanOrEqual(bytes.length);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const chunk = bytes.subarray(offset + 8, end - 4);
      expect(crc32(bytes.subarray(offset + 4, end - 4))).toBe(bytes.readUInt32BE(end - 4));
      if (type === "IHDR") header = chunk;
      if (type === "IDAT") compressed.push(chunk);
      if (type === "IEND") {
        ended = true;
        expect(end).toBe(bytes.length);
      }
      offset = end;
    }
    expect(ended).toBe(true);
    expect(header).toBeDefined();
    const width = header!.readUInt32BE(0);
    const height = header!.readUInt32BE(4);
    expect([...header!.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    const pixels = inflateSync(Buffer.concat(compressed));
    expect(pixels.length).toBe(height * (1 + width * 4));
  },
);
