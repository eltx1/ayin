import { Prisma } from "@ayin/db";
import { HttpException } from "@nestjs/common";
import { z } from "zod";
import { normalizeCatalogLocale } from "../catalog-localization/catalog-localization.js";

const directoryQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(24).default(24),
    locale: z.string().trim().min(2).max(35).optional(),
  })
  .strict();

export function parseDirectoryQuery(query: unknown) {
  return parseQuery(directoryQuerySchema, query);
}

export function parseCatalogDirectoryQuery(query: unknown) {
  return parseQuery(
    directoryQuerySchema.extend({ q: z.string().trim().max(100).optional() }),
    query,
  );
}

function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.output<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success)
    throw new HttpException(
      {
        error: {
          code: "INVALID_DIRECTORY_QUERY",
          message: "This browsing page is invalid.",
        },
      },
      400,
    );
  return parsed.data;
}

// Search before pagination, across original copy and requested/English fallback
// translations. Values stay bound; LIKE metacharacters are literal search text.
export function catalogDirectorySearchSql(
  kind: "MOVIE" | "SERIES",
  id: Prisma.Sql,
  title: Prisma.Sql,
  synopsis: Prisma.Sql,
  query?: string,
  locale?: string,
): Prisma.Sql {
  const normalized = query?.trim();
  if (!normalized) return Prisma.sql`TRUE`;
  const pattern = `%${normalized.replace(/[\\%_]/g, "\\$&")}%`;
  const table =
    kind === "MOVIE" ? Prisma.sql`"MovieLocalization"` : Prisma.sql`"SeriesLocalization"`;
  const column = kind === "MOVIE" ? Prisma.sql`copy."movieId"` : Prisma.sql`copy."seriesId"`;
  return Prisma.sql`(
    concat_ws(' ', ${title}, ${synopsis}) ILIKE ${pattern} ESCAPE '\\'
    OR EXISTS (
      SELECT 1 FROM ${table} copy WHERE ${column} = ${id}
        AND copy.locale IN (${normalizeCatalogLocale(locale)}, 'en')
        AND concat_ws(' ', copy.title, copy.synopsis, copy."shortDescription") ILIKE ${pattern} ESCAPE '\\'
    )
  )`;
}

// Mirrors catalog availability (not VideoPolicy). Exact active territory rules
// override global rules; BLOCK wins within that scope. Series alone retains its
// established no-rights-rows global default. Names below are constants, never input.
export function catalogAvailabilitySql(
  kind: "MOVIE" | "SERIES",
  id: Prisma.Sql,
  countryCode: string | null | undefined,
  now: Date,
): Prisma.Sql {
  const table =
    kind === "MOVIE" ? Prisma.sql`"MovieAvailability"` : Prisma.sql`"SeriesAvailability"`;
  const column = kind === "MOVIE" ? Prisma.sql`a."movieId"` : Prisma.sql`a."seriesId"`;
  const belongs = Prisma.sql`${column} = ${id}`;
  const active = Prisma.sql`${belongs} AND (a."startsAt" IS NULL OR a."startsAt" <= ${now})
    AND (a."endsAt" IS NULL OR a."endsAt" > ${now})`;
  const country = countryCode?.trim().toUpperCase();
  const scope =
    country && /^[A-Z]{2}$/.test(country)
      ? Prisma.sql`CASE WHEN EXISTS (SELECT 1 FROM ${table} a WHERE ${active}
        AND a."territoryCode" = ${country}) THEN ${country} ELSE '*' END`
      : Prisma.sql`'*'`;
  const allowed = Prisma.sql`EXISTS (SELECT 1 FROM ${table} a WHERE ${active}
    AND a."territoryCode" = (${scope}) AND a.rule = 'ALLOW')
    AND NOT EXISTS (SELECT 1 FROM ${table} a WHERE ${active}
    AND a."territoryCode" = (${scope}) AND a.rule = 'BLOCK')`;
  return kind === "SERIES"
    ? Prisma.sql`(NOT EXISTS (SELECT 1 FROM ${table} a WHERE ${belongs}) OR (${allowed}))`
    : Prisma.sql`(${allowed})`;
}

export function directoryPage<T extends { id: string }>(records: T[], limit: number) {
  const items = records.slice(0, limit);
  return { items, nextCursor: records.length > limit ? items.at(-1)!.id : null };
}
