import "reflect-metadata";

import { describe, expect, it } from "vitest";

import { AdminGuard } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AdminMovieCatalogController } from "./admin-movie-catalog.controller.js";

describe("movie catalog admin authorization", () => {
  it("requires authenticated admin access with the OPERATIONS role", () => {
    const guards = (Reflect.getMetadata("__guards__", AdminMovieCatalogController) ?? []) as unknown[];
    const roles = Reflect.getMetadata("ayin.admin.requiredRoles", AdminMovieCatalogController) as
      | string[]
      | undefined;

    expect(guards).toEqual(expect.arrayContaining([AuthGuard, AdminGuard]));
    expect(roles).toEqual(["OPERATIONS"]);
  });
});
