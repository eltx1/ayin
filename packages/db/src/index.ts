export const databaseBaseline = {
  orm: "prisma",
  provider: "postgresql",
} as const;

export type DatabaseBaseline = typeof databaseBaseline;
