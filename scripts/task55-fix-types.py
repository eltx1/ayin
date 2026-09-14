from pathlib import Path
import re

p = Path("apps/api/src/movie-catalog/movie-catalog.service.ts")
s = p.read_text()

if 'import type { Prisma } from "@ayin/db";' not in s:
    s = s.replace(
        'import { HttpException, Inject, Injectable } from "@nestjs/common";',
        'import type { Prisma } from "@ayin/db";\nimport { HttpException, Inject, Injectable } from "@nestjs/common";',
        1,
    )

replacements = {
    "altText?: string | null;": "altText?: string | null | undefined;",
    "startsAt?: Date | null;": "startsAt?: Date | null | undefined;",
    "endsAt?: Date | null;": "endsAt?: Date | null | undefined;",
    "note?: string | null;": "note?: string | null | undefined;",
    "title?: string | null;": "title?: string | null | undefined;",
    "synopsis?: string | null;": "synopsis?: string | null | undefined;",
    "slug?: string;": "slug?: string | undefined;",
    "releaseDate?: Date | null;": "releaseDate?: Date | null | undefined;",
    "primaryVideoId?: string | null;": "primaryVideoId?: string | null | undefined;",
    "trailerVideoId?: string | null;": "trailerVideoId?: string | null | undefined;",
    "localizations?: MovieLocalizationInput[];": "localizations?: MovieLocalizationInput[] | undefined;",
    "genres?: string[];": "genres?: string[] | undefined;",
    "artwork?: MovieArtworkInput[];": "artwork?: MovieArtworkInput[] | undefined;",
    "availability?: MovieAvailabilityInput[];": "availability?: MovieAvailabilityInput[] | undefined;",
}
for old, new in replacements.items():
    s = s.replace(old, new)

explicit_patch = '''export interface MovieCatalogPatch {
  title?: string | undefined;
  slug?: string | undefined;
  synopsis?: string | undefined;
  releaseDate?: Date | null | undefined;
  releaseYear?: number | undefined;
  runtimeMinutes?: number | undefined;
  maturityRating?: string | undefined;
  originalLanguage?: string | undefined;
  primaryVideoId?: string | null | undefined;
  trailerVideoId?: string | null | undefined;
  genres?: string[] | undefined;
  artwork?: MovieArtworkInput[] | undefined;
  availability?: MovieAvailabilityInput[] | undefined;
  localizations?: MovieLocalizationInput[] | undefined;
}
'''
s, patch_count = re.subn(
    r'export interface MovieCatalogPatch extends Partial<[\s\S]*?\n}\n',
    explicit_patch,
    s,
    count=1,
)
if patch_count != 1:
    raise SystemExit(f"MovieCatalogPatch replacement count={patch_count}")

if "type MovieWithRelations = Prisma.MovieGetPayload<" not in s:
    patch_match = re.search(r'(export interface MovieCatalogPatch \{[\s\S]*?\n}\n)', s)
    if not patch_match:
        raise SystemExit("explicit MovieCatalogPatch block not found")
    types = '''

type MovieWithRelations = Prisma.MovieGetPayload<{
  include: {
    genres: { include: { genre: true } };
    artwork: true;
    availability: true;
    localizations: true;
  };
}>;

type HydratedVideo = {
  id: string;
  slug: string;
  title: string;
  status: string;
  visibility: string;
  durationMs: number | null;
};

type HydratedAsset = {
  id: string;
  r2ObjectKey: string;
  mimeType: string;
  status: string;
  width: number | null;
  height: number | null;
  removedAt: Date | null;
};

type HydratedMovie = Omit<MovieWithRelations, "genres" | "artwork"> & {
  genres: Array<MovieWithRelations["genres"][number]["genre"]>;
  artwork: Array<MovieWithRelations["artwork"][number] & { asset: HydratedAsset | null }>;
  primaryVideo: HydratedVideo | null;
  trailerVideo: HydratedVideo | null;
};
'''
    pos = patch_match.end()
    s = s[:pos] + types + s[pos:]

s, count = re.subn(
    r'  private async hydrate<T extends Awaited<ReturnType<MovieCatalogService\["getAdminRow"\]>>>\(\s*row: NonNullable<T>,\s*\) \{',
    '  private async hydrate(row: MovieWithRelations): Promise<HydratedMovie> {',
    s,
    count=1,
)
if count != 1:
    raise SystemExit(f"hydrate replacement count={count}")

s = s.replace(
    'movie: Awaited<ReturnType<MovieCatalogService["getAdminById"]>>',
    "movie: HydratedMovie",
)
s = s.replace(
    'item: Awaited<ReturnType<MovieCatalogService["getAdminById"]>>["artwork"][number] | null,',
    'item: HydratedMovie["artwork"][number] | null,',
)
s = s.replace(
    "const data: Record<string, unknown> = {};",
    "const data: Prisma.MovieUncheckedUpdateInput = {};",
    1,
)
s = s.replace(
    "scalar.primaryVideoId ?? current.primaryVideoId,",
    "patch.primaryVideoId !== undefined ? patch.primaryVideoId : current.primaryVideoId,",
    1,
)
s = s.replace(
    "scalar.trailerVideoId ?? current.trailerVideoId,",
    "patch.trailerVideoId !== undefined ? patch.trailerVideoId : current.trailerVideoId,",
    1,
)

p.write_text(s)
