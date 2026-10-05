import { z } from "zod";

const scopeSchema = z.object({
  accountId: z.string().uuid(),
  channelId: z.string().uuid(),
  take: z.number().int().min(1).max(100),
  query: z.string().max(200),
  status: z.enum(["", "DRAFT", "UPLOADING", "VALIDATING", "SCHEDULED", "PUBLISHED", "REMOVED"]),
  visibility: z.enum(["", "PUBLIC", "UNLISTED", "PRIVATE"]),
});
const cursorSchema = scopeSchema
  .extend({
    version: z.literal(1),
    updatedAt: z.string().datetime(),
    id: z.string().uuid(),
  })
  .strict();
type Scope = z.infer<typeof scopeSchema>;

export function encodeStudioContentCursor(
  boundary: { updatedAt: Date; id: string },
  scope: {
    accountId: string;
    channelId: string;
    take: number;
    query: string;
    status: string;
    visibility: string;
  },
): string {
  return Buffer.from(
    JSON.stringify({
      ...scopeSchema.parse(scope),
      version: 1,
      updatedAt: boundary.updatedAt.toISOString(),
      id: boundary.id,
    }),
  ).toString("base64url");
}

export function decodeStudioContentCursor(
  encoded: string,
  scope: {
    accountId: string;
    channelId: string;
    take: number;
    query: string;
    status: string;
    visibility: string;
  },
): { updatedAt: Date; id: string } {
  if (encoded.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("INVALID_CONTENT_CURSOR");
  const raw = Buffer.from(encoded, "base64url");
  if (raw.toString("base64url") !== encoded) throw new Error("INVALID_CONTENT_CURSOR");
  const cursor = cursorSchema.parse(JSON.parse(raw.toString("utf8")));
  const expected = scopeSchema.parse(scope);
  for (const key of Object.keys(expected) as (keyof Scope)[]) {
    if (cursor[key] !== expected[key]) throw new Error("INVALID_CONTENT_CURSOR");
  }
  const updatedAt = new Date(cursor.updatedAt);
  if (updatedAt.toISOString() !== cursor.updatedAt) throw new Error("INVALID_CONTENT_CURSOR");
  return { updatedAt, id: cursor.id };
}
