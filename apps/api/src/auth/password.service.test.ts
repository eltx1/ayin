import { describe, expect, it } from "vitest";

import { PasswordService } from "./password.service.js";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("stores a salted scrypt hash and verifies only the correct password", async () => {
    const password = "a-production-shaped-password";
    const first = await service.hash(password);
    const second = await service.hash(password);

    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toContain(password);
    expect(second).not.toBe(first);
    await expect(service.verify(password, first)).resolves.toBe(true);
    await expect(service.verify("wrong-password", first)).resolves.toBe(false);
  });
});
