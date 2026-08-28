import { describe, expect, it } from "vitest";

import { databaseBaseline } from "./index.js";

describe("database baseline", () => {
  it("uses PostgreSQL and Prisma as the durable data boundary", () => {
    expect(databaseBaseline).toEqual({ orm: "prisma", provider: "postgresql" });
  });
});
