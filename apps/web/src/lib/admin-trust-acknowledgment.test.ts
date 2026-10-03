import { describe, expect, it } from "vitest";
import {
  parseActorTrustActions,
  verifyAdminTrustAcknowledgment as verify,
} from "./admin-trust-acknowledgment";
const id = "00000000-0000-4000-8000-000000000001",
  actor = "00000000-0000-4000-8000-000000000002";
describe("protected trust acknowledgments", () => {
  it("rejects successful HTTP bodies for the wrong record or decision", () => {
    expect(() =>
      verify(
        `/admin/trust/appeals/${id}`,
        { id: actor, status: "UPHELD", resolution: "Actual review reason" },
        { status: "UPHELD", resolution: "Actual review reason" },
        actor,
      ),
    ).toThrow();
    expect(() =>
      verify(
        `/admin/trust/appeals/${id}`,
        { id, status: "OVERTURNED", resolution: "Actual review reason" },
        { status: "UPHELD", resolution: "Actual review reason" },
        actor,
      ),
    ).toThrow();
  });
  it("requires the actual action actor, targets and reason", () => {
    const input = { kind: "WARN", reason: "Specific evidence reviewed", targetAccountId: id };
    expect(() =>
      verify("/admin/trust/actions", { id, actorAccountId: actor, ...input }, input, actor),
    ).not.toThrow();
    expect(() =>
      verify("/admin/trust/actions", { id, actorAccountId: id, ...input }, input, actor),
    ).toThrow();
    expect(() =>
      verify(
        "/admin/trust/actions",
        { id, actorAccountId: actor, ...input, targetAccountId: actor },
        input,
        actor,
      ),
    ).toThrow();
  });
  it("correlates case/takedown decisions and retains absent case resolution semantics", () => {
    for (const type of ["cases", "takedowns"])
      expect(() =>
        verify(
          `/admin/trust/${type}/${id}`,
          { id, status: "REVIEWING", resolution: "Detailed review reason" },
          { status: "REVIEWING", resolution: "Detailed review reason" },
          actor,
        ),
      ).not.toThrow();
    expect(() =>
      verify(
        `/admin/trust/cases/${id}`,
        { id, status: "REVIEWING", resolution: null },
        { status: "REVIEWING" },
        actor,
      ),
    ).not.toThrow();
  });
  it("requires the channel and explicit review flag", () => {
    expect(() =>
      verify(
        `/admin/trust/channels/${id}`,
        { channelId: id, level: "STANDARD", reviewRequired: false },
        { level: "STANDARD", reviewRequired: false },
        actor,
      ),
    ).not.toThrow();
    expect(() =>
      verify(
        `/admin/trust/channels/${id}`,
        { channelId: id, level: "STANDARD", reviewRequired: true },
        { level: "STANDARD", reviewRequired: false },
        actor,
      ),
    ).toThrow();
  });
  it("requires exact saved settings, including real false and empty terms", () => {
    expect(() =>
      verify(
        "/admin/trust/settings",
        { blockedTerms: [], newCreatorsRequireReview: false },
        { blockedTerms: [], newCreatorsRequireReview: false },
        actor,
      ),
    ).not.toThrow();
    expect(() =>
      verify(
        "/admin/trust/settings",
        { blockedTerms: ["other"], newCreatorsRequireReview: false },
        { blockedTerms: ["specific"], newCreatorsRequireReview: false },
        actor,
      ),
    ).toThrow();
  });
  it("rejects malformed acknowledgments and unsupported endpoints", () => {
    for (const value of [null, [], "", {}])
      expect(() => verify("/admin/trust/actions", value, { kind: "WARN" }, actor)).toThrow();
    expect(() => verify("/admin/trust/unknown", {}, {}, actor)).toThrow();
  });
});

it("recent action presentation rejects another actor, duplicate identities and invalid target references", () => {
  const row = {
    id,
    actorAccountId: actor,
    kind: "WARN",
    reason: "Actual evidence reason",
    createdAt: "2026-10-03T05:00:00Z",
    targetAccountId: id,
    channelId: null,
    videoId: null,
    caseId: null,
  };
  expect(parseActorTrustActions({ actions: [row] }, actor)).toEqual([row]);
  expect(() => parseActorTrustActions({ actions: [row] }, id)).toThrow();
  expect(() => parseActorTrustActions({ actions: [row, row] }, actor)).toThrow();
  expect(() =>
    parseActorTrustActions({ actions: [{ ...row, videoId: "other" }] }, actor),
  ).toThrow();
  expect(() => parseActorTrustActions({ actions: Array(101).fill(row) }, actor)).toThrow();
});
