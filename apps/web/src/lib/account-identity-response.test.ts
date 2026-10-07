import { describe, expect, it } from "vitest";
import { parseAccountIdentity } from "./account-identity-response";
const uuid = "a0000000-0000-4000-8000-000000000001";
const sample = () => ({
  account: {
    id: uuid,
    displayName: "Actual account",
    email: "owner@example.com",
    passwordHash: "never-projected",
  },
  channel: { id: uuid, name: "Actual channel", handle: "owned-channel" },
  profile: { id: uuid, name: "Default profile", slug: "owned-profile", isKids: false },
  creatorTv: { id: uuid, name: "Actual TV", slug: "owned-tv" },
});
describe("account root identity projection", () => {
  it("projects actual identity fields only and normalizes UUID case", () => {
    const raw = sample();
    raw.account.id = uuid.toUpperCase();
    const parsed = parseAccountIdentity(raw);
    expect(parsed.account).toEqual({
      id: uuid,
      displayName: "Actual account",
      email: "owner@example.com",
    });
    expect(JSON.stringify(parsed)).not.toContain("never-projected");
    expect(parsed.profile).not.toHaveProperty("isKids");
  });
  it("rejects malformed missing identities without fabricated default data", () => {
    for (const raw of [null, [], {}, { ...sample(), channel: null }, { ...sample(), profile: [] }])
      expect(() => parseAccountIdentity(raw)).toThrow();
  });
  it.each(["phase5d.creator", "صانع.المحتوى", "a", "a".repeat(80)])(
    "preserves server-valid channel handle %s",
    (handle) => {
      const raw = sample();
      raw.channel.handle = handle;
      expect(parseAccountIdentity(raw).channel.handle).toBe(handle);
    },
  );
  it.each([".creator", "creator.", "creator_", "../creator", "a/b", "a%2fb", "a".repeat(81)])(
    "rejects channel handle outside the server contract: %s",
    (handle) => {
      const raw = sample();
      raw.channel.handle = handle;
      expect(() => parseAccountIdentity(raw)).toThrow();
    },
  );
  it("does not loosen profile/TV slug or entity ID validation for dotted channel handles", () => {
    const raw = sample();
    raw.channel.handle = "phase5d.creator";
    for (const invalid of [
      { ...raw, profile: { ...raw.profile, slug: "profile.dot" } },
      { ...raw, creatorTv: { ...raw.creatorTv, slug: "tv.dot" } },
      { ...raw, channel: { ...raw.channel, id: "channel.dot" } },
      { ...raw, profile: { ...raw.profile, id: "profile.dot" } },
      { ...raw, creatorTv: { ...raw.creatorTv, id: "tv.dot" } },
    ])
      expect(() => parseAccountIdentity(invalid)).toThrow();
  });
  it("rejects unsafe path handles, malformed UUIDs and control or unbounded text", () => {
    for (const raw of [
      { ...sample(), channel: { ...sample().channel, handle: "../other" } },
      { ...sample(), profile: { ...sample().profile, slug: "/private" } },
      { ...sample(), account: { ...sample().account, id: "invalid" } },
      { ...sample(), account: { ...sample().account, displayName: "invalid\nname" } },
      { ...sample(), account: { ...sample().account, email: "x".repeat(321) } },
    ])
      expect(() => parseAccountIdentity(raw)).toThrow();
  });
});
