import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";

import { MfaService } from "./mfa.service.js";

function fixture(credential: null | { status: "PENDING" | "ENABLED"; version: number }) {
  const database = {
    client: { accountMfaCredential: { findUnique: vi.fn().mockResolvedValue(credential) } },
  };
  const tokens = { issueMfaChallenge: vi.fn().mockReturnValue("current-verification-challenge") };
  return {
    tokens,
    service: new MfaService(
      database as never,
      tokens as never,
      {} as never,
      {} as never,
      {} as never,
    ),
  };
}

describe("optional administrator MFA policy", () => {
  it.each([null, { status: "PENDING" as const, version: 2 }])(
    "does not turn absent or unfinished enrollment into a login requirement: %j",
    async (credential) => {
      const { service, tokens } = fixture(credential);
      expect(await service.loginChallenge("account", 1)).toBeNull();
      expect(tokens.issueMfaChallenge).not.toHaveBeenCalled();
      await expect(service.assertAdminMfa("account")).resolves.toBeUndefined();
    },
  );

  it("still challenges enabled factors and rejects unverified or old assurance", async () => {
    const { service, tokens } = fixture({ status: "ENABLED", version: 4 });
    expect(await service.loginChallenge("account", 1)).toMatchObject({
      mfaRequired: true,
      enrollmentRequired: false,
      challengeToken: "current-verification-challenge",
    });
    expect(tokens.issueMfaChallenge).toHaveBeenCalledWith("account", 1, 4, "verify");
    await expect(service.assertAdminMfa("account")).rejects.toThrow();
    await expect(service.assertAdminMfa("account", 123, 3)).rejects.toThrow();
    await expect(service.assertAdminMfa("account", 123, 4)).resolves.toBeUndefined();
  });

  it.each([null, { status: "PENDING" as const, version: 2 }])(
    "does not revive assurance from an enabled credential that was removed: %j",
    async (credential) => {
      const { service } = fixture(credential);
      await expect(service.assertAdminMfa("account", 123, 1)).rejects.toThrow();
    },
  );
});
