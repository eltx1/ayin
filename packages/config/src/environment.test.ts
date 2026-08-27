import { describe, expect, it } from "vitest";
import { z } from "zod";

import { appEnvironmentSchema, parseEnvironment } from "./environment.js";

describe("parseEnvironment", () => {
  it("returns typed validated configuration", () => {
    const schema = z.object({ APP_ENV: appEnvironmentSchema });

    expect(parseEnvironment(schema, { APP_ENV: "test" })).toEqual({ APP_ENV: "test" });
  });

  it("rejects an unknown deployment environment", () => {
    const schema = z.object({ APP_ENV: appEnvironmentSchema });

    expect(() => parseEnvironment(schema, { APP_ENV: "regional" })).toThrow();
  });
});
