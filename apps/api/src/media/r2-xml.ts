// Small, bounded parser for the XML response subset used by R2. No DTDs,
// external entities, processing instructions or mixed-content scalars are accepted.
export class R2XmlError extends Error {
  constructor(readonly limitExceeded = false) {
    super("R2 returned an invalid or oversized XML observation.");
    this.name = "R2XmlError";
  }
}

export interface R2XmlNode {
  name: string;
  text: string;
  children: R2XmlNode[];
}

function xmlCharacter(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function decodeXml(value: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value)) throw new R2XmlError();
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_match, entity: string) => {
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (known[entity] !== undefined) return known[entity];
    const code = entity.startsWith("#x")
      ? Number.parseInt(entity.slice(2), 16)
      : Number(entity.slice(1));
    if (!xmlCharacter(code)) throw new R2XmlError();
    return String.fromCodePoint(code);
  });
}

export function parseR2Xml(input: string): R2XmlNode {
  for (const character of input)
    if (!xmlCharacter(character.codePointAt(0)!)) throw new R2XmlError();
  const xml = input
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i, "");
  const document: R2XmlNode = { name: "", text: "", children: [] };
  const stack = [document];
  let offset = 0,
    nodes = 0;
  while (offset < xml.length) {
    const current = stack[stack.length - 1]!;
    if (xml[offset] !== "<") {
      const end = xml.indexOf("<", offset);
      const next = end < 0 ? xml.length : end;
      const raw = xml.slice(offset, next);
      if (raw.includes("]]>")) throw new R2XmlError();
      current.text += decodeXml(raw);
      offset = next;
      continue;
    }
    if (xml.startsWith("<!--", offset)) {
      const end = xml.indexOf("-->", offset + 4);
      if (end < 0 || xml.slice(offset + 4, end).includes("--")) throw new R2XmlError();
      offset = end + 3;
      continue;
    }
    const end = xml.indexOf(">", offset);
    if (end < 0) throw new R2XmlError();
    const token = xml.slice(offset, end + 1);
    const close = /^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(token);
    if (close) {
      if (stack.length === 1 || current.name !== close[1]) throw new R2XmlError();
      stack.pop();
    } else {
      const open =
        /^<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>$/.exec(
          token,
        );
      if (!open) throw new R2XmlError();
      const attributes = new Set<string>();
      for (const match of (open[2] ?? "").matchAll(
        /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g,
      )) {
        if (attributes.has(match[1]!)) throw new R2XmlError();
        attributes.add(match[1]!);
        decodeXml(match[2] ?? match[3] ?? "");
      }
      const node: R2XmlNode = { name: open[1]!, text: "", children: [] };
      current.children.push(node);
      if (++nodes > 20000 || stack.length > 16) throw new R2XmlError(true);
      if (!open[3]) stack.push(node);
    }
    offset = end + 1;
  }
  if (stack.length !== 1 || document.children.length !== 1 || document.text.trim())
    throw new R2XmlError();
  return document.children[0]!;
}

export function xmlField(node: R2XmlNode, name: string, required = true): string | null {
  const matches = node.children.filter((child) => child.name === name);
  if (matches.length > 1 || (required && matches.length !== 1) || matches[0]?.children.length)
    throw new R2XmlError();
  return matches[0]?.text ?? null;
}

export function xmlFields(node: R2XmlNode, allowed: readonly string[]): void {
  if (node.text.trim() || node.children.some((child) => !allowed.includes(child.name)))
    throw new R2XmlError();
}

export async function readR2XmlText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    void response.body?.cancel().catch(() => undefined);
    throw new R2XmlError();
  }
  if (declared !== null && Number(declared) > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new R2XmlError(true);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = (bytes?: Uint8Array, stream = false) => {
    try {
      return decoder.decode(bytes, { stream });
    } catch {
      throw new R2XmlError();
    }
  };
  let size = 0;
  const pieces: string[] = [];
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new R2XmlError(true);
      pieces.push(decode(next.value, true));
    }
    pieces.push(decode());
    // Fetch decompresses the body but can retain the compressed Content-Length.
    const encoding = response.headers.get("content-encoding");
    if (declared !== null && (!encoding || encoding === "identity") && Number(declared) !== size)
      throw new R2XmlError();
    return pieces.join("");
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
