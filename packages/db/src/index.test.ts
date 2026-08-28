import { describe, expect, it } from "vitest";

import { databaseBaseline } from "./index.js";

describe("database baseline", () => {
  it("reserves PostgreSQL and Prisma for Task 02", () => {
    expect(databaseBaseline).toEqual({ orm: "prisma", provider: "postgresql" });
  });
});
